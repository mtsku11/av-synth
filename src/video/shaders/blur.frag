#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_direction;

void main() {
  vec2 delta = u_texel * u_direction;
  vec3 color = texture(u_tex, v_uv).rgb * 0.227027;
  color += texture(u_tex, v_uv + delta * 1.384615).rgb * 0.316216;
  color += texture(u_tex, v_uv - delta * 1.384615).rgb * 0.316216;
  color += texture(u_tex, v_uv + delta * 3.230769).rgb * 0.070270;
  color += texture(u_tex, v_uv - delta * 3.230769).rgb * 0.070270;
  o_color = vec4(color, 1.0);
}
