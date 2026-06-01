#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform highp sampler3D u_lut_tex;
uniform float u_chroma;
uniform float u_luma;
uniform float u_mix;

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 graded = texture(u_lut_tex, clamp(src.rgb, 0.0, 1.0)).rgb;

  float srcLuma = luminance(src.rgb);
  float gradedLuma = luminance(graded);
  vec3 srcChroma = src.rgb - vec3(srcLuma);
  vec3 gradedChroma = graded - vec3(gradedLuma);

  vec3 combined = vec3(mix(srcLuma, gradedLuma, clamp(u_luma, 0.0, 1.0))) +
    mix(srcChroma, gradedChroma, clamp(u_chroma, 0.0, 1.0));
  vec3 outColor = mix(src.rgb, clamp(combined, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));
  o_color = vec4(outColor, src.a);
}
