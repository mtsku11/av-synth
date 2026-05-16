#version 300 es
// repeat(repeatX, repeatY, offsetX, offsetY) — UV tiling (plan.md §2.4).
//
//   uv → fract(uv · [rx, ry] + [ox, oy])
//
// Audio analogue: per-axis IIR feedback comb. Spatial period 1/rx ↔ temporal
// period 1/(rx · baseFreq) · loopLen — bpm-locked.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_repeatX;
uniform float u_repeatY;
uniform float u_offsetX;
uniform float u_offsetY;

void main() {
  vec2 q = fract(v_uv * vec2(u_repeatX, u_repeatY) + vec2(u_offsetX, u_offsetY));
  o_color = texture(u_tex, q);
}
