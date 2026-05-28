// Grain buffer — pre-decoded video frames stored as a WebGL2 TEXTURE_2D_ARRAY for the
// granulator's video grain twin (spec §9). Decode-on-load only; WebCodecs streaming is
// deferred to the Electron + WebGPU desktop phase per spec §16.
//
// Sizing policy: clips are clamped to a 720p long edge before decode, then the resulting
// RGBA8 byte cost is checked against a hard 1.5 GB cap. Over-cap clips are refused with
// a clear, user-facing reason — never partially decoded, never silently downsampled, never
// frame-dropped behind the user's back (spec §9 user-facing load rule).
//
// Upload path: layer-by-layer texSubImage3D from a sized 2D canvas. The video is seeked to
// each target frame time and drawn into the canvas at clamped dimensions before upload.
// Slow but functional — the spec only requires that the static-array upload path works in
// this step; the compositor that samples the array is spec §15 step 6.

export const GRAIN_BUFFER_MAX_BYTES = 1610612736; // 1.5 * 1024^3, hard cap per spec §9
export const GRAIN_BUFFER_MAX_EDGE = 720; // clamp-to-720p long edge per spec §9

export interface GrainBufferPlan {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly fps: number;
  readonly durationSec: number;
  readonly bytes: number;
}

export type GrainBufferPlanResult =
  | { readonly ok: true; readonly plan: GrainBufferPlan }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly estimatedBytes: number;
      readonly capBytes: number;
      readonly clampedWidth: number;
      readonly clampedHeight: number;
      readonly frameCount: number;
    };

export interface GrainBufferPlanInput {
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly durationSec: number;
  readonly fps: number;
}

export function clampDimensionsTo720p(
  srcWidth: number,
  srcHeight: number,
): { width: number; height: number } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`grain-buffer: invalid source dimensions ${srcWidth}x${srcHeight}`);
  }
  const longEdge = Math.max(srcWidth, srcHeight);
  if (longEdge <= GRAIN_BUFFER_MAX_EDGE) {
    return { width: Math.round(srcWidth), height: Math.round(srcHeight) };
  }
  const scale = GRAIN_BUFFER_MAX_EDGE / longEdge;
  // Round to even to keep YUV-friendly dimensions and avoid 1-px aspect drift.
  const width = Math.max(2, Math.round((srcWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round((srcHeight * scale) / 2) * 2);
  return { width, height };
}

export function estimateBytes(width: number, height: number, frameCount: number): number {
  return width * height * 4 * frameCount;
}

export function planGrainBuffer(input: GrainBufferPlanInput): GrainBufferPlanResult {
  const { srcWidth, srcHeight, durationSec, fps } = input;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return {
      ok: false,
      reason: `Invalid duration ${durationSec}s. Load a clip with a known, positive duration.`,
      estimatedBytes: 0,
      capBytes: GRAIN_BUFFER_MAX_BYTES,
      clampedWidth: 0,
      clampedHeight: 0,
      frameCount: 0,
    };
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    return {
      ok: false,
      reason: `Invalid frame rate ${fps} fps. Load a clip with a known, positive frame rate.`,
      estimatedBytes: 0,
      capBytes: GRAIN_BUFFER_MAX_BYTES,
      clampedWidth: 0,
      clampedHeight: 0,
      frameCount: 0,
    };
  }

  const { width, height } = clampDimensionsTo720p(srcWidth, srcHeight);
  const frameCount = Math.max(1, Math.ceil(durationSec * fps));
  const bytes = estimateBytes(width, height, frameCount);

  if (bytes > GRAIN_BUFFER_MAX_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(0);
    const capMb = (GRAIN_BUFFER_MAX_BYTES / (1024 * 1024)).toFixed(0);
    const secondsAtCap = Math.floor(GRAIN_BUFFER_MAX_BYTES / Math.max(1, width * height * 4 * fps));
    return {
      ok: false,
      reason:
        `Clip too large for the grain buffer (≈${mb} MB at ${width}×${height}, ${frameCount} frames; cap ${capMb} MB). ` +
        `At this resolution and frame rate, the browser build accepts up to about ${secondsAtCap}s. ` +
        `Trim the clip or load a smaller source.`,
      estimatedBytes: bytes,
      capBytes: GRAIN_BUFFER_MAX_BYTES,
      clampedWidth: width,
      clampedHeight: height,
      frameCount,
    };
  }

  return {
    ok: true,
    plan: { width, height, frameCount, fps, durationSec, bytes },
  };
}

