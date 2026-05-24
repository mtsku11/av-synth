#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_nSides;

void main() {
  float modSample = texture(u_prev_frame, v_uv).r;
  float n = max(1.0, 1.0 + (u_nSides - 1.0) * modSample);
  vec2 p = v_uv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = 6.28318530718 / n;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r + 0.5;
  o_color = texture(u_tex, q);
}
