// Audio engine scaffold.
//
// Owns the AudioContext, the master gain, a brick-wall-ish limiter, and an
// analyser tap that feeds video-reactivity (a.fft[i]) starting in M3.
//
// Routing:   operator chain → master → limiter → analyser → destination
//
// The engine doesn't create the AudioContext eagerly because AudioContext
// construction requires a user gesture in most browsers. Call init() from
// a click/keydown handler. After init, bind to the clock singleton so the
// rest of the app can read currentTime via clock.displayTime.

import { clock } from '../core/clock.svelte';

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #fftMagnitudes: Float32Array<ArrayBuffer> | null = null;

  get ctx(): AudioContext {
    if (!this.#ctx) throw new Error('AudioEngine not initialised — call init() first');
    return this.#ctx;
  }

  get isInitialised(): boolean {
    return this.#ctx !== null;
  }

  /** Tap point for operator chains. */
  get input(): AudioNode {
    if (!this.#master) throw new Error('AudioEngine not initialised');
    return this.#master;
  }

  /** Initialise on a user gesture. Idempotent. */
  init(): void {
    if (this.#ctx) return;

    const ctx = new AudioContext({ latencyHint: 'interactive' });

    const master = ctx.createGain();
    master.gain.value = 0.7;

    // Configured as a soft brick-wall limiter, not a musical compressor.
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

    clock.bindAudioContext(ctx);
  }

  setMasterGain(linear: number): void {
    if (!this.#master) return;
    this.#master.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.01);
  }

  /** Pull current FFT magnitudes in dB. Caller may not mutate the returned array. */
  getFftMagnitudes(): Float32Array | null {
    if (!this.#analyser || !this.#fftMagnitudes) return null;
    this.#analyser.getFloatFrequencyData(this.#fftMagnitudes);
    return this.#fftMagnitudes;
  }

  async dispose(): Promise<void> {
    if (!this.#ctx) return;
    await this.#ctx.close();
    this.#ctx = null;
    this.#master = null;
    this.#analyser = null;
    this.#fftMagnitudes = null;
  }
}

// Module-level singleton. The renderer and the UI both reach for the same one.
export const audio = new AudioEngine();
