#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount; // 0.5 .. 2.0 (1.0 = identity)

// plan.md §2.2 — uniform scale around centre.
// uv -> (uv - 0.5) / amount + 0.5
void main() {
  float s = max(u_amount, 0.0001);
  vec2 q = (v_uv - 0.5) / s + 0.5;
  o_color = texture(u_tex, q);
}
