#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_exposure;
uniform float u_gamma;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;
uniform float u_hueCurve;
uniform float u_toe;
uniform float u_shoulder;
uniform float u_vignette;
uniform float u_mix;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 applyWhiteBalance(vec3 color, float temperature, float tint) {
  vec3 warmed = vec3(
    color.r * (1.0 + temperature * 0.12) + color.g * temperature * 0.015,
    color.g * (1.0 - abs(tint) * 0.04),
    color.b * (1.0 - temperature * 0.12) - color.g * temperature * 0.015
  );
  return vec3(
    warmed.r + tint * 0.05,
    warmed.g - tint * 0.03,
    warmed.b + tint * 0.04
  );
}

float applyToneCurve(float value, float toe, float shoulder) {
  float lifted = mix(value, sqrt(max(value, 0.0)), clamp(toe, 0.0, 1.0) * 0.75);
  float whitePoint = mix(8.0, 1.6, clamp(shoulder, 0.0, 1.0));
  float mapped = (lifted * (1.0 + lifted / whitePoint)) / (1.0 + lifted);
  return clamp(mapped, 0.0, 1.0);
}

vec3 rgbToHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsvToRgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

vec3 applyHueCurve(vec3 color, float amount) {
  vec3 hsv = rgbToHsv(clamp(color, 0.0, 1.0));
  hsv.x = fract(hsv.x - sin((hsv.x + 0.05) * 6.283185307179586) * 0.07 * clamp(amount, 0.0, 1.0));
  return hsvToRgb(hsv);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 graded = max(src.rgb, 0.0) * exp2(u_exposure);
  graded = max(applyWhiteBalance(graded, u_temperature, u_tint), 0.0);
  graded = pow(max(graded, 0.0), vec3(1.0 / max(u_gamma, 0.001)));
  graded = applyHueCurve(graded, u_hueCurve);

  float preSatLuma = luma(graded);
  graded = mix(vec3(preSatLuma), graded, max(u_saturation, 0.0));

  float toneLuma = max(luma(graded), 1e-4);
  float mappedLuma = applyToneCurve(toneLuma, u_toe, u_shoulder);
  graded *= mappedLuma / toneLuma;

  graded = (graded - 0.5) * u_contrast + 0.5;

  vec2 centered = v_uv * 2.0 - 1.0;
  float radius = dot(centered, centered);
  float vignetteMask = smoothstep(0.14, 1.18, radius);
  graded *= 1.0 - vignetteMask * u_vignette * 0.82;

  vec3 outColor = mix(src.rgb, clamp(graded, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));
  o_color = vec4(outColor, src.a);
}
