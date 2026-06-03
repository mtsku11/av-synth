#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform sampler2D u_tex_b;
uniform float u_source; // 0=prev_frame, 1=routed u_tex_b
uniform float u_multiple;
uniform float u_offset;

void main() {
  float angle = u_offset + (mix(texture(u_prev_frame, v_uv), texture(u_tex_b, v_uv), u_source).r * 2.0 - 1.0) * u_multiple;
  vec2 p = v_uv - 0.5;
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  o_color = texture(u_tex, q);
}
