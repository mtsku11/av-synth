import frag from '../video/shaders/voidEater.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import { compileProgram, reqUniform } from '../video/glsl';
import { passthroughParam } from './shared';

function p(
  id: string,
  label: string,
  range: readonly [number, number],
  def: number,
  hint: string,
) {
  return passthroughParam({ id, label, range, default: def, curve: 'lin', unit: 'norm', hint });
}

class VoidEaterVideoStage implements VideoStage {
  readonly op = 'voidEater';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevDye: WebGLUniformLocation;
  #uPrevVel: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uTwirl: WebGLUniformLocation;
  #uSink: WebGLUniformLocation;
  #uPixelSize: WebGLUniformLocation;
  #uInject: WebGLUniformLocation;
  #uTrail: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program     = compileProgram(gl, frag, 'voidEater');
    this.#uTex       = reqUniform(gl, this.program, 'u_tex',        'voidEater');
    this.#uPrevDye   = reqUniform(gl, this.program, 'u_prev_dye',   'voidEater');
    this.#uPrevVel   = reqUniform(gl, this.program, 'u_prev_vel',   'voidEater');
    this.#uResolution= reqUniform(gl, this.program, 'u_resolution', 'voidEater');
    this.#uMix       = reqUniform(gl, this.program, 'u_mix',        'voidEater');
    this.#uTwirl     = reqUniform(gl, this.program, 'u_twirl',      'voidEater');
    this.#uSink      = reqUniform(gl, this.program, 'u_sink',       'voidEater');
    this.#uPixelSize = reqUniform(gl, this.program, 'u_pixel_size', 'voidEater');
    this.#uInject    = reqUniform(gl, this.program, 'u_inject',     'voidEater');
    this.#uTrail     = reqUniform(gl, this.program, 'u_trail',      'voidEater');
    this.#uScale     = reqUniform(gl, this.program, 'u_scale',      'voidEater');
    this.#uRadius    = reqUniform(gl, this.program, 'u_radius',     'voidEater');
    this.#uCenter    = reqUniform(gl, this.program, 'u_center',     'voidEater');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const owned = resources.ownedState;
    gl.uniform2f(
      this.#uResolution,
      owned?.width  ?? 1,
      owned?.height ?? 1,
    );
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,     0); // TEXTURE0: live video
    gl.uniform1i(this.#uPrevDye, 1); // TEXTURE1: previous dye (ownedState, bindAsPrevFrame)
    gl.uniform1i(this.#uPrevVel, 7); // TEXTURE7: previous velocity (ownedState2)
    gl.uniform1f(this.#uMix,       params['mix']       ?? 0);
    gl.uniform1f(this.#uTwirl,     params['twirl']     ?? 1.2);
    gl.uniform1f(this.#uSink,      params['sink']      ?? 0.15);
    gl.uniform1f(this.#uPixelSize, Math.max(1, params['pixelSize'] ?? 12));
    gl.uniform1f(this.#uInject,    params['inject']    ?? 0.1);
    gl.uniform1f(this.#uTrail,     params['trail']     ?? 0.95);
    gl.uniform1f(this.#uScale,     Math.max(0.5, params['scale'] ?? 4.0));
    gl.uniform1f(this.#uRadius,    Math.max(0.05, params['radius'] ?? 0.55));
    gl.uniform2f(this.#uCenter,    params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const voidEaterDef: OperatorDef = {
  op: 'voidEater',
  // Dye buffer — primed from source, bindAsPrevFrame binds it to TEXTURE1.
  ownedState: { uniform: 'u_prev_dye', bindAsPrevFrame: true },
  // Velocity buffer — cleared to rest (0.5, 0.5, 0, 1) by the renderer.
  ownedState2: { uniform: 'u_prev_vel' },
  paramOrder: ['mix', 'twirl', 'sink', 'pixelSize', 'inject', 'trail', 'scale', 'radius', 'centerX', 'centerY'],
  defaults: {
    mix: 0,
    twirl: 1.2,
    sink: 0.15,
    pixelSize: 12,
    inject: 0.1,
    trail: 0.95,
    scale: 4.0,
    radius: 0.55,
    centerX: 0.5,
    centerY: 0.5,
  },
  audit: {
    shaderPath: 'src/video/shaders/voidEater.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-void-eater-video-sweep'],
    qaCoverage: 'dedicated',
  },
  coupling: {
    op: 'voidEater',
    params: {
      mix:       p('mix',       'mix',       [0, 1],    0,    'dry/wet — 0 is full bypass, velocity still evolves'),
      twirl:     p('twirl',     'twirl',     [-2, 2],   1.2,  'vortex rotation speed and direction (+ = CCW, − = CW)'),
      sink:      p('sink',      'sink',      [0, 1],    0.15, 'inward radial pull — combine with twirl for a drain spiral'),
      pixelSize: p('pixelSize', 'pixel size',[1, 64],   12,   'quantization block size in pixels — larger = chunkier blocks'),
      inject:    p('inject',    'inject',    [0, 1],    0.1,  'rate at which fresh source pixels enter the dye — lower = spiral stays visible longer'),
      trail:     p('trail',     'trail',     [0, 1],    0.95, 'dye persistence — 1.0 = no decay, 0.0 = 2% decay per frame'),
      scale:     p('scale',     'scale',     [0.5, 12], 4.0,  'advection spatial scale — larger = faster, more dramatic spiral'),
      radius:    p('radius',    'radius',    [0.05, 1.5],0.55,'vortex field envelope radius'),
      centerX:   p('centerX',   'center x',  [0, 1],    0.5,  'vortex horizontal position'),
      centerY:   p('centerY',   'center y',  [0, 1],    0.5,  'vortex vertical position'),
    },
  },
  createVideoStage(gl) {
    return new VoidEaterVideoStage(gl);
  },
};
