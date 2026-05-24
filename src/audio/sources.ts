// Audio sources. Mirror of src/video/sources.ts: provides an AudioNode to
// feed the operator chain. By default we have no source (silent); loading a
// video file creates a VideoElementAudioSource that taps the same <video>
// element the renderer is reading.

import type { CouplingContext } from '../core/coupling';

const mediaSourceCache = new WeakMap<
  AudioContext,
  WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>
>();

export interface AudioSourceStage {
  readonly kind: string;
  readonly output: AudioNode;
  /**
   * Procedural sources (osc, noise, …) read parameter values and the global
   * coupling context here. Input sources (silent, video element) have no
   * params and can omit this. Called from the audio engine's poll.
   */
  setParams?(params: Readonly<Record<string, number>>, ctx: CouplingContext): void;
  dispose(): void;
}

export class SilentSource implements AudioSourceStage {
  readonly kind = 'silent';
  readonly output: GainNode;

  constructor(ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
  }

  dispose(): void {
    this.output.disconnect();
  }
}

export class VideoElementAudioSource implements AudioSourceStage {
  readonly kind = 'video';
  readonly output: MediaElementAudioSourceNode;

  constructor(ctx: AudioContext, video: HTMLVideoElement) {
    let ctxCache = mediaSourceCache.get(ctx);
    if (!ctxCache) {
      ctxCache = new WeakMap();
      mediaSourceCache.set(ctx, ctxCache);
    }
    const cached = ctxCache.get(video);
    if (cached) {
      this.output = cached;
      return;
    }
    this.output = ctx.createMediaElementSource(video);
    ctxCache.set(video, this.output);
  }

  // The output node is owned by the per-AudioContext WeakMap cache for the
  // lifetime of the AudioContext (createMediaElementSource cannot be called
  // twice for the same <video>). Disconnecting here is a bug: AudioEngine.setSource
  // already disconnects old.output BEFORE swapping, and the new wrapper shares
  // the same cached node — so the old wrapper's dispose() would re-disconnect
  // it AFTER #rewire() had reconnected it, leaving the chain silent on a
  // stop → restart cycle.
  dispose(): void {}
}
