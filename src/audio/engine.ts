// Audio engine — wraps an AudioContext and routes:
//   source (silent / video-element) → master → softClip → limiter
//          → analyser → destination
//
// Auxiliary sources (granulator, feedback delay) attach in parallel via
// attachAuxiliarySource(). Per-operator audio stages no longer exist; the
// public audio surface is granulator + feedback delay + master limiter.

import { clock } from '../core/clock.svelte';
import { SilentSource, type AudioSourceStage } from './sources';
import { ensureAudioWorklets } from './worklets';
import {
  EMPTY_VIDEO_FEATURES,
  type CouplingContext,
  type VideoFeatureState,
} from '../core/coupling';

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
  #paramTimer = 0;
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
      this.#source.output.connect(master);

      clock.bindAudioContext(ctx);
      this.#startParamPoll();
    })();

    return this.#initPromise;
  }

  /**
   * Replace the audio source (SilentSource or VideoElementAudioSource).
   * Cannot be called before init().
   */
  setSource(source: AudioSourceStage, params?: Readonly<Record<string, number>>): void {
    if (!this.#ctx || !this.#master) throw new Error('AudioEngine.setSource called before init()');
    const old = this.#source;
    old?.output.disconnect();
    this.#source = source;
    this.#sourceParams = params ?? {};
    source.output.connect(this.#master);
    old?.dispose();
  }

  /**
   * Attach a parallel auxiliary source (granulator, feedback delay) directly
   * to the master bus. Returns a disconnect callback. The caller owns the
   * lifecycle of `node`.
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

  setSourceParams(params: Readonly<Record<string, number>>): void {
    this.#sourceParams = params;
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
    this.#source?.dispose();
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
    this.#source?.setParams?.(this.#sourceParams, ctx);
  }
}

export const audio = new AudioEngine();
