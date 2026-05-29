// Grain composite source (spec §15 step 6). Each active voice is drawn as a textured quad
// centered at (panX, panY) on the clip-space target, sampling the GrainBuffer's TEXTURE_2D_ARRAY
// at the voice's frame layer and alpha-modulated by the worklet-mirrored envelope LUT.
//
// Premultiplied "over" blending into an opaque (0,0,0,1) clear keeps the output in valid
// territory for the existing FX rack without requiring any chain changes downstream.

import compositeVs from './grain-composite.vert?raw';
import compositeFs from './grain-composite.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { GrainScheduler } from '../core/grain-scheduler';
import { GrainBuffer, type GrainBufferPlan } from './grain-buffer';
import type { VideoSourceStage } from './sources';

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('grain-composite: createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`grain-composite shader compile error: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('grain-composite: createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`grain-composite program link error: ${log}`);
  }
  return p;
}

// Per-instance VBO layout: [panX, panY, frameIndex, envelopeAlpha, amplitude] — 5 floats, 20 bytes/voice.
const INSTANCE_FLOATS = 5;
const INSTANCE_STRIDE = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 20

export interface GrainCompositeOptions {
  readonly clock: () => number;
  readonly halfSize?: number;
  readonly maxVoices?: number;
}

export class GrainCompositeSource implements VideoSourceStage {
  readonly kind = 'grain-composite';

  #program: WebGLProgram;
  #uHalfSize: WebGLUniformLocation;
  #uGrain: WebGLUniformLocation;
  #uUvScale: WebGLUniformLocation;
  #uSoftness: WebGLUniformLocation;
  #uDepth: WebGLUniformLocation;

  #vao: WebGLVertexArrayObject;
  #instanceVBO: WebGLBuffer;
  // Pre-allocated instance data buffer — written each frame, never reallocated.
  #instanceData: Float32Array;

  #buffer: GrainBuffer;
  #scheduler: GrainScheduler;
  #plan: GrainBufferPlan | null = null;
  #clock: () => number;
  #halfSize: number;
  #maxVoices: number;
  #disposed = false;
  #uvScale = 1.0;
  #aspectCorrect = false;
  #softness = 0.0;
  #additive = false;
  #depth = 0.0;
  /** When true, each voice renders at full-screen size centered at the origin
   * (halfSize=1, pan=0). Produces temporal crossfades instead of spatial scatter. */
  fullFrame = false;

