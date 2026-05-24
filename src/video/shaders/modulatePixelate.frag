#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_multiple;
uniform float u_offset;

void main() {
  float modSample = texture(u_prev_frame, v_uv).r;
  float n = max(1.0, u_offset + modSample * u_multiple);
  vec2 q = (floor(v_uv * n) + 0.5) / n;
  o_color = texture(u_tex, q);
}
