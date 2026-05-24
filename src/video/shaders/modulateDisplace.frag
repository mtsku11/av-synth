#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;
uniform float u_bias;

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 mod = texture(u_tex_b, v_uv);
  float lum = luma(mod.rgb);
  vec2 chromaField = (mod.rg - 0.5) * 2.0;
  float biasCenter = 0.5 + u_bias * 0.25;
  vec2 field = chromaField + vec2(lum - biasCenter, mod.b - biasCenter);
  vec2 displacedUv = fract(v_uv + field * (u_amount * 0.12));
  outColor = texture(u_tex, displacedUv);
}
