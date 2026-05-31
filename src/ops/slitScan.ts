import frag from '../video/shaders/slitScan.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SlitScanVideoStage implements VideoStage {
  readonly op = 'slitScan';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uHistoryTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uDepth: WebGLUniformLocation;
  #uOrientation: WebGLUniformLocation;
  #uSlitX: WebGLUniformLocation;
  #uSlitY: WebGLUniformLocation;
  #uScanSpeed: WebGLUniformLocation;
  #uDelayAmount: WebGLUniformLocation;
  #uSmearWidth: WebGLUniformLocation;
  #uFeedbackBlend: WebGLUniformLocation;
  #uDirection: WebGLUniformLocation;
  #uStrobe: WebGLUniformLocation;
  #uHistoryCapacity: WebGLUniformLocation;
  #uHistoryValid: WebGLUniformLocation;
  #uHistoryWriteIndex: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'slitScan');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'slitScan');
    this.#uHistoryTex = reqUniform(gl, this.program, 'u_history_tex', 'slitScan');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'slitScan');
    this.#uDepth = reqUniform(gl, this.program, 'u_depth', 'slitScan');
    this.#uOrientation = reqUniform(gl, this.program, 'u_orientation', 'slitScan');
    this.#uSlitX = reqUniform(gl, this.program, 'u_slit_x', 'slitScan');
    this.#uSlitY = reqUniform(gl, this.program, 'u_slit_y', 'slitScan');
    this.#uScanSpeed = reqUniform(gl, this.program, 'u_scan_speed', 'slitScan');
    this.#uDelayAmount = reqUniform(gl, this.program, 'u_delay_amount', 'slitScan');
    this.#uSmearWidth = reqUniform(gl, this.program, 'u_smear_width', 'slitScan');
    this.#uFeedbackBlend = reqUniform(gl, this.program, 'u_feedback_blend', 'slitScan');
    this.#uDirection = reqUniform(gl, this.program, 'u_direction', 'slitScan');
    this.#uStrobe = reqUniform(gl, this.program, 'u_strobe', 'slitScan');
    this.#uHistoryCapacity = reqUniform(gl, this.program, 'u_history_capacity', 'slitScan');
    this.#uHistoryValid = reqUniform(gl, this.program, 'u_history_valid', 'slitScan');
    this.#uHistoryWriteIndex = reqUniform(gl, this.program, 'u_history_write_index', 'slitScan');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const temporal = resources.temporalHistory;
    if (temporal) {
      gl.uniform1i(this.#uHistoryTex, temporal.textureUnit);
      gl.uniform1f(this.#uHistoryCapacity, temporal.capacity);
      gl.uniform1f(this.#uHistoryValid, temporal.validCount);
      gl.uniform1f(this.#uHistoryWriteIndex, temporal.writeIndex);
      return;
    }
    gl.uniform1i(this.#uHistoryTex, 3);
    gl.uniform1f(this.#uHistoryCapacity, 0);
    gl.uniform1f(this.#uHistoryValid, 0);
    gl.uniform1f(this.#uHistoryWriteIndex, 0);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uDepth, params['depth'] ?? 1);
    // Mode is a discrete enum carried under the existing orientation param so
    // older presets remain valid while radial and spiral modes join the pack.
    // It stays a float so it can sit in the same Record<string, number> table.
    // Snap to nearest integer before sending to the shader.
    gl.uniform1f(this.#uOrientation, Math.round(params['orientation'] ?? 0));
    gl.uniform1f(this.#uSlitX, params['slitX'] ?? 0.5);
    gl.uniform1f(this.#uSlitY, params['slitY'] ?? 0.5);
    gl.uniform1f(this.#uScanSpeed, params['scanSpeed'] ?? 1);
    gl.uniform1f(this.#uDelayAmount, params['delayAmount'] ?? 1);
    gl.uniform1f(this.#uSmearWidth, params['smearWidth'] ?? 0);
    gl.uniform1f(this.#uFeedbackBlend, params['feedbackBlend'] ?? 0);
    gl.uniform1f(this.#uDirection, Math.round(params['direction'] ?? 1));
    gl.uniform1f(this.#uStrobe, params['strobe'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const slitScanDef: OperatorDef = {
  op: 'slitScan',
  paramOrder: [
    'mix',
    'orientation',
    'slitX',
    'slitY',
    'scanSpeed',
    'depth',
    'delayAmount',
    'smearWidth',
    'feedbackBlend',
    'direction',
    'strobe',
  ],
  defaults: {
    mix: 1,
    orientation: 0,
    slitX: 0.5,
    slitY: 0.5,
    scanSpeed: 1,
    depth: 0.1,
    delayAmount: 1,
    smearWidth: 0,
    feedbackBlend: 0,
    direction: 1,
    strobe: 0,
  },
  hiddenParams(params) {
    const mode = Math.round(params['orientation'] ?? 0);
    if (mode === 0) return new Set(['slitY']);
    if (mode === 1) return new Set(['slitX']);
    return new Set<string>();
  },
  coupling: {
    op: 'slitScan',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet blend; 1 = full slit-scan output, 0 = passthrough',
        },
        toVideo: (raw) => raw,
      },
      orientation: {
        spec: {
          id: 'orientation',
          label: 'orientation',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'vertical/horizontal scans plus radial and spiral temporal echoes',
          choices: [
            { value: 0, label: 'vertical' },
            { value: 1, label: 'horizontal' },
            { value: 2, label: 'radial' },
            { value: 3, label: 'spiral' },
          ],
        },
        toVideo: (raw) => raw,
      },
      slitX: {
        spec: {
          id: 'slitX',
          label: 'slit x',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'column where the present-time slit lives; used only when orientation = vertical',
        },
        toVideo: (raw) => raw,
      },
      slitY: {
        spec: {
          id: 'slitY',
          label: 'slit y',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'row where the present-time slit lives; used only when orientation = horizontal',
        },
        toVideo: (raw) => raw,
      },
      scanSpeed: {
        spec: {
          id: 'scanSpeed',
          label: 'scan speed',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'how fast the trail grows away from the slit per frame; 1 = full speed (edge fills in ~1.7 s at 30 fps)',
        },
        toVideo: (raw) => raw,
      },
      depth: {
        spec: {
          id: 'depth',
          label: 'slit width',
          range: [0, 1],
          default: 0.1,
          curve: 'lin',
          unit: 'norm',
          hint: 'width of the present-time band as a fraction of the axis; 0 = hairline, 1 = full passthrough',
        },
        toVideo: (raw) => raw,
      },
      delayAmount: {
        spec: {
          id: 'delayAmount',
          label: 'delay amount',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'maximum age sampled from the shared eight-frame history ring',
        },
        toVideo: (raw) => raw,
      },
      smearWidth: {
        spec: {
          id: 'smearWidth',
          label: 'smear width',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'spread history ages across the selected scan field',
        },
        toVideo: (raw) => raw,
      },
      feedbackBlend: {
        spec: {
          id: 'feedbackBlend',
          label: 'feedback blend',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'blend the propagated newest frame toward older history layers',
        },
        toVideo: (raw) => raw,
      },
      direction: {
        spec: {
          id: 'direction',
          label: 'direction',
          range: [-1, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'reverse or advance the scan propagation direction',
          choices: [
            { value: -1, label: 'reverse' },
            { value: 1, label: 'forward' },
          ],
        },
        toVideo: (raw) => raw,
      },
      strobe: {
        spec: {
          id: 'strobe',
          label: 'freeze / strobe',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'quantise history ages into held temporal steps',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SlitScanVideoStage(gl);
  },
};
