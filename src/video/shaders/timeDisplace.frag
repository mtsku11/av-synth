#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2DArray u_history_tex;
uniform vec2 u_resolution;
uniform float u_mix;
uniform float u_depth;
uniform float u_scan;
uniform float u_smear;
uniform float u_decay;
uniform float u_history_capacity;
uniform float u_history_valid;
uniform float u_history_write_index;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float wrapLayer(float layer, float capacity) {
  float wrapped = mod(layer, capacity);
  return wrapped < 0.0 ? wrapped + capacity : wrapped;
}

vec3 sampleHistoryLayer(vec2 uv, float age) {
  if (u_history_valid < 1.0 || u_history_capacity < 1.0) {
    return texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
  }
  float newest = u_history_write_index - 1.0;
  float layer = wrapLayer(newest - age, u_history_capacity);
  return texture(u_history_tex, vec3(clamp(uv, 0.0, 1.0), layer)).rgb;
}

vec3 sampleHistoryAge(vec2 uv, float age) {
  float maxAge = max(u_history_valid - 1.0, 0.0);
  float clampedAge = clamp(age, 0.0, maxAge);
  float lo = floor(clampedAge);
  float hi = min(lo + 1.0, maxAge);
  vec3 a = sampleHistoryLayer(uv, lo);
  vec3 b = sampleHistoryLayer(uv, hi);
  return mix(a, b, clampedAge - lo);
}

void main() {
  vec3 current = texture(u_tex, v_uv).rgb;
  if (u_history_valid < 1.0 || u_mix <= 0.0001) {
    o_color = vec4(current, 1.0);
    return;
  }

  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float currentLuma = luma(current);
  float historySpan = max(u_history_valid - 1.0, 1.0);
  float lookback = mix(1.0, historySpan, pow(clamp(u_depth, 0.0, 1.0), 0.82));

  float slitAge = lookback * clamp(v_uv.y, 0.0, 1.0);
  float lumaAge = lookback * pow(clamp(currentLuma, 0.0, 1.0), mix(1.35, 0.7, u_scan));
  float scanAge = mix(slitAge, lumaAge, clamp(u_scan, 0.0, 1.0));

  vec3 scanSample = sampleHistoryAge(v_uv, scanAge);
  vec3 nearSample = sampleHistoryAge(v_uv, min(scanAge + 1.0, historySpan));

  float diffX =
    luma(sampleHistoryAge(v_uv + vec2(px.x, 0.0), scanAge)) -
    luma(sampleHistoryAge(v_uv - vec2(px.x, 0.0), scanAge));
  float diffY =
    luma(sampleHistoryAge(v_uv + vec2(0.0, px.y), scanAge)) -
    luma(sampleHistoryAge(v_uv - vec2(0.0, px.y), scanAge));
  vec2 smearVec = vec2(diffX, diffY) + vec2(luma(scanSample) - currentLuma, luma(nearSample) - currentLuma);
  vec2 displacedUv = clamp(v_uv + smearVec * (0.02 + u_smear * 0.11), 0.0, 1.0);

  float combPhase = fract(v_uv.x * (2.0 + u_smear * 10.0) + currentLuma * 0.37 + v_uv.y * 0.21);
  float combAge = lookback * combPhase;
  vec3 displaced = sampleHistoryAge(displacedUv, combAge);

  float trailFade = mix(1.0, exp(-scanAge * mix(0.08, 0.28, u_decay)), 0.7);
  vec3 history = mix(scanSample, displaced, 0.34 + u_smear * 0.4);
  history = mix(history, nearSample, 0.18 + (1.0 - u_decay) * 0.22);
  history *= trailFade;

  vec3 color = mix(current, history, clamp(u_mix, 0.0, 1.0));
  color += (history - current) * u_smear * 0.12;
  o_color = vec4(clamp(color, 0.0, 1.0), 1.0);
}
