#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_tex;
uniform sampler2D u_prev_motion_tex;
uniform vec2 u_resolution;
uniform float u_prev_valid;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec2 decodeMotion(vec2 encoded) {
  return encoded * 2.0 - 1.0;
}

vec2 encodeMotion(vec2 value) {
  return value * 0.5 + 0.5;
}

void considerOffset(
  float current,
  vec2 uv,
  vec2 px,
  vec2 offset,
  inout float bestErr,
  inout vec2 bestVec
) {
  float sampleLuma = luma(texture(u_prev_tex, clamp(uv + offset * px, 0.0, 1.0)).rgb);
  float err = abs(current - sampleLuma);
  if (err < bestErr) {
    bestErr = err;
    bestVec = offset;
  }
}

void main() {
  if (u_prev_valid < 0.5) {
    o_color = vec4(0.5, 0.5, 0.0, 0.0);
    return;
  }

  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float current = luma(texture(u_tex, v_uv).rgb);
  float centerPrev = luma(texture(u_prev_tex, v_uv).rgb);
  float centerErr = abs(current - centerPrev);
  float bestErr = centerErr;
  vec2 bestVec = vec2(0.0);
  vec2 searchPx = vec2(1.75, 1.75);

  considerOffset(current, v_uv, px, vec2(searchPx.x, 0.0), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(-searchPx.x, 0.0), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(0.0, searchPx.y), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(0.0, -searchPx.y), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(searchPx.x, searchPx.y), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(-searchPx.x, searchPx.y), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(searchPx.x, -searchPx.y), bestErr, bestVec);
  considerOffset(current, v_uv, px, vec2(-searchPx.x, -searchPx.y), bestErr, bestVec);

  vec2 bestDir = length(bestVec) > 0.0 ? normalize(bestVec) : vec2(0.0);
  float improvement = max(centerErr - bestErr, 0.0);
  float magnitude = clamp(centerErr * 1.45 + improvement * 3.2, 0.0, 1.0);
  float confidence = smoothstep(0.02, 0.18, centerErr + improvement * 0.75);

  vec4 prevMotion = texture(u_prev_motion_tex, v_uv);
  vec2 smoothedDir = mix(decodeMotion(prevMotion.xy), bestDir, 0.4 + magnitude * 0.45);
  float smoothedMag = mix(prevMotion.b * 0.82, magnitude, 0.35 + magnitude * 0.4);
  float smoothedConfidence = mix(prevMotion.a * 0.8, confidence, 0.4 + confidence * 0.3);
  vec2 finalDir = length(smoothedDir) > 1e-5 ? normalize(smoothedDir) : vec2(0.0);

  o_color = vec4(encodeMotion(finalDir), smoothedMag, smoothedConfidence);
}
