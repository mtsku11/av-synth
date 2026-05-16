// Audio engine — wraps an AudioContext and routes:
//   source → instance[0].audioStage → instance[1] → ... → master → limiter
//          → analyser → destination

import { clock } from '../core/clock.svelte';
import type { OperatorInstance } from '../core/operators';
import { attachAudio } from '../core/operators';
import { SilentSource, type AudioSourceStage } from './sources';
import type { CouplingContext } from '../core/coupling';

const PARAM_POLL_MS = 16; // ~60Hz; setTargetAtTime smooths the audible jumps.

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #fftMagnitudes: Float32Array<ArrayBuffer> | null = null;

  #source: AudioSourceStage | null = null;
  #instances: OperatorInstance[] = [];
  #paramTimer = 0;

  get ctx(): AudioContext {
    if (!this.#ctx) throw new Error('AudioEngine not initialised — call init() first');
    return this.#ctx;
  }

  get isInitialised(): boolean {
    return this.#ctx !== null;
  }

  init(): void {
    if (this.#ctx) return;

    const ctx = new AudioContext({ latencyHint: 'interactive' });

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

    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    this.#ctx = ctx;
    this.#master = master;
    this.#analyser = analyser;
    this.#fftMagnitudes = new Float32Array(analyser.frequencyBinCount);
    this.#source = new SilentSource(ctx);

    clock.bindAudioContext(ctx);
    this.#rewire();
    this.#startParamPoll();
  }

  /**
   * Replace the audio source. Disconnects the old; reconnects the chain.
   * Cannot be called before init().
   */
  setSource(source: AudioSourceStage): void {
    if (!this.#ctx) throw new Error('AudioEngine.setSource called before init()');
    const old = this.#source;
    this.#source = source;
    this.#rewire();
    old?.dispose();
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
        inst.audioStage.input.disconnect();
        inst.audioStage.output.disconnect();
      }
    }

    // Rebuild: source → instances in order → master.
    let prev: AudioNode = this.#source.output;
    for (const inst of this.#instances) {
      if (!inst.audioStage) continue; // skip un-attached
      prev.connect(inst.audioStage.input);
      prev = inst.audioStage.output;
    }
    prev.connect(this.#master);
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
    this.#fftMagnitudes = null;
    this.#source = null;
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
    };
    for (const inst of this.#instances) {
      inst.audioStage?.setParams(inst.params, ctx);
    }
  }
}

export const audio = new AudioEngine();
