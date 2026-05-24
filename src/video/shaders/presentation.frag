#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_bloom_tex0;
uniform sampler2D u_bloom_tex1;
uniform sampler2D u_bloom_tex2;
uniform sampler2D u_bloom_tex3;
uniform sampler2D u_prev_tex;
uniform sampler2D u_lens_dirt_tex;
uniform highp sampler3D u_lut_tex;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_feedback_amount;
uniform float u_lut_mix;
uniform float u_lens_dirt_amount;
uniform float u_aberration;
uniform vec4 u_bloom_weights;
uniform float u_bloom_strength;
uniform float u_halation_strength;
uniform float u_grain_amount;
uniform vec3 u_bloom_tint;
uniform vec3 u_halation_tint;
uniform vec3 u_grade_lift;
uniform vec3 u_grade_gamma;
uniform vec3 u_grade_gain;
uniform mat3 u_grade_matrix;
uniform vec3 u_split_shadow;
uniform vec3 u_split_highlight;
uniform float u_split_amount;
uniform vec4 u_style_warp;
uniform vec4 u_style_trail;
uniform vec2 u_style_posterize;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleColor(vec2 uv) {
  return texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 sampleAberrated(vec2 uv, vec2 px, float amount) {
  vec2 center = uv * 2.0 - 1.0;
  vec2 dir = normalize(center + vec2(0.0001, 0.0));
  vec2 shift = dir * px * amount;
  return vec3(
    texture(u_tex, clamp(uv + shift, 0.0, 1.0)).r,
    texture(u_tex, clamp(uv, 0.0, 1.0)).g,
    texture(u_tex, clamp(uv - shift, 0.0, 1.0)).b
  );
}

vec3 applyGrade(vec3 color) {
  color = max(color + u_grade_lift, 0.0);
  color *= u_grade_gain;
  color = pow(max(color, 0.0), 1.0 / max(u_grade_gamma, vec3(0.0001)));
  color = max(u_grade_matrix * color, 0.0);
  float tonal = smoothstep(0.18, 0.82, luma(color));
  vec3 splitTone = mix(u_split_shadow, u_split_highlight, tonal);
  return mix(color, color * splitTone, u_split_amount);
}

vec3 applyLut(vec3 color) {
  vec3 graded = texture(u_lut_tex, clamp(color, 0.0, 1.0)).rgb;
  return mix(color, graded, clamp(u_lut_mix, 0.0, 1.0));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float feedbackLift = smoothstep(0.1, 0.95, u_feedback_amount);
  float aberration = u_aberration * mix(0.8, 1.35, feedbackLift);
  vec2 center = v_uv * 2.0 - 1.0;
  float radius = length(center);
  vec2 radialDir = radius > 0.0001 ? center / radius : vec2(0.0);
  float warpAmountPx = u_style_warp.x;
  float warpFrequency = max(u_style_warp.y, 0.0001);
  float warpSpeed = u_style_warp.z;
  float radialWarpMix = clamp(u_style_warp.w, 0.0, 1.0);
  vec2 driftField = vec2(
    sin((v_uv.y * warpFrequency) + u_time * warpSpeed),
    cos((v_uv.x * warpFrequency * 0.83) - u_time * warpSpeed * 0.92)
  );
  vec2 radialField = radialDir * sin(radius * warpFrequency * 0.65 - u_time * warpSpeed);
  vec2 warpOffset = px * warpAmountPx * mix(driftField, radialField, radialWarpMix);
  vec2 warpedUv = clamp(v_uv + warpOffset, 0.0, 1.0);
  vec3 base = mix(sampleColor(warpedUv), sampleAberrated(warpedUv, px, aberration), 0.75);
  float baseLuma = luma(base);
  vec3 bloom0 = texture(u_bloom_tex0, v_uv).rgb;
  vec3 bloom1 = texture(u_bloom_tex1, v_uv).rgb;
  vec3 bloom2 = texture(u_bloom_tex2, v_uv).rgb;
  vec3 bloom3 = texture(u_bloom_tex3, v_uv).rgb;
  vec3 bloom = bloom0 * u_bloom_weights.x +
    bloom1 * u_bloom_weights.y +
    bloom2 * u_bloom_weights.z +
    bloom3 * u_bloom_weights.w;
  vec3 halation = vec3(
    texture(u_bloom_tex1, clamp(v_uv + vec2(px.x * 1.8, 0.0), 0.0, 1.0)).r,
    texture(u_bloom_tex2, v_uv).g,
    texture(u_bloom_tex3, clamp(v_uv - vec2(px.x * 1.4, 0.0), 0.0, 1.0)).b
  );
  vec3 bloomWide = bloom2 * max(u_bloom_weights.z, 0.0001) +
    bloom3 * max(u_bloom_weights.w, 0.0001);
  float lensDirt = pow(texture(u_lens_dirt_tex, clamp(v_uv * 0.92 + 0.04, 0.0, 1.0)).r, 1.15);
  vec3 color = base;
  color += bloom * u_bloom_tint * u_bloom_strength;
  color += mix(halation, bloomWide, 0.45) *
    u_halation_tint *
    u_halation_strength *
    mix(0.7, 1.2, feedbackLift);
  color += bloomWide * lensDirt * u_lens_dirt_amount * (0.22 + feedbackLift * 0.28);

  float trailAmount = clamp(u_style_trail.x, 0.0, 1.0);
  float trailShiftPx = u_style_trail.y;
  float edgeTrailAmount = clamp(u_style_trail.z, 0.0, 1.0);
  float edgeThreshold = clamp(u_style_trail.w, 0.001, 1.0);
  vec2 trailOffset = vec2(px.x * trailShiftPx * (0.8 + feedbackLift), px.y * trailShiftPx * 0.45);
  vec3 prevTrail = texture(u_prev_tex, clamp(warpedUv - trailOffset, 0.0, 1.0)).rgb;
  vec3 prevEdgeA = texture(u_prev_tex, clamp(warpedUv + vec2(px.x, 0.0), 0.0, 1.0)).rgb;
  vec3 prevEdgeB = texture(u_prev_tex, clamp(warpedUv + vec2(0.0, px.y), 0.0, 1.0)).rgb;
  float edgeMask = smoothstep(
    edgeThreshold,
    edgeThreshold + 0.14,
    length(base - prevEdgeA) + length(base - prevEdgeB)
  );
  color = mix(color, mix(color, prevTrail, 0.6), trailAmount);
  color += prevTrail * edgeMask * edgeTrailAmount * (0.2 + feedbackLift * 0.35);

  float neutral = luma(color);
  color = mix(vec3(neutral), color, 1.1);
  color = (color - 0.5) * 1.08 + 0.5;
  color = applyGrade(color);

  float posterizeBins = max(u_style_posterize.x, 2.0);
  float posterizeMix = clamp(u_style_posterize.y, 0.0, 1.0);
  vec3 posterized = floor(clamp(color, 0.0, 1.0) * posterizeBins) / (posterizeBins - 1.0);
  color = mix(color, posterized, posterizeMix);
  color = applyLut(color);

  float vignette = smoothstep(1.15, 0.18, dot(center, center));
  color *= mix(0.86, 1.0, vignette);

  float grain = hash((v_uv + vec2(u_time * 0.13, u_time * 0.07)) * u_resolution);
  color += (grain - 0.5) * (u_grain_amount * (0.7 - baseLuma * 0.35));

  o_color = vec4(clamp(color, 0.0, 1.0), 1.0);
}
