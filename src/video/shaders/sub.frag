#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;

void main() {
  vec4 primary = texture(u_tex, v_uv);
  vec4 secondary = texture(u_tex_b, v_uv);
  o_color = primary - secondary * u_amount;
}
