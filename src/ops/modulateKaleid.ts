import frag from '../video/shaders/modulateKaleid.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateKaleidVideoStage implements VideoStage {
  readonly op = 'modulateKaleid';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uNSides: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateKaleid');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateKaleid');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateKaleid');
    this.#uNSides = reqUniform(gl, this.program, 'u_nSides', 'modulateKaleid');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uNSides, params['nSides'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateKaleidAudioStage implements AudioStage {
  readonly op = 'modulateKaleid';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #nSides: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-kaleid', {
      parameterData: { nSides: 1 },
    });
    const nSides = this.#worklet.parameters.get('nSides');
    if (!nSides) throw new Error('modulateKaleid: missing worklet params');
    this.#nSides = nSides;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#nSides.setTargetAtTime(params['nSides'] ?? 1, this.input.context.currentTime, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateKaleidDef: OperatorDef = {
  op: 'modulateKaleid',
  paramOrder: ['nSides'],
  defaults: { nSides: 1 },
  coupling: {
    op: 'modulateKaleid',
    kind: 'fully-coupled',
    params: {
      nSides: {
        spec: {
          id: 'nSides',
          label: 'sides',
          range: [1, 12],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'max reflective side count / max self-modulated fold count',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateKaleidVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateKaleidAudioStage(ctx);
  },
};
