#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;

void main() {
  vec4 c = texture(u_tex, v_uv);
  c.rgb = clamp((c.rgb - 0.5) * u_amount + 0.5, 0.0, 1.0);
  o_color = c;
}
