#version 300 es
// repeatY(reps, offset) — single-axis vertical tiling (plan.md §2.5).
//
//   uv.y → fract(uv.y · reps + offset)
//
// Audio analogue: feedback comb on the right channel only. Left passes dry.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_reps;
uniform float u_offset;

void main() {
  vec2 q = vec2(v_uv.x, fract(v_uv.y * u_reps + u_offset));
  o_color = texture(u_tex, q);
}
