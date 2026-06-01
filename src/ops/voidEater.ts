import frag from '../video/shaders/voidEater.frag?raw';
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
  curve: ParamSpec['curve'],
  hint: string,
) {
  return passthroughParam({
    id,
    label,
    range,
    default: defaultValue,
    curve,
    unit: 'norm',
    hint,
  });
}

class VoidEaterVideoStage implements VideoStage {
  readonly op = 'voidEater';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uOwnedState: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uStateInitialized: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uFeedback: WebGLUniformLocation;
  #uEdgeGain: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uGrowth: WebGLUniformLocation;
  #uSpread: WebGLUniformLocation;
  #uDecay: WebGLUniformLocation;
  #uInk: WebGLUniformLocation;
  #uTwirl: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uPixelSnap: WebGLUniformLocation;
  #uHardness: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'voidEater');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'voidEater');
    this.#uOwnedState = reqUniform(gl, this.program, 'u_owned_state', 'voidEater');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'voidEater');
    this.#uStateInitialized = reqUniform(gl, this.program, 'u_state_initialized', 'voidEater');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'voidEater');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'voidEater');
    this.#uFeedback = reqUniform(gl, this.program, 'u_feedback', 'voidEater');
    this.#uEdgeGain = reqUniform(gl, this.program, 'u_edge_gain', 'voidEater');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'voidEater');
    this.#uGrowth = reqUniform(gl, this.program, 'u_growth', 'voidEater');
    this.#uSpread = reqUniform(gl, this.program, 'u_spread', 'voidEater');
    this.#uDecay = reqUniform(gl, this.program, 'u_decay', 'voidEater');
    this.#uInk = reqUniform(gl, this.program, 'u_ink', 'voidEater');
    this.#uTwirl = reqUniform(gl, this.program, 'u_twirl', 'voidEater');
    this.#uRadius = reqUniform(gl, this.program, 'u_radius', 'voidEater');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'voidEater');
    this.#uPixelSnap = reqUniform(gl, this.program, 'u_pixel_snap', 'voidEater');
    this.#uHardness = reqUniform(gl, this.program, 'u_hardness', 'voidEater');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const owned = resources.ownedState;
    if (owned) {
      gl.uniform1i(this.#uOwnedState, owned.textureUnit);
      gl.uniform2f(this.#uResolution, owned.width, owned.height);
      gl.uniform1f(this.#uStateInitialized, owned.initialized ? 1.0 : 0.0);
    } else {
      gl.uniform1i(this.#uOwnedState, 6);
      gl.uniform2f(this.#uResolution, 1, 1);
      gl.uniform1f(this.#uStateInitialized, 0.0);
    }
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uFeedback, Math.min(0.98, Math.max(0, params['feedback'] ?? 0.86)));
    gl.uniform1f(this.#uEdgeGain, Math.max(0, params['edgeGain'] ?? 3));
    gl.uniform1f(this.#uThreshold, Math.min(1, Math.max(0, params['threshold'] ?? 0.32)));
    gl.uniform1f(this.#uGrowth, Math.min(1, Math.max(0, params['growth'] ?? 0.28)));
    gl.uniform1f(this.#uSpread, Math.min(1, Math.max(0, params['spread'] ?? 0.35)));
    gl.uniform1f(this.#uDecay, Math.min(0.2, Math.max(0, params['decay'] ?? 0.015)));
    gl.uniform1f(this.#uInk, Math.min(1, Math.max(0, params['ink'] ?? 0.9)));
    gl.uniform1f(this.#uTwirl, params['twirl'] ?? 0.35);
    gl.uniform1f(this.#uRadius, Math.max(0.05, params['radius'] ?? 0.8));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uPixelSnap, Math.min(1, Math.max(0, params['pixelSnap'] ?? 0)));
    gl.uniform1f(this.#uHardness, Math.min(1, Math.max(0, params['hardness'] ?? 0.35)));
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const voidEaterDef: OperatorDef = {
  op: 'voidEater',
  ownedState: {
    uniform: 'u_owned_state',
  },
  paramOrder: [
    'mix',
    'feedback',
    'edgeGain',
    'threshold',
    'growth',
    'spread',
    'decay',
    'ink',
    'twirl',
    'radius',
    'centerX',
    'centerY',
    'pixelSnap',
    'hardness',
  ],
  defaults: {
    mix: 0,
    feedback: 0.86,
    edgeGain: 3,
    threshold: 0.32,
    growth: 0.28,
    spread: 0.35,
    decay: 0.015,
    ink: 0.9,
    twirl: 0.35,
    radius: 0.8,
    centerX: 0.5,
    centerY: 0.5,
    pixelSnap: 0,
    hardness: 0.35,
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
      mix: param('mix', 'mix', [0, 1], 0, 'lin', 'dry-to-void blend; 0 is bypass'),
      feedback: param(
        'feedback',
        'feedback',
        [0, 0.98],
        0.86,
        'lin',
        'how much warped owned-state recirculates before the void mask bites into it',
      ),
      edgeGain: param(
        'edgeGain',
        'edge gain',
        [0, 8],
        3,
        'lin',
        'gain on the Sobel/luma edge seed before thresholding into black erosion',
      ),
      threshold: param(
        'threshold',
        'threshold',
        [0, 1],
        0.32,
        'lin',
        'minimum edge response required to seed new void growth',
      ),
      growth: param(
        'growth',
        'growth',
        [0, 1],
        0.28,
        'lin',
        'strength of new edge-seeded blackness injected into the owned-state mask',
      ),
      spread: param(
        'spread',
        'spread',
        [0, 1],
        0.35,
        'lin',
        'neighbourhood dilation of existing blackness across the feedback state',
      ),
      decay: param(
        'decay',
        'decay',
        [0, 0.2],
        0.015,
        'lin',
        'recovery amount per frame; higher values let live image reclaim the void',
      ),
      ink: param(
        'ink',
        'ink',
        [0, 1],
        0.9,
        'lin',
        'how fully the void mask writes to black once it has accumulated',
      ),
      twirl: param(
        'twirl',
        'twirl',
        [-2, 2],
        0.35,
        'lin',
        'signed feedback vortex amount around the operator centre',
      ),
      radius: param(
        'radius',
        'radius',
        [0.05, 2],
        0.8,
        'lin',
        'reach of the twirl field before the owned-state falls back to a straight sample',
      ),
      centerX: param('centerX', 'center x', [0, 1], 0.5, 'lin', 'horizontal void origin'),
      centerY: param('centerY', 'center y', [0, 1], 0.5, 'lin', 'vertical void origin'),
      pixelSnap: param(
        'pixelSnap',
        'pixel snap',
        [0, 1],
        0,
        'lin',
        'quantises the warped feedback sample to the output pixel grid for blockier inputs',
      ),
      hardness: param(
        'hardness',
        'hardness',
        [0, 1],
        0.35,
        'lin',
        'sharpens thresholding and mask edges so the void can read crisply on pixel art',
      ),
    },
  },
  createVideoStage(gl) {
    return new VoidEaterVideoStage(gl);
  },
};
