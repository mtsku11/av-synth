#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_owned_state;
uniform vec2 u_resolution;
uniform float u_state_initialized;
uniform float u_time;
uniform float u_mix;
uniform float u_feedback;
uniform float u_edge_gain;
uniform float u_threshold;
uniform float u_growth;
uniform float u_spread;
uniform float u_decay;
uniform float u_ink;
uniform float u_twirl;
uniform float u_radius;
uniform vec2 u_center;
uniform float u_pixel_snap;
uniform float u_hardness;

const float TAU = 6.28318530718;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.45));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 warp_uv(vec2 uv) {
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 center = clamp(u_center, vec2(0.0), vec2(1.0));
  vec2 delta = uv - center;
  float dist = max(length(delta), 1e-5);
  float reach = max(u_radius, 0.05);
  float edge = clamp(1.0 - dist / reach, 0.0, 1.0);
  float hardness = clamp(u_hardness, 0.0, 1.0);
  float envelope = pow(edge, mix(2.8, 0.7, hardness));
  float angle = atan(delta.y, delta.x);
  float twist = u_twirl * envelope * (0.4 + 0.6 * clamp(u_feedback, 0.0, 1.0));
  float cellNoise = hash21(floor(uv * res * 0.25));
  float wobbleAmp =
    (1.0 - clamp(u_pixel_snap, 0.0, 1.0)) *
    (0.0015 + 0.006 * clamp(u_growth, 0.0, 1.0)) *
    (0.4 + 0.6 * min(abs(u_twirl), 1.0));
  vec2 wobble =
    vec2(
      sin(u_time * 0.83 + uv.y * 17.0 + cellNoise * TAU),
      cos(u_time * 0.67 + uv.x * 13.0 + cellNoise * TAU)
    ) * wobbleAmp * envelope;

  vec2 warped = center + vec2(cos(angle + twist), sin(angle + twist)) * dist + wobble;
  vec2 clampedUv = clamp(warped, vec2(0.0), vec2(1.0));
  vec2 snappedUv = (floor(clampedUv * res) + 0.5) / res;
  return mix(clampedUv, snappedUv, clamp(u_pixel_snap, 0.0, 1.0));
}

vec3 sample_edge_source(vec2 uv) {
  vec3 live = texture(u_tex, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  vec3 prev = texture(u_owned_state, warp_uv(uv)).rgb;
  return mix(live, prev, clamp(u_feedback, 0.0, 0.98) * 0.35);
}

float sobel_edge(vec2 uv) {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));

  float tl = luma(sample_edge_source(uv + vec2(-px.x, -px.y)));
  float tc = luma(sample_edge_source(uv + vec2(0.0, -px.y)));
  float tr = luma(sample_edge_source(uv + vec2(px.x, -px.y)));
  float ml = luma(sample_edge_source(uv + vec2(-px.x, 0.0)));
  float mr = luma(sample_edge_source(uv + vec2(px.x, 0.0)));
  float bl = luma(sample_edge_source(uv + vec2(-px.x, px.y)));
  float bc = luma(sample_edge_source(uv + vec2(0.0, px.y)));
  float br = luma(sample_edge_source(uv + vec2(px.x, px.y)));

  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return sqrt(gx * gx + gy * gy);
}

float previous_blackness(vec2 uv) {
  return clamp(
    1.0 - luma(texture(u_owned_state, clamp(uv, vec2(0.0), vec2(1.0))).rgb),
    0.0,
    1.0
  );
}

void main() {
  vec3 live = texture(u_tex, v_uv).rgb;
  if (u_state_initialized < 0.5) {
    o_color = vec4(live, 1.0);
    return;
  }

  float mixAmount = clamp(u_mix, 0.0, 1.0);
  float feedback = clamp(u_feedback, 0.0, 0.98);
  float growth = clamp(u_growth, 0.0, 1.0);
  float spread = clamp(u_spread, 0.0, 1.0);
  float decay = clamp(u_decay, 0.0, 0.2);
  float hardness = clamp(u_hardness, 0.0, 1.0);
  float ink = clamp(u_ink, 0.0, 1.0);

  vec2 warpedUv = warp_uv(v_uv);
  vec3 prevWarped = texture(u_owned_state, warpedUv).rgb;
  vec3 base = mix(live, prevWarped, feedback);

  float edge = sobel_edge(v_uv);
  float edgeNorm = clamp(edge * max(u_edge_gain, 0.0) * 0.25, 0.0, 1.0);
  float thresholdSoftness = mix(0.24, 0.015, hardness);
  float seeded = smoothstep(
    clamp(u_threshold - thresholdSoftness, 0.0, 1.0),
    clamp(u_threshold + thresholdSoftness, 0.0, 1.0),
    edgeNorm
  );
  seeded = pow(seeded, mix(1.6, 0.75, hardness));
  float seedBlack = clamp(seeded * (0.12 + growth * 1.88), 0.0, 1.0);

  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float spreadDistance = mix(0.75, 2.5, spread);
  vec2 dx = vec2(px.x * spreadDistance, 0.0);
  vec2 dy = vec2(0.0, px.y * spreadDistance);

  float prevBlack = previous_blackness(warpedUv);
  float dilated = prevBlack;
  dilated = max(dilated, previous_blackness(warpedUv + dx));
  dilated = max(dilated, previous_blackness(warpedUv - dx));
  dilated = max(dilated, previous_blackness(warpedUv + dy));
  dilated = max(dilated, previous_blackness(warpedUv - dy));
  dilated = max(dilated, previous_blackness(warpedUv + dx + dy));
  dilated = max(dilated, previous_blackness(warpedUv + dx - dy));
  dilated = max(dilated, previous_blackness(warpedUv - dx + dy));
  dilated = max(dilated, previous_blackness(warpedUv - dx - dy));

  float carried = mix(prevBlack, dilated, spread);
  float retained = max(carried - decay, 0.0);
  float voidMask = clamp(max(retained, seedBlack), 0.0, 1.0);
  voidMask = clamp(max(voidMask, retained + seedBlack * (0.2 + 0.8 * growth)), 0.0, 1.0);
  voidMask = pow(voidMask, mix(1.15, 0.7, hardness));

  vec3 result = mix(base, vec3(0.0), clamp(voidMask * ink, 0.0, 1.0));
  o_color = vec4(mix(live, result, mixAmount), 1.0);
}
