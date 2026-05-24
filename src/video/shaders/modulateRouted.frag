#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;

void main() {
  vec2 modSample = texture(u_tex_b, v_uv).rg * 2.0 - 1.0;
  vec2 q = v_uv + modSample * (u_amount * 0.12);
  o_color = texture(u_tex, q);
}
