// Audio engine — wraps an AudioContext and routes:
//   source → instance[0].audioStage → instance[1] → ... → master → limiter
//          → analyser → destination

import { clock } from '../core/clock.svelte';
import type { OperatorInstance } from '../core/operators';
import { attachAudio, isNeutralInstance } from '../core/operators';
import { SilentSource, type AudioSourceStage } from './sources';
import { ensureAudioWorklets } from './worklets';
import { evaluateAudioParams, type CouplingContext, type OperatorCoupling } from '../core/coupling';

const PARAM_POLL_MS = 16; // ~60Hz; setTargetAtTime smooths the audible jumps.

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #initPromise: Promise<void> | null = null;
  #master: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #capture: MediaStreamAudioDestinationNode | null = null;
  #fftMagnitudes: Float32Array<ArrayBuffer> | null = null;

  #source: AudioSourceStage | null = null;
  #sourceParams: Readonly<Record<string, number>> = {};
  #sourceCoupling: OperatorCoupling | null = null;
  #instances: OperatorInstance[] = [];
  #paramTimer = 0;
  #activeSignature = '';

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

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      const capture = ctx.createMediaStreamDestination();

      master.connect(limiter);
      limiter.connect(analyser);
      limiter.connect(capture);
      analyser.connect(ctx.destination);

      this.#ctx = ctx;
      this.#master = master;
      this.#analyser = analyser;
      this.#capture = capture;
      this.#fftMagnitudes = new Float32Array(analyser.frequencyBinCount);
      this.#source = new SilentSource(ctx);
      for (const inst of this.#instances) attachAudio(inst, ctx);

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

  /** Procedural sources mutate their own params object; this exposes it. */
  setSourceParams(params: Readonly<Record<string, number>>): void {
    this.#sourceParams = params;
  }

  /**
   * Set the ordered operator chain. Each instance has its audio stage attached
   * automatically if not already. Cannot be called before init() because audio
   * stages need the AudioContext.
   */
  setInstances(instances: OperatorInstance[]): void {
    if (!this.#ctx) {
      // Stash for after init() — we'll rewire then.
      this.#instances = instances;
      return;
    }
    for (const inst of instances) attachAudio(inst, this.#ctx);
    this.#instances = instances;
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

    // Rebuild: source → instances in order → master.
    let prev: AudioNode = this.#source.output;
    for (const inst of this.#instances) {
      if (isNeutralInstance(inst)) continue;
      if (!inst.audioStage) continue; // skip un-attached
      prev.connect(inst.audioStage.input);
      prev = inst.audioStage.output;
    }
    prev.connect(this.#master);
    this.#activeSignature = this.#computeActiveSignature();
  }

  setMasterGain(linear: number): void {
    if (!this.#master) return;
    this.#master.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.01);
  }

  getFftMagnitudes(): Float32Array | null {
    if (!this.#analyser || !this.#fftMagnitudes) return null;
    this.#analyser.getFloatFrequencyData(this.#fftMagnitudes);
    return this.#fftMagnitudes;
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
    this.#source?.dispose();
    await this.#ctx.close();
    this.#ctx = null;
    this.#master = null;
    this.#analyser = null;
    this.#capture = null;
    this.#fftMagnitudes = null;
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
    };
    const activeSignature = this.#computeActiveSignature();
    if (activeSignature !== this.#activeSignature) this.#rewire();
    const sourceParams = this.#sourceCoupling
      ? evaluateAudioParams(this.#sourceCoupling, this.#sourceParams, ctx)
      : this.#sourceParams;
    this.#source?.setParams?.(sourceParams, ctx);
    for (const inst of this.#instances) {
      const params = evaluateAudioParams(inst.def.coupling, inst.params, ctx);
      inst.audioStage?.setParams(params, ctx);
    }
  }

  #computeActiveSignature(): string {
    return this.#instances
      .filter((inst) => !isNeutralInstance(inst))
      .map((inst) => inst.id)
      .join('|');
  }
}

export const audio = new AudioEngine();
