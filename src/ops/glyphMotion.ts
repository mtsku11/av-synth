import frag from '../video/shaders/glyphMotion.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';
import { passthroughParam } from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  hint: string,
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve: 'lin',
    unit: 'norm',
    hint,
  };
  return passthroughParam(spec);
}

class GlyphMotionVideoStage implements VideoStage {
  readonly op = 'glyphMotion';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMotionTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uAudioBands: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uCellSize: WebGLUniformLocation;
  #uBassPush: WebGLUniformLocation;
  #uMidRotate: WebGLUniformLocation;
  #uHighJitter: WebGLUniformLocation;
  #uDecay: WebGLUniformLocation;
  #uRing: WebGLUniformLocation;
  #uMotionAmount: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'glyphMotion');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'glyphMotion');
    this.#uMotionTex = reqUniform(gl, this.program, 'u_motion_tex', 'glyphMotion');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'glyphMotion');
    this.#uAudioBands = reqUniform(gl, this.program, 'u_audio_bands', 'glyphMotion');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'glyphMotion');
    this.#uCellSize = reqUniform(gl, this.program, 'u_cell_size', 'glyphMotion');
    this.#uBassPush = reqUniform(gl, this.program, 'u_bass_push', 'glyphMotion');
    this.#uMidRotate = reqUniform(gl, this.program, 'u_mid_rotate', 'glyphMotion');
    this.#uHighJitter = reqUniform(gl, this.program, 'u_high_jitter', 'glyphMotion');
    this.#uDecay = reqUniform(gl, this.program, 'u_decay', 'glyphMotion');
    this.#uRing = reqUniform(gl, this.program, 'u_ring', 'glyphMotion');
    this.#uMotionAmount = reqUniform(gl, this.program, 'u_motion_amount', 'glyphMotion');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'glyphMotion');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const size = resources.temporalHistory ?? resources.structureAnalysis;
    gl.uniform2f(this.#uResolution, size?.width ?? 1, size?.height ?? 1);
    gl.uniform1i(this.#uMotionTex, resources.motionField?.textureUnit ?? 5);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform3f(this.#uAudioBands, ctx.audioBands.bass, ctx.audioBands.mid, ctx.audioBands.high);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uCellSize, params['cellSize'] ?? 14);
    gl.uniform1f(this.#uBassPush, params['bassPush'] ?? 0.42);
    gl.uniform1f(this.#uMidRotate, params['midRotate'] ?? 0.28);
    gl.uniform1f(this.#uHighJitter, params['highJitter'] ?? 0.2);
    gl.uniform1f(this.#uDecay, params['decay'] ?? 0.58);
    gl.uniform1f(this.#uRing, params['ring'] ?? 0.32);
    gl.uniform1f(this.#uMotionAmount, params['motionAmount'] ?? 0.4);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const glyphMotionDef: OperatorDef = {
  op: 'glyphMotion',
  paramOrder: [
    'mix',
    'cellSize',
    'bassPush',
    'midRotate',
    'highJitter',
    'decay',
    'ring',
    'motionAmount',
  ],
  defaults: {
    mix: 0,
    cellSize: 14,
    bassPush: 0.42,
    midRotate: 0.28,
    highJitter: 0.2,
    decay: 0.58,
    ring: 0.32,
    motionAmount: 0.4,
  },
  coupling: {
    op: 'glyphMotion',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-cell-motion blend; 0 is bypass'),
      cellSize: param('cellSize', 'cell size', [4, 64], 14, 'motion-cell width in output pixels'),
      bassPush: param(
        'bassPush',
        'bass push',
        [0, 2],
        0.42,
        'radial cell displacement from bass energy',
      ),
      midRotate: param(
        'midRotate',
        'mid rotate',
        [0, 2],
        0.28,
        'per-cell rotation from mid-band energy',
      ),
      highJitter: param(
        'highJitter',
        'high jitter',
        [0, 2],
        0.2,
        'stepped cell jitter from high-band energy',
      ),
      decay: param(
        'decay',
        'decay',
        [0, 1],
        0.58,
        'how quickly the lightweight ring envelope falls away',
      ),
      ring: param(
        'ring',
        'ring',
        [0, 1],
        0.32,
        'oscillatory bounce layered onto cell rotation and push',
      ),
      motionAmount: param(
        'motionAmount',
        'motion amount',
        [0, 2],
        0.4,
        'cell displacement from the shared low-resolution motion field',
      ),
    },
  },
  createVideoStage(gl) {
    return new GlyphMotionVideoStage(gl);
  },
};
