#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_angle; // radians

// plan.md §2.1 — rotate UVs around centre.
void main() {
  vec2 p = v_uv - 0.5;
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  o_color = texture(u_tex, q);
}
