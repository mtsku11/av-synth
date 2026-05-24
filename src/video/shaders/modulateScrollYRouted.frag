#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;
uniform float u_speed;
uniform float u_time;

void main() {
  float modSample = texture(u_tex_b, v_uv).g * 2.0 - 1.0;
  vec2 q = vec2(v_uv.x, fract(v_uv.y + modSample * u_amount + u_time * u_speed));
  o_color = texture(u_tex, q);
}
