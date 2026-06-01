import frag from '../video/shaders/retroDisplay.frag?raw';
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

class RetroDisplayVideoStage implements VideoStage {
  readonly op = 'retroDisplay';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevFrame: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uScanlines: WebGLUniformLocation;
  #uMask: WebGLUniformLocation;
  #uWarp: WebGLUniformLocation;
  #uBleed: WebGLUniformLocation;
  #uPhosphor: WebGLUniformLocation;
  #uNoise: WebGLUniformLocation;
  #uRoll: WebGLUniformLocation;
  #uVhsDist: WebGLUniformLocation;
  #uVhsTape: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'retroDisplay');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'retroDisplay');
    this.#uPrevFrame = reqUniform(gl, this.program, 'u_prev_frame', 'retroDisplay');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'retroDisplay');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'retroDisplay');
    this.#uScanlines = reqUniform(gl, this.program, 'u_scanlines', 'retroDisplay');
    this.#uMask = reqUniform(gl, this.program, 'u_mask', 'retroDisplay');
    this.#uWarp = reqUniform(gl, this.program, 'u_warp', 'retroDisplay');
    this.#uBleed = reqUniform(gl, this.program, 'u_bleed', 'retroDisplay');
    this.#uPhosphor = reqUniform(gl, this.program, 'u_phosphor', 'retroDisplay');
    this.#uNoise = reqUniform(gl, this.program, 'u_noise', 'retroDisplay');
    this.#uRoll = reqUniform(gl, this.program, 'u_roll', 'retroDisplay');
    this.#uVhsDist = reqUniform(gl, this.program, 'u_vhs_dist', 'retroDisplay');
    this.#uVhsTape = reqUniform(gl, this.program, 'u_vhs_tape', 'retroDisplay');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'retroDisplay');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const size = resources.temporalHistory ?? resources.structureAnalysis ?? resources.motionField;
    gl.uniform2f(this.#uResolution, size?.width ?? 1, size?.height ?? 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrevFrame, 1);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uScanlines, params['scanlines'] ?? 0.65);
    gl.uniform1f(this.#uMask, params['mask'] ?? 0.45);
    gl.uniform1f(this.#uWarp, params['warp'] ?? 0.16);
    gl.uniform1f(this.#uBleed, params['bleed'] ?? 0.3);
    gl.uniform1f(this.#uPhosphor, params['phosphor'] ?? 0.3);
    gl.uniform1f(this.#uNoise, params['noise'] ?? 0.12);
    gl.uniform1f(this.#uRoll, params['roll'] ?? 0);
    gl.uniform1f(this.#uVhsDist, params['vhsDist'] ?? 0);
    gl.uniform1f(this.#uVhsTape, params['vhsTape'] ?? 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const retroDisplayDef: OperatorDef = {
  op: 'retroDisplay',
  paramOrder: ['mix', 'scanlines', 'mask', 'warp', 'bleed', 'phosphor', 'noise', 'roll', 'vhsDist', 'vhsTape'],
  defaults: {
    mix: 0,
    scanlines: 0.65,
    mask: 0.45,
    warp: 0.16,
    bleed: 0.3,
    phosphor: 0.3,
    noise: 0.12,
    roll: 0,
    vhsDist: 0,
    vhsTape: 0,
  },
  coupling: {
    op: 'retroDisplay',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-display blend; 0 is bypass'),
      scanlines: param('scanlines', 'scanlines', [0, 1], 0.65, 'vertical beam shading strength'),
      mask: param('mask', 'mask', [0, 1], 0.45, 'RGB triad mask visibility'),
      warp: param('warp', 'warp', [0, 1], 0.16, 'screen curvature and edge squeeze'),
      bleed: param('bleed', 'bleed', [0, 1], 0.3, 'horizontal channel smear'),
      phosphor: param('phosphor', 'phosphor', [0, 1], 0.3, 'glow and previous-frame persistence'),
      noise: param('noise', 'noise', [0, 1], 0.12, 'display hiss and phosphor grain'),
      roll: param('roll', 'roll', [-1, 1], 0, 'vertical roll speed'),
      vhsDist: param('vhsDist', 'vhs dist', [0, 1], 0, 'VHS horizontal scan-line distortion and vertical roll artifacts'),
      vhsTape: param('vhsTape', 'vhs tape', [0, 1], 0, 'tape wave, crease, switching noise at bottom edge, chroma bloom, and AC beat'),
    },
  },
  createVideoStage(gl) {
    return new RetroDisplayVideoStage(gl);
  },
};
