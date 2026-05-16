// WebGL2 renderer scaffold.
//
// Responsibilities at M1:
//   - Acquire a WebGL2 context.
//   - Allocate two RGBA16F ping-pong FBOs.
//   - Compile the trivial copy and clear programs.
//   - Drive a rAF loop, drawing a placeholder gradient so the canvas is
//     visibly alive. Operators (the real fragment shaders) bolt on in M2.

const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FS_COPY = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_tex;
void main() { o_color = texture(u_tex, v_uv); }
`;

// Placeholder M1 fragment: a slow plasma so we can see the loop is running.
// Replaced by real operators in M2.
const FS_PLACEHOLDER = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
uniform float u_time;
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float v = 0.5 + 0.5 * sin(r * 6.0 - u_time * 0.5 + a * 2.0);
  vec3 col = mix(vec3(0.02, 0.06, 0.10), vec3(0.40, 0.85, 1.0), v * v);
  o_color = vec4(col, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}\n---\n${src}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log}`);
  }
  return p;
}

interface PingPong {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

function createPingPong(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: GLenum,
): PingPong {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Failed to allocate FBO/texture');

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`FBO incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width, height };
}

export class VideoRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  #vao: WebGLVertexArrayObject;
  #copyProgram: WebGLProgram;
  #placeholderProgram: WebGLProgram;
  #u_tex: WebGLUniformLocation;
  #u_time: WebGLUniformLocation;

  #pingA: PingPong;
  #pingB: PingPong;
  #useA = true;

  #running = false;
  #rafId = 0;
  #startMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available in this browser');
    this.gl = gl;

    // HDR-ish offscreen targets. EXT_color_buffer_float is core in WebGL2.
    const ext = gl.getExtension('EXT_color_buffer_float');
    const internalFormat = ext ? gl.RGBA16F : gl.RGBA8;

    const w = canvas.width;
    const h = canvas.height;
    this.#pingA = createPingPong(gl, w, h, internalFormat);
    this.#pingB = createPingPong(gl, w, h, internalFormat);

    // Programs.
    const vs = compile(gl, gl.VERTEX_SHADER, VS_FULLSCREEN);
    const fsCopy = compile(gl, gl.FRAGMENT_SHADER, FS_COPY);
    const fsPlaceholder = compile(gl, gl.FRAGMENT_SHADER, FS_PLACEHOLDER);
    this.#copyProgram = link(gl, vs, fsCopy);
    this.#placeholderProgram = link(gl, vs, fsPlaceholder);
    gl.deleteShader(vs);
    gl.deleteShader(fsCopy);
    gl.deleteShader(fsPlaceholder);

    const uTex = gl.getUniformLocation(this.#copyProgram, 'u_tex');
    const uTime = gl.getUniformLocation(this.#placeholderProgram, 'u_time');
    if (!uTex || !uTime) throw new Error('Required uniform locations missing');
    this.#u_tex = uTex;
    this.#u_time = uTime;

    // VAO for the fullscreen triangle. No actual attributes — gl_VertexID-driven.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray returned null');
    this.#vao = vao;
  }

  resize(width: number, height: number): void {
    if (width === this.#pingA.width && height === this.#pingA.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    // Reallocate ping-pong targets at new size.
    const gl = this.gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    const internalFormat = ext ? gl.RGBA16F : gl.RGBA8;
    gl.deleteFramebuffer(this.#pingA.fbo);
    gl.deleteFramebuffer(this.#pingB.fbo);
    gl.deleteTexture(this.#pingA.tex);
    gl.deleteTexture(this.#pingB.tex);
    this.#pingA = createPingPong(gl, width, height, internalFormat);
    this.#pingB = createPingPong(gl, width, height, internalFormat);
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#startMs = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;
    gl.deleteFramebuffer(this.#pingA.fbo);
    gl.deleteFramebuffer(this.#pingB.fbo);
    gl.deleteTexture(this.#pingA.tex);
    gl.deleteTexture(this.#pingB.tex);
    gl.deleteProgram(this.#copyProgram);
    gl.deleteProgram(this.#placeholderProgram);
    gl.deleteVertexArray(this.#vao);
  }

  #tick = (nowMs: number): void => {
    if (!this.#running) return;
    const t = (nowMs - this.#startMs) * 0.001;
    this.#renderFrame(t);
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #renderFrame(t: number): void {
    const gl = this.gl;
    const write = this.#useA ? this.#pingB : this.#pingA;

    // 1. Run placeholder operator into the write FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, write.width, write.height);
    gl.useProgram(this.#placeholderProgram);
    gl.uniform1f(this.#u_time, t);
    gl.bindVertexArray(this.#vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Copy write FBO to the default framebuffer (canvas).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.#copyProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, write.tex);
    gl.uniform1i(this.#u_tex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.#useA = !this.#useA;
  }
}
