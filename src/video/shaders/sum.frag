#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec4 u_weights;
uniform float u_amount;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  vec4 source = vec4(c.rgb, max(c.a, luma(c.rgb)));
  float summed = max(0.0, dot(source, u_weights));
  vec3 mixedRgb = mix(c.rgb, vec3(summed), clamp(u_amount, 0.0, 1.0));
  float mixedAlpha = mix(c.a, clamp(summed, 0.0, 1.0), clamp(u_amount, 0.0, 1.0));
  o_color = vec4(mixedRgb, mixedAlpha);
}