  constructor(
    gl: WebGL2RenderingContext,
    buffer: GrainBuffer,
    scheduler: GrainScheduler,
    opts: GrainCompositeOptions,
  ) {
    this.#buffer = buffer;
    this.#scheduler = scheduler;
    this.#clock = opts.clock;
    this.#halfSize = opts.halfSize ?? 0.35;
    this.#maxVoices = opts.maxVoices ?? 64;

    const vs = compile(gl, gl.VERTEX_SHADER, compositeVs);
    const fs = compile(gl, gl.FRAGMENT_SHADER, compositeFs);
    this.#program = link(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const half = gl.getUniformLocation(this.#program, 'u_halfSize');
    const grain = gl.getUniformLocation(this.#program, 'u_grain');
    const uvScale = gl.getUniformLocation(this.#program, 'u_uvScale');
    const softness = gl.getUniformLocation(this.#program, 'u_softness');
    const depth = gl.getUniformLocation(this.#program, 'u_depth');
    if (!half || !grain || !uvScale || !softness || !depth) {
      throw new Error('grain-composite: missing uniform locations');
    }
    this.#uHalfSize = half;
    this.#uGrain = grain;
    this.#uUvScale = uvScale;
    this.#uSoftness = softness;
    this.#uDepth = depth;

    this.#instanceData = new Float32Array(this.#maxVoices * INSTANCE_FLOATS);

    const vbo = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!vbo || !vao) throw new Error('grain-composite: failed to create VAO/VBO');
    this.#instanceVBO = vbo;
    this.#vao = vao;

    // Set up the instance attribute layout inside the VAO.
    // layout(location=0): a_center    vec2  — offset  0, stride 20
    // layout(location=1): a_layer     float — offset  8, stride 20
    // layout(location=2): a_alpha     float — offset 12, stride 20
    // layout(location=3): a_amplitude float — offset 16, stride 20
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.#instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, INSTANCE_STRIDE, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, INSTANCE_STRIDE, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, INSTANCE_STRIDE, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, INSTANCE_STRIDE, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
  }

  setPlan(plan: GrainBufferPlan | null): void {
    this.#plan = plan;
  }

  get plan(): GrainBufferPlan | null {
    return this.#plan;
  }

  set halfSize(v: number) {
    this.#halfSize = v;
  }

  set uvScale(v: number) {
    this.#uvScale = v;
  }

  set aspectCorrect(v: boolean) {
    this.#aspectCorrect = v;
  }

  set softness(v: number) {
    this.#softness = v;
  }

  set additive(v: boolean) {
    this.#additive = v;
  }

  set depth(v: number) {
    this.#depth = v;
  }

  render(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const plan = this.#plan;
    if (!plan || !this.#buffer.isAllocated) return;

    const { voices, count } = this.#scheduler.getActiveVoices(this.#clock(), plan, this.#maxVoices);
    if (count === 0) return;

    // Fill instance data — zero-alloc write into pre-allocated Float32Array.
    const fullFrame = this.fullFrame;
    const depth = this.#depth;
    const data = this.#instanceData;
    for (let i = 0; i < count; i++) {
      const v = voices[i]!;
      const base = i * INSTANCE_FLOATS;
      data[base] = fullFrame ? 0 : v.panX;
      data[base + 1] = fullFrame ? 0 : v.panY;
      data[base + 2] = v.frameIndex;
      data[base + 3] = v.envelopeAlpha;
      data[base + 4] = v.amplitude;
    }

    // G6: back-to-front depth sort — quiet (small) grains draw first, loud on top.
    // In-place insertion sort on 5-float records, zero-alloc. Only when depth > 0.
    if (depth > 0) {
      const s = INSTANCE_FLOATS;
      for (let i = s; i < count * s; i += s) {
        const amp = data[i + 4]!;
        const cx = data[i]!, cy = data[i + 1]!, cl = data[i + 2]!, ca = data[i + 3]!;
        let j = i - s;
        while (j >= 0 && data[j + 4]! > amp) {
          data[j + s] = data[j]!;
          data[j + s + 1] = data[j + 1]!;
          data[j + s + 2] = data[j + 2]!;
          data[j + s + 3] = data[j + 3]!;
          data[j + s + 4] = data[j + 4]!;
          j -= s;
        }
        data[j + s] = cx;
        data[j + s + 1] = cy;
        data[j + s + 2] = cl;
        data[j + s + 3] = ca;
        data[j + s + 4] = amp;
      }
    }

    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#buffer.texture);
    gl.uniform1i(this.#uGrain, 0);

    const hs = fullFrame ? 1.0 : this.#halfSize;
    let hsX = hs;
    let hsY = hs;
    if (!fullFrame && this.#aspectCorrect && plan.width > 0 && plan.height > 0) {
      hsY = hs * (gl.drawingBufferWidth / gl.drawingBufferHeight) * (plan.height / plan.width);
    }
    gl.uniform2f(this.#uHalfSize, hsX, hsY);
    gl.uniform1f(this.#uUvScale, fullFrame ? 1.0 : this.#uvScale);
    gl.uniform1f(this.#uSoftness, this.#softness);
    gl.uniform1f(this.#uDepth, depth);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#instanceVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.enable(gl.BLEND);
    if (this.#additive) {
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.bindVertexArray(this.#vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.#disposed) return;
    this.#disposed = true;
    gl.deleteVertexArray(this.#vao);
    gl.deleteBuffer(this.#instanceVBO);
    gl.deleteProgram(this.#program);
  }
}
