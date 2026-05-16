// Shared GLSL compile/link helpers used by every operator's video stage.

export const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

function compile(
  gl: WebGL2RenderingContext,
  type: GLenum,
  src: string,
  label: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`${label}: createShader returned null`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`${label} compile: ${log}`);
  }
  return sh;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  fragSrc: string,
  opName: string,
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VS_FULLSCREEN, `${opName} VS`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${opName} FS`);
  const p = gl.createProgram();
  if (!p) throw new Error(`${opName}: createProgram returned null`);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`${opName} link: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

export function reqUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  opName: string,
): WebGLUniformLocation {
  const u = gl.getUniformLocation(program, name);
  if (!u) throw new Error(`${opName}: missing uniform '${name}'`);
  return u;
}