interface SeekableVideoLike {
  currentTime: number;
  readyState: number;
  addEventListener(type: 'seeked' | 'error', cb: () => void): void;
  removeEventListener(type: 'seeked' | 'error', cb: () => void): void;
}

function waitForSeek(video: SeekableVideoLike, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = (): void => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = (): void => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`grain-buffer: video error while seeking to ${time}s`));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

export interface DecodeProgress {
  readonly frameIndex: number;
  readonly frameCount: number;
}

export class GrainBuffer {
  readonly texture: WebGLTexture;
  #width = 0;
  #height = 0;
  #frameCount = 0;
  #fps = 0;
  #durationSec = 0;
  #allocated = false;
  #disposed = false;

  constructor(gl: WebGL2RenderingContext) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('grain-buffer: failed to allocate texture');
    this.texture = tex;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  static plan(input: GrainBufferPlanInput): GrainBufferPlanResult {
    return planGrainBuffer(input);
  }

  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  get frameCount(): number {
    return this.#frameCount;
  }
  get fps(): number {
    return this.#fps;
  }
  get durationSec(): number {
    return this.#durationSec;
  }
  get isAllocated(): boolean {
    return this.#allocated;
  }

  allocate(gl: WebGL2RenderingContext, plan: GrainBufferPlan): void {
    if (this.#disposed) throw new Error('grain-buffer: disposed');
    if (this.#allocated) {
      throw new Error('grain-buffer: already allocated; create a new GrainBuffer instead');
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, plan.width, plan.height, plan.frameCount);
    this.#width = plan.width;
    this.#height = plan.height;
    this.#frameCount = plan.frameCount;
    this.#fps = plan.fps;
    this.#durationSec = plan.durationSec;
    this.#allocated = true;
  }

  async decodeFromVideo(
    gl: WebGL2RenderingContext,
    video: HTMLVideoElement,
    plan: GrainBufferPlan,
    onProgress?: (p: DecodeProgress) => void,
  ): Promise<void> {
    if (this.#disposed) throw new Error('grain-buffer: disposed');
    if (!this.#allocated) this.allocate(gl, plan);

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('grain-buffer: failed to acquire 2D canvas context');

    const frameDt = 1 / plan.fps;
    for (let i = 0; i < plan.frameCount; i++) {
      const t = Math.min(plan.durationSec - frameDt * 0.5, i * frameDt);
      await waitForSeek(video, t);
      ctx.drawImage(video, 0, 0, plan.width, plan.height);
      // Re-bind every iteration: the main renderer's raf loop runs during our
      // await above and replaces TEXTURE_2D_ARRAY binding. Without this rebind
      // texSubImage3D emits "no texture bound to target" and the upload silently
      // drops, leaving black frames in the grain buffer.
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        i,
        plan.width,
        plan.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvas,
      );
      onProgress?.({ frameIndex: i, frameCount: plan.frameCount });
    }
  }

  // Read the centre pixel from one frame layer via a temporary FBO.
  // x/y default to the texture centre. Returns null if not allocated.
  readFrameCenter(
    gl: WebGL2RenderingContext,
    frameIndex: number,
    x?: number,
    y?: number,
  ): { r: number; g: number; b: number } | null {
    if (!this.#allocated || frameIndex < 0 || frameIndex >= this.#frameCount) return null;
    const px = Math.floor(x ?? this.#width / 2);
    const py = Math.floor(y ?? this.#height / 2);
    const fbo = gl.createFramebuffer();
    if (!fbo) return null;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, 0, frameIndex);
    const buf = new Uint8Array(4);
    // The frame is a solid colour (grayscale ramp fixture), so y orientation is moot.
    // For general use: y=0 in a texSubImage3D upload with UNPACK_FLIP_Y=false maps to
    // the top row of the source image; framebuffer y=0 is the bottom — so flip:
    gl.readPixels(px, this.#height - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.deleteFramebuffer(fbo);
    if (err !== gl.NO_ERROR) return null;
    return { r: buf[0]!, g: buf[1]!, b: buf[2]! };
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.#disposed) return;
    this.#disposed = true;
    gl.deleteTexture(this.texture);
    this.#allocated = false;
  }
}
