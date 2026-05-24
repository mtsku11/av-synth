#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_multiple;
uniform float u_offset;

void main() {
  float modSample = texture(u_prev_frame, v_uv).r * 2.0 - 1.0;
  float scale = max(0.1, u_offset + modSample * u_multiple);
  vec2 q = (v_uv - 0.5) / scale + 0.5;
  o_color = texture(u_tex, q);
}
