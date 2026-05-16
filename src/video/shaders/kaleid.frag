#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_nSides; // 1 .. 12; effective number of polar segments

// plan.md §2.6 — polar fold with n-way rotational symmetry.
// Map UVs into one wedge of the n-fold symmetry, then mirror.
void main() {
  vec2 p = v_uv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);

  float n = max(1.0, u_nSides);
  float seg = 3.14159265 * 2.0 / n;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);

  vec2 q = vec2(cos(a), sin(a)) * r + 0.5;
  o_color = texture(u_tex, q);
}
