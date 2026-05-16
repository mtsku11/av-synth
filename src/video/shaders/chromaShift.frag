#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount; // 0 .. 0.08 (UV offset per channel)

// Prototype's `shift` op renamed to chromaShift per memory.md — this is
// RGB spatial split (chromatic aberration), distinct from Hydra's true
// `shift` (per-channel hue shift, plan.md §3.2, todo for M3).
void main() {
  vec2 d = vec2(u_amount, 0.0);
  float r = texture(u_tex, v_uv + d).r;
  float g = texture(u_tex, v_uv).g;
  float b = texture(u_tex, v_uv - d).b;
  o_color = vec4(r, g, b, 1.0);
}
