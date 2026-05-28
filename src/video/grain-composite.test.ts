import { describe, it, beforeEach, vi } from 'vitest';

vi.mock('./grain-composite.vert?raw', () => ({ default: 'vertex shader' }));
vi.mock('./grain-composite.frag?raw', () => ({ default: 'fragment shader' }));

vi.mock('./grain-buffer', () => ({
  GrainBuffer: class {
    allocate() {}
    getTexture() {
      return {};
    }
    bind() {}
  },
}));

vi.mock('./grain-scheduler', () => ({
  GrainScheduler: class {
    getActiveVoices() {
      return [];
    }
  },
}));

const _gl: WebGL2RenderingContext = {
  createShader: vi.fn(() => ({})),
  shaderSource: vi.fn(),
  compileShader: vi.fn(),
  getShaderParameter: vi.fn(() => true),
  getShaderInfoLog: vi.fn(() => ''),
  deleteShader: vi.fn(),
  createProgram: vi.fn(() => ({})),
  attachShader: vi.fn(),
  linkProgram: vi.fn(),
  getProgramParameter: vi.fn(() => true),
  getProgramInfoLog: vi.fn(() => ''),
  deleteProgram: vi.fn(),
  getUniformLocation: vi.fn(() => ({})),
  clearColor: vi.fn(),
  clear: vi.fn(),
  useProgram: vi.fn(),
  activeTexture: vi.fn(),
  bindTexture: vi.fn(),
  uniform1i: vi.fn(),
  uniform2f: vi.fn(),
  uniform1f: vi.fn(),
  drawArrays: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  blendFuncSeparate: vi.fn(),
} as unknown as WebGL2RenderingContext;
void _gl;

beforeEach(() => vi.clearAllMocks());

describe('compile (via constructor)', () => {
  it('throws when createShader returns null', () => {
    // TODO
  });

  it('throws on compile error', () => {
    // TODO
  });

  it('throws on link error', () => {
    // TODO
  });

  it('throws when a uniform location is missing', () => {
    // TODO
  });
});

describe('GrainCompositeSource constructor', () => {
  it('sets kind to grain-composite', () => {
    // TODO
  });

  it('applies halfSize default of 0.35 when not provided', () => {
    // TODO
  });

  it('applies maxVoices default of 64 when not provided', () => {
    // TODO
  });

  it('accepts explicit halfSize and maxVoices', () => {
    // TODO
  });
});

describe('setPlan / plan getter', () => {
  it('plan is null by default', () => {
    // TODO
  });

  it('setPlan stores and returns the plan', () => {
    // TODO
  });

  it('setPlan accepts null to clear the plan', () => {
    // TODO
  });
});

describe('render', () => {
  it('clears to opaque black before drawing', () => {
    // TODO
  });

  it('does nothing if plan is null', () => {
    // TODO
  });

  it('does nothing if buffer is not allocated', () => {
    // TODO
  });

  it('skips draw if getActiveVoices returns empty array', () => {
    // TODO
  });

  it('calls drawArrays once per active voice', () => {
    // TODO
  });

  it('binds grain buffer texture and sets u_grain uniform', () => {
    // TODO
  });

  it('sets u_halfSize from constructor option', () => {
    // TODO
  });

  it('enables premultiplied-over blending before drawing and disables after', () => {
    // TODO
  });

  it('passes panX/panY per voice as u_center', () => {
    // TODO
  });

  it('passes frameIndex per voice as u_layer', () => {
    // TODO
  });

  it('passes envelopeAlpha per voice as u_alpha', () => {
    // TODO
  });
});

describe('dispose', () => {
  it('calls deleteProgram once', () => {
    // TODO
  });

  it('is idempotent — second call does not call deleteProgram again', () => {
    // TODO
  });
});
