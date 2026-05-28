import frag from '../video/shaders/timeDisplace.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class TimeDisplaceVideoStage implements VideoStage {
  readonly op = 'timeDisplace';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uHistoryTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uDepth: WebGLUniformLocation;
  #uScan: WebGLUniformLocation;
  #uSmear: WebGLUniformLocation;
  #uDecay: WebGLUniformLocation;
  #uHistoryCapacity: WebGLUniformLocation;
  #uHistoryValid: WebGLUniformLocation;
  #uHistoryWriteIndex: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'timeDisplace');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'timeDisplace');
    this.#uHistoryTex = reqUniform(gl, this.program, 'u_history_tex', 'timeDisplace');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'timeDisplace');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'timeDisplace');
    this.#uDepth = reqUniform(gl, this.program, 'u_depth', 'timeDisplace');
    this.#uScan = reqUniform(gl, this.program, 'u_scan', 'timeDisplace');
    this.#uSmear = reqUniform(gl, this.program, 'u_smear', 'timeDisplace');
    this.#uDecay = reqUniform(gl, this.program, 'u_decay', 'timeDisplace');
    this.#uHistoryCapacity = reqUniform(gl, this.program, 'u_history_capacity', 'timeDisplace');
    this.#uHistoryValid = reqUniform(gl, this.program, 'u_history_valid', 'timeDisplace');
    this.#uHistoryWriteIndex = reqUniform(
      gl,
      this.program,
      'u_history_write_index',
      'timeDisplace',
    );
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const temporal = resources.temporalHistory;
    if (temporal) {
      gl.uniform1i(this.#uHistoryTex, temporal.textureUnit);
      gl.uniform1f(this.#uHistoryCapacity, temporal.capacity);
      gl.uniform1f(this.#uHistoryValid, temporal.validCount);
      gl.uniform1f(this.#uHistoryWriteIndex, temporal.writeIndex);
      gl.uniform2f(this.#uResolution, temporal.width, temporal.height);
      return;
    }
    gl.uniform1i(this.#uHistoryTex, 3);
    gl.uniform1f(this.#uHistoryCapacity, 0);
    gl.uniform1f(this.#uHistoryValid, 0);
    gl.uniform1f(this.#uHistoryWriteIndex, 0);
    gl.uniform2f(this.#uResolution, 1, 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uDepth, params['depth'] ?? 0.4);
    gl.uniform1f(this.#uScan, params['scan'] ?? 0.5);
    gl.uniform1f(this.#uSmear, params['smear'] ?? 0.25);
    gl.uniform1f(this.#uDecay, params['decay'] ?? 0.5);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const timeDisplaceDef: OperatorDef = {
  op: 'timeDisplace',
  paramOrder: ['mix', 'depth', 'scan', 'smear', 'decay'],
  defaults: {
    mix: 0,
    depth: 0.42,
    scan: 0.5,
    smear: 0.26,
    decay: 0.55,
  },
  coupling: {
    op: 'timeDisplace',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-history blend on the video side; audio path stays neutral',
        },
        toVideo: (raw) => raw,
      },
      depth: {
        spec: {
          id: 'depth',
          label: 'depth',
          range: [0, 1],
          default: 0.42,
          curve: 'lin',
          unit: 'norm',
          hint: 'maximum temporal lookback through the shared frame-history ring',
        },
        toVideo: (raw) => raw,
      },
      scan: {
        spec: {
          id: 'scan',
          label: 'scan',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: '0 = vertical slit-scan indexing, 1 = luma-driven time displacement',
        },
        toVideo: (raw) => raw,
      },
      smear: {
        spec: {
          id: 'smear',
          label: 'smear',
          range: [0, 1],
          default: 0.26,
          curve: 'lin',
          unit: 'norm',
          hint: 'temporal combing and motion-directed UV drift',
        },
        toVideo: (raw) => raw,
      },
      decay: {
        spec: {
          id: 'decay',
          label: 'decay',
          range: [0, 1],
          default: 0.55,
          curve: 'lin',
          unit: 'norm',
          hint: 'how strongly older history frames fade before they re-enter the image',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new TimeDisplaceVideoStage(gl);
  },
};
