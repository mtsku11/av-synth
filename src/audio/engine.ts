// Audio engine — wraps an AudioContext and routes:
//   source → instance[0].audioStage → instance[1] → ... → master → limiter
//          → analyser → destination

import { clock } from '../core/clock.svelte';
import { BUS_INDICES, SOURCE_NODE_ID, parseBusReturnId, type BusIndex } from '../core/graph.svelte';
import type { OperatorInstance } from '../core/operators';
import { attachAudio, isNeutralInstance } from '../core/operators';
import type { GraphExecutionPlan } from '../core/patch-graph';
import {
  attachAudioRack,
  evaluateAudioRackRawParams,
  type AudioRackInstance,
} from '../core/audio-rack';
import { SilentSource, type AudioSourceStage } from './sources';
import { ensureAudioWorklets } from './worklets';
import {
  EMPTY_VIDEO_FEATURES,
  evaluateAudioParams,
  type CouplingContext,
  type OperatorCoupling,
  type VideoFeatureState,
} from '../core/coupling';
import { applyGlobalLfoAssignments } from '../core/mod-bank';

const PARAM_POLL_MS = 16; // ~60Hz; setTargetAtTime smooths the audible jumps.

function makeMasterSoftClipCurve(samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35);
  }
  return curve;
}

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #initPromise: Promise<void> | null = null;
  #master: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #preLimitAnalyser: AnalyserNode | null = null;
  #capture: MediaStreamAudioDestinationNode | null = null;
  #fftMagnitudes: Float32Array<ArrayBuffer> | null = null;
  #peakTimeDomain: Float32Array<ArrayBuffer> | null = null;

  #source: AudioSourceStage | null = null;
  #sourceParams: Readonly<Record<string, number>> = {};
  #sourceCoupling: OperatorCoupling | null = null;
  #instances: OperatorInstance[] = [];
  #audioRackInstances: AudioRackInstance[] = [];
  #busReturnInputs = new Map<BusIndex, GainNode>();
  #busReturnDelays = new Map<BusIndex, DelayNode>();
  #plan: GraphExecutionPlan = {
    monitorBus: 0,
    monitorNodeId: null,
    busOutputIds: {},
    steps: [],
    executableInstances: [],
    executableIds: new Set<string>(),
    diagnostics: [],
  };
  #paramTimer = 0;
  #activeSignature = '';
  #videoFeatures: VideoFeatureState = { ...EMPTY_VIDEO_FEATURES };

  get ctx(): AudioContext {
    if (!this.#ctx) throw new Error('AudioEngine not initialised — call init() first');
    return this.#ctx;
  }

  get isInitialised(): boolean {
    return this.#ctx !== null;
  }

  init(): Promise<void> {
    if (this.#initPromise) return this.#initPromise;
    if (this.#ctx) return Promise.resolve();

    this.#initPromise = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ensureAudioWorklets(ctx);

      const master = ctx.createGain();
      master.gain.value = 0.7;

      const softClip = ctx.createWaveShaper();
      softClip.curve = makeMasterSoftClipCurve();
      softClip.oversample = '4x';

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;

      // Pre-limit tap: measures what the patch is sending into the limiter, so
      // the master meter reflects design level rather than post-limit safety-net level.
      // §13 quality gate #6 ("≤ 0 dBFS true-peak, limiter is the safety net") is the
      // engineering metric; this live tap is a sample-peak proxy for usability.
      const preLimitAnalyser = ctx.createAnalyser();
      preLimitAnalyser.fftSize = 512;
      preLimitAnalyser.smoothingTimeConstant = 0;

      const capture = ctx.createMediaStreamDestination();

      master.connect(softClip);
      softClip.connect(preLimitAnalyser);
      softClip.connect(limiter);
      limiter.connect(analyser);
      limiter.connect(capture);
      analyser.connect(ctx.destination);

      this.#ctx = ctx;
      this.#master = master;
      this.#analyser = analyser;
      this.#preLimitAnalyser = preLimitAnalyser;
      this.#capture = capture;
      this.#fftMagnitudes = new Float32Array(analyser.frequencyBinCount);
      this.#peakTimeDomain = new Float32Array(preLimitAnalyser.fftSize);
      this.#source = new SilentSource(ctx);
      this.#ensureBusReturns(ctx);
      for (const inst of this.#instances) attachAudio(inst, ctx);
      for (const rackInst of this.#audioRackInstances) attachAudioRack(rackInst, ctx);

      clock.bindAudioContext(ctx);
      this.#rewire();
      this.#startParamPoll();
    })();

    return this.#initPromise;
  }

  /**
   * Replace the audio source. Disconnects the old; reconnects the chain.
   * Cannot be called before init().
   */
  setSource(
    source: AudioSourceStage,
    params?: Readonly<Record<string, number>>,
    coupling?: OperatorCoupling,
  ): void {
    if (!this.#ctx) throw new Error('AudioEngine.setSource called before init()');
    const old = this.#source;
    old?.output.disconnect();
    this.#source = source;
    this.#sourceParams = params ?? {};
    this.#sourceCoupling = coupling ?? null;
    this.#rewire();
    old?.dispose();
  }

  /**
   * Attach a parallel auxiliary source (e.g. the granulator) directly to the master
   * bus, bypassing the per-instance operator chain. Returns a disconnect callback.
   * The caller owns the lifecycle of `node`; this method only manages the connection.
   */
  attachAuxiliarySource(node: AudioNode): () => void {
    if (!this.#ctx || !this.#master) {
      throw new Error('AudioEngine.attachAuxiliarySource called before init()');
    }
    const master = this.#master;
    node.connect(master);
    return () => {
      try {
        node.disconnect(master);
      } catch {
        // already disconnected — fine.
      }
    };
  }

  /** Procedural sources mutate their own params object; this exposes it. */
  setSourceParams(params: Readonly<Record<string, number>>): void {
    this.#sourceParams = params;
  }

  setPlan(plan: GraphExecutionPlan): void {
    this.#plan = plan;
    this.#instances = plan.executableInstances;
    if (!this.#ctx) {
      return;
    }
    for (const inst of this.#instances) attachAudio(inst, this.#ctx);
    this.#rewire();
  }

  setAudioRack(instances: readonly AudioRackInstance[]): void {
    this.#audioRackInstances = [...instances];
    if (!this.#ctx) return;
    for (const inst of this.#audioRackInstances) attachAudioRack(inst, this.#ctx);
    this.#rewire();
  }

  #rewire(): void {
    if (!this.#ctx || !this.#master || !this.#source) return;

    // Tear down: disconnect source and every stage.
    this.#source.output.disconnect();
    for (const inst of this.#instances) {
      if (inst.audioStage) {
        inst.audioStage.output.disconnect();
      }
    }
    for (const inst of this.#audioRackInstances) {
      if (inst.audioStage) {
        inst.audioStage.output.disconnect();
      }
    }

    if (this.#audioRackInstances.length > 0) {
      let current: AudioNode = this.#source.output;
      for (const inst of this.#audioRackInstances) {
        if (!inst.audioStage) continue;
        current.connect(inst.audioStage.input);
        current = inst.audioStage.output;
      }
      current.connect(this.#master);
      this.#activeSignature = this.#computeActiveSignature();
      return;
    }

    const outputById = new Map<string, AudioNode>([[SOURCE_NODE_ID, this.#source.output]]);
    for (const step of this.#plan.steps) {
      const inst = step.instance;
      const primary = this.#resolveInputNode(step.inputIds[0], outputById);
      if (isNeutralInstance(inst) || !inst.audioStage) {
        outputById.set(step.id, primary);
        continue;
      }
      primary.connect(inst.audioStage.input);
      if (step.inputIds[1] && inst.audioStage.secondaryInput) {
        const secondary = this.#resolveInputNode(step.inputIds[1], outputById);
        secondary.connect(inst.audioStage.secondaryInput);
      }
      outputById.set(step.id, inst.audioStage.output);
    }
    let connectedBus = false;
    for (const bus of BUS_INDICES) {
      const nodeId = this.#plan.busOutputIds[bus];
      if (!nodeId) continue;
      const busOutput = outputById.get(nodeId) ?? this.#source.output;
      busOutput.connect(this.#master);
      busOutput.connect(this.#busReturnInputs.get(bus)!);
      connectedBus = true;
    }
    if (!connectedBus) this.#source.output.connect(this.#master);
    this.#activeSignature = this.#computeActiveSignature();
  }

  setMasterGain(linear: number): void {
    if (!this.#master) return;
    this.#master.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.01);
  }

  updateVideoFeatures(features: VideoFeatureState): void {
    this.#videoFeatures = features;
  }

  getFftMagnitudes(): Float32Array | null {
    if (!this.#analyser || !this.#fftMagnitudes) return null;
    this.#analyser.getFloatFrequencyData(this.#fftMagnitudes);
    return this.#fftMagnitudes;
  }

  /** Linear sample-peak magnitude of the pre-limiter master bus over the
   *  most recent analyser frame. Returns null before init(). */
  getMasterPeak(): number | null {
    if (!this.#preLimitAnalyser || !this.#peakTimeDomain) return null;
    const buf = this.#peakTimeDomain;
    this.#preLimitAnalyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] ?? 0;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    return peak;
  }

  getCaptureStream(): MediaStream | null {
    return this.#capture?.stream ?? null;
  }

  async dispose(): Promise<void> {
    this.#stopParamPoll();
    if (!this.#ctx) return;
    for (const inst of this.#instances) {
      inst.audioStage?.dispose();
      inst.audioStage = null;
    }
    for (const inst of this.#audioRackInstances) {
      inst.audioStage?.dispose();
      inst.audioStage = null;
    }
    this.#source?.dispose();
    for (const input of this.#busReturnInputs.values()) input.disconnect();
    for (const delay of this.#busReturnDelays.values()) delay.disconnect();
    this.#busReturnInputs.clear();
    this.#busReturnDelays.clear();
    await this.#ctx.close();
    this.#ctx = null;
    this.#master = null;
    this.#analyser = null;
    this.#preLimitAnalyser = null;
    this.#capture = null;
    this.#fftMagnitudes = null;
    this.#peakTimeDomain = null;
    this.#source = null;
    this.#initPromise = null;
  }

  #startParamPoll(): void {
    if (this.#paramTimer) return;
    this.#paramTimer = window.setInterval(() => this.#applyParams(), PARAM_POLL_MS);
  }
  #stopParamPoll(): void {
    if (this.#paramTimer) {
      clearInterval(this.#paramTimer);
      this.#paramTimer = 0;
    }
  }

  #applyParams(): void {
    if (!this.#ctx) return;
    const ctx: CouplingContext = {
      baseFreq: clock.baseFreq,
      bpm: clock.bpm,
      sampleRate: this.#ctx.sampleRate,
      time: this.#ctx.currentTime,
      rate: clock.rate,
      lfoBank: clock.lfoBank,
      videoFeatures: this.#videoFeatures,
    };
    const activeSignature = this.#computeActiveSignature();
    if (activeSignature !== this.#activeSignature) this.#rewire();
    const sourceParams = this.#sourceCoupling
      ? evaluateAudioParams(this.#sourceCoupling, this.#sourceParams, ctx)
      : this.#sourceParams;
    this.#source?.setParams?.(sourceParams, ctx);
    for (const inst of this.#instances) {
      const rawParams = applyGlobalLfoAssignments(
        inst.params,
        inst.def.coupling.params,
        inst.lfoAssignments,
        ctx,
      );
      const params = evaluateAudioParams(inst.def.coupling, rawParams, ctx);
      inst.audioStage?.setParams(params, ctx);
    }
    for (const inst of this.#audioRackInstances) {
      const rawParams = evaluateAudioRackRawParams(inst, ctx);
      const params = evaluateAudioParams(inst.def.coupling, rawParams, ctx);
      inst.audioStage?.setParams(params, ctx);
    }
  }

  #computeActiveSignature(): string {
    if (this.#audioRackInstances.length > 0) {
      return this.#audioRackInstances.map((inst) => inst.id).join('|');
    }
    return this.#plan.steps
      .filter((step) => !isNeutralInstance(step.instance))
      .map((step) => `${step.id}:${step.inputIds.join(',')}`)
      .join('|');
  }

  #ensureBusReturns(ctx: AudioContext): void {
    for (const bus of BUS_INDICES) {
      if (this.#busReturnInputs.has(bus) && this.#busReturnDelays.has(bus)) continue;
      const input = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = Math.max(128 / ctx.sampleRate, 1 / 1000);
      input.connect(delay);
      this.#busReturnInputs.set(bus, input);
      this.#busReturnDelays.set(bus, delay);
    }
  }

  #resolveInputNode(
    inputId: string | undefined,
    outputById: ReadonlyMap<string, AudioNode>,
  ): AudioNode {
    const bus = parseBusReturnId(inputId);
    if (bus !== null) {
      return this.#busReturnDelays.get(bus) ?? this.#source!.output;
    }
    return outputById.get(inputId ?? SOURCE_NODE_ID) ?? this.#source!.output;
  }
}

export const audio = new AudioEngine();
