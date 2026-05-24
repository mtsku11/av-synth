#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_threshold;
uniform float u_soft_knee;
uniform float u_black_level;
uniform float u_gamma;
uniform float u_brightness;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 color = texture(u_tex, v_uv).rgb;
  color = max(color - vec3(u_black_level), 0.0);
  color = pow(max(color, 0.0), vec3(1.0 / max(u_gamma, 0.0001)));
  color *= u_brightness;
  float brightness = luma(color);
  float kneeStart = max(u_threshold - u_soft_knee, 0.0);
  float knee = smoothstep(kneeStart, u_threshold + u_soft_knee, brightness);
  float energy = clamp((brightness - kneeStart) / max(1.0 - kneeStart, 0.0001), 0.0, 1.0);
  vec3 bloom = color * knee * mix(0.24, 1.0, energy);
  o_color = vec4(max(bloom, 0.0), 1.0);
}
