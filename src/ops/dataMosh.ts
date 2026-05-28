import frag from '../video/shaders/dataMosh.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class DataMoshVideoStage implements VideoStage {
  readonly op = 'dataMosh';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uOwnedState: WebGLUniformLocation;
  #uMotionTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uMotionResolution: WebGLUniformLocation;
  #uStateInitialized: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uDecay: WebGLUniformLocation;
  #uChunk: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'dataMosh');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'dataMosh');
    this.#uOwnedState = reqUniform(gl, this.program, 'u_owned_state', 'dataMosh');
    this.#uMotionTex = reqUniform(gl, this.program, 'u_motion_tex', 'dataMosh');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'dataMosh');
    this.#uMotionResolution = reqUniform(gl, this.program, 'u_motion_resolution', 'dataMosh');
    this.#uStateInitialized = reqUniform(gl, this.program, 'u_state_initialized', 'dataMosh');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'dataMosh');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'dataMosh');
    this.#uDecay = reqUniform(gl, this.program, 'u_decay', 'dataMosh');
    this.#uChunk = reqUniform(gl, this.program, 'u_chunk', 'dataMosh');
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

    const motion = resources.motionField;
    if (motion) {
      gl.uniform1i(this.#uMotionTex, motion.textureUnit);
      gl.uniform2f(this.#uMotionResolution, motion.width, motion.height);
    } else {
      gl.uniform1i(this.#uMotionTex, 5);
      gl.uniform2f(this.#uMotionResolution, 1, 1);
    }
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uDrift, params['drift'] ?? 0.55);
    gl.uniform1f(this.#uDecay, params['decay'] ?? 0.05);
    gl.uniform1f(this.#uChunk, params['chunk'] ?? 0.45);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const dataMoshDef: OperatorDef = {
  op: 'dataMosh',
  paramOrder: ['mix', 'drift', 'decay', 'chunk'],
  defaults: { mix: 0, drift: 0.55, decay: 0.05, chunk: 0.45 },
  ownedState: {
    uniform: 'u_owned_state',
  },
  coupling: {
    op: 'dataMosh',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-mosh blend; 0 is bypass, 1 is full datamosh',
        },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: {
          id: 'drift',
          label: 'drift',
          range: [0, 2],
          default: 0.55,
          curve: 'lin',
          unit: 'norm',
          hint: 'how far pixels slide along motion vectors each frame; 0 freezes the accumulator',
        },
        toVideo: (raw) => raw,
      },
      decay: {
        spec: {
          id: 'decay',
          label: 'decay',
          range: [0, 0.5],
          default: 0.05,
          curve: 'lin',
          unit: 'norm',
          hint: 'fraction of live video blended in each frame; 0 = infinite hold, 0.1 = fades in ~10 frames',
        },
        toVideo: (raw) => raw,
      },
      chunk: {
        spec: {
          id: 'chunk',
          label: 'chunk',
          range: [0, 1],
          default: 0.45,
          curve: 'lin',
          unit: 'norm',
          hint: 'macroblock quantisation of motion vectors — higher gives a blockier codec-smear feel',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new DataMoshVideoStage(gl);
  },
};
