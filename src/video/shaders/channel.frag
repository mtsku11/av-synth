#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec4 u_weights;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  float alphaSource = max(c.a, luma(c.rgb));
  vec4 source = vec4(c.rgb, alphaSource);
  float channel = clamp(dot(source, u_weights), 0.0, 1.0);
  o_color = vec4(vec3(channel), channel);
}
