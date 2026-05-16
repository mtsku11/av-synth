#version 300 es
// repeatX(reps, offset) — single-axis horizontal tiling (plan.md §2.5).
//
//   uv.x → fract(uv.x · reps + offset)
//
// Audio analogue: feedforward comb on the left channel only. Right channel
// passes dry. X is the "feedforward" axis; Y (repeatY) is the feedback axis.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_reps;
uniform float u_offset;

void main() {
  vec2 q = vec2(fract(v_uv.x * u_reps + u_offset), v_uv.y);
  o_color = texture(u_tex, q);
}
