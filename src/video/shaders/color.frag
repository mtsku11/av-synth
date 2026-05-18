#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec4 u_gain;

void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = clamp(c.rgb * u_gain.rgb * u_gain.a, 0.0, 1.0);
  o_color = vec4(rgb, c.a);
}
