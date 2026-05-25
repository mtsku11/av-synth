import frag from '../video/shaders/structure.frag?raw';
import type {
  AudioStage,
  OperatorDef,
  VideoStage,
  VideoStageRendererResources,
} from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class StructureVideoStage implements VideoStage {
  readonly op = 'structure';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevFrame: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uMode: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uSoftness: WebGLUniformLocation;
  #uDisplace: WebGLUniformLocation;
  #uMemory: WebGLUniformLocation;
  #uGlow: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'structure');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'structure');
    this.#uPrevFrame = reqUniform(gl, this.program, 'u_prev_frame', 'structure');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'structure');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'structure');
    this.#uMode = reqUniform(gl, this.program, 'u_mode', 'structure');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'structure');
    this.#uSoftness = reqUniform(gl, this.program, 'u_softness', 'structure');
    this.#uDisplace = reqUniform(gl, this.program, 'u_displace', 'structure');
    this.#uMemory = reqUniform(gl, this.program, 'u_memory', 'structure');
    this.#uGlow = reqUniform(gl, this.program, 'u_glow', 'structure');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const structure = resources.structureAnalysis;
    if (structure) {
      gl.uniform2f(this.#uResolution, structure.width, structure.height);
      return;
    }
    gl.uniform2f(this.#uResolution, 1, 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrevFrame, 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uMode, params['mode'] ?? 0.5);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.34);
    gl.uniform1f(this.#uSoftness, params['softness'] ?? 0.12);
    gl.uniform1f(this.#uDisplace, params['displace'] ?? 0.28);
    gl.uniform1f(this.#uMemory, params['memory'] ?? 0.32);
    gl.uniform1f(this.#uGlow, params['glow'] ?? 0.25);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class StructureAudioStage implements AudioStage {
  readonly op = 'structure';
  readonly input: GainNode;
  readonly output: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  setParams(_params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {}

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
  }
}

export const structureDef: OperatorDef = {
  op: 'structure',
  paramOrder: ['mix', 'mode', 'threshold', 'softness', 'displace', 'memory', 'glow'],
  defaults: {
    mix: 0,
    mode: 0.5,
    threshold: 0.34,
    softness: 0.12,
    displace: 0.28,
    memory: 0.32,
    glow: 0.25,
  },
  coupling: {
    op: 'structure',
    kind: 'fully-coupled',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-structure blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      mode: {
        spec: {
          id: 'mode',
          label: 'mode',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: '0 = luma mask, 0.5 = edge contour, 1 = motion residue/flux',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      threshold: {
        spec: {
          id: 'threshold',
          label: 'threshold',
          range: [0, 1],
          default: 0.34,
          curve: 'lin',
          unit: 'norm',
          hint: 'structure energy required before the effect opens up',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      softness: {
        spec: {
          id: 'softness',
          label: 'softness',
          range: [0.001, 0.5],
          default: 0.12,
          curve: 'lin',
          unit: 'norm',
          hint: 'soft edge on the structure mask',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      displace: {
        spec: {
          id: 'displace',
          label: 'displace',
          range: [0, 1],
          default: 0.28,
          curve: 'lin',
          unit: 'norm',
          hint: 'gradient-driven UV drift around the selected structure',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      memory: {
        spec: {
          id: 'memory',
          label: 'memory',
          range: [0, 1],
          default: 0.32,
          curve: 'lin',
          unit: 'norm',
          hint: 'how much previous-frame memory gets reinjected through the mask',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
      glow: {
        spec: {
          id: 'glow',
          label: 'glow',
          range: [0, 1],
          default: 0.25,
          curve: 'lin',
          unit: 'norm',
          hint: 'contour lift around edges and motion residue',
        },
        toVideo: (raw) => raw,
        toAudio: () => 0,
      },
    },
  },
  createVideoStage(gl) {
    return new StructureVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new StructureAudioStage(ctx);
  },
};
