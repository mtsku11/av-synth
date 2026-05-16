// Audio sources. Mirror of src/video/sources.ts: provides an AudioNode to
// feed the operator chain. By default we have no source (silent); loading a
// video file creates a VideoElementAudioSource that taps the same <video>
// element the renderer is reading.

import type { CouplingContext } from '../core/coupling';

export interface AudioSourceStage {
  readonly kind: string;
  readonly output: AudioNode;
  /**
   * Procedural sources (osc, noise, …) read parameter values and the global
   * coupling context here. Input sources (silent, video element) have no
   * params and can omit this. Called from the audio engine's poll.
   */
  setParams?(
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void;
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
    this.output = ctx.createMediaElementSource(video);
  }

  dispose(): void {
    this.output.disconnect();
  }
}
