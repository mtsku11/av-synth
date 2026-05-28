import frag from '../video/shaders/flow.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FlowVideoStage implements VideoStage {
  readonly op = 'flow';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevFrame: WebGLUniformLocation;
  #uMotionTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uMotionResolution: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uSmear: WebGLUniformLocation;
  #uMemory: WebGLUniformLocation;
  #uGate: WebGLUniformLocation;
  #uGlitch: WebGLUniformLocation;
  #uChroma: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'flow');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'flow');
    this.#uPrevFrame = reqUniform(gl, this.program, 'u_prev_frame', 'flow');
    this.#uMotionTex = reqUniform(gl, this.program, 'u_motion_tex', 'flow');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'flow');
    this.#uMotionResolution = reqUniform(gl, this.program, 'u_motion_resolution', 'flow');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'flow');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'flow');
    this.#uSmear = reqUniform(gl, this.program, 'u_smear', 'flow');
    this.#uMemory = reqUniform(gl, this.program, 'u_memory', 'flow');
    this.#uGate = reqUniform(gl, this.program, 'u_gate', 'flow');
    this.#uGlitch = reqUniform(gl, this.program, 'u_glitch', 'flow');
    this.#uChroma = reqUniform(gl, this.program, 'u_chroma', 'flow');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const stageResolution = resources.temporalHistory ?? resources.structureAnalysis;
    if (stageResolution)
      gl.uniform2f(this.#uResolution, stageResolution.width, stageResolution.height);
    else gl.uniform2f(this.#uResolution, 1, 1);

    const motion = resources.motionField;
    if (motion) {
      gl.uniform1i(this.#uMotionTex, motion.textureUnit);
      gl.uniform2f(this.#uMotionResolution, motion.width, motion.height);
      return;
    }
    gl.uniform1i(this.#uMotionTex, 5);
    gl.uniform2f(this.#uMotionResolution, 1, 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrevFrame, 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.56);
    gl.uniform1f(this.#uSmear, params['smear'] ?? 0.48);
    gl.uniform1f(this.#uMemory, params['memory'] ?? 0.58);
    gl.uniform1f(this.#uGate, params['gate'] ?? 0.18);
    gl.uniform1f(this.#uGlitch, params['glitch'] ?? 0.32);
    gl.uniform1f(this.#uChroma, params['chroma'] ?? 0.28);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const flowDef: OperatorDef = {
  op: 'flow',
  paramOrder: ['mix', 'strength', 'smear', 'memory', 'gate', 'glitch', 'chroma'],
  defaults: {
    mix: 0,
    strength: 0.56,
    smear: 0.48,
    memory: 0.58,
    gate: 0.18,
    glitch: 0.32,
    chroma: 0.28,
  },
  coupling: {
    op: 'flow',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-motion blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 1],
          default: 0.56,
          curve: 'lin',
          unit: 'norm',
          hint: 'how far the motion field pushes the current frame',
        },
        toVideo: (raw) => raw,
      },
      smear: {
        spec: {
          id: 'smear',
          label: 'smear',
          range: [0, 1],
          default: 0.48,
          curve: 'lin',
          unit: 'norm',
          hint: 'directional drag along detected motion',
        },
        toVideo: (raw) => raw,
      },
      memory: {
        spec: {
          id: 'memory',
          label: 'memory',
          range: [0, 1],
          default: 0.58,
          curve: 'lin',
          unit: 'norm',
          hint: 'how strongly the previous frame re-enters the motion smear',
        },
        toVideo: (raw) => raw,
      },
      gate: {
        spec: {
          id: 'gate',
          label: 'gate',
          range: [0, 1],
          default: 0.18,
          curve: 'lin',
          unit: 'norm',
          hint: 'minimum motion energy required before the field opens up',
        },
        toVideo: (raw) => raw,
      },
      glitch: {
        spec: {
          id: 'glitch',
          label: 'glitch',
          range: [0, 1],
          default: 0.32,
          curve: 'lin',
          unit: 'norm',
          hint: 'blocky datamosh quantization on the motion samples',
        },
        toVideo: (raw) => raw,
      },
      chroma: {
        spec: {
          id: 'chroma',
          label: 'chroma',
          range: [0, 1],
          default: 0.28,
          curve: 'lin',
          unit: 'norm',
          hint: 'color-channel drift around the moving tear field',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FlowVideoStage(gl);
  },
};
