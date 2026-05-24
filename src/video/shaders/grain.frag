#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_size;
uniform float u_density;
uniform float u_position;
uniform float u_spray;
uniform float u_pitch;
uniform float u_reverse;
uniform float u_shape;
uniform float u_spread;
uniform float u_time;
uniform vec2 u_resolution;

const float TAU = 6.28318530718;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

void main() {
  vec4 base = texture(u_tex, v_uv);
  float wet = clamp(u_mix, 0.0, 1.0);
  if (wet <= 0.0001) {
    o_color = base;
    return;
  }

  float sizeNorm = clamp((u_size - 0.01) / 0.34, 0.0, 1.0);
  float densityNorm = clamp((u_density - 1.0) / 39.0, 0.0, 1.0);
  float pitchScale = exp2(u_pitch * 0.35);
  float grainsY = mix(220.0, 10.0, pow(sizeNorm, 0.82));
  float aspect = max(0.25, u_resolution.x / max(1.0, u_resolution.y));
  vec2 grid = vec2(max(1.0, grainsY * aspect), max(1.0, grainsY));
  vec2 cell = floor(v_uv * grid);
  vec2 cellSize = 1.0 / grid;
  vec2 local = fract(v_uv * grid) - 0.5;

  float cadence = max(1.0, u_density) * mix(0.75, 1.35, sizeNorm);
  float tick = floor(u_time * cadence);
  vec2 seed = cell + vec2(tick, tick * 0.37);
  vec2 jitter = hash22(seed) - 0.5;
  vec2 jitter2 = hash22(seed + 13.7) - 0.5;

  float activeThreshold = mix(0.93, 0.18, densityNorm);
  float active = step(hash21(seed + 7.1), activeThreshold);
  float reverseMask = step(hash21(seed + 29.7), clamp(u_reverse, 0.0, 1.0));
  vec2 mirror = mix(vec2(1.0), vec2(-1.0, 1.0), reverseMask);

  float orbit = u_position * TAU + jitter.x * TAU * 0.25;
  vec2 direction = vec2(cos(orbit), sin(orbit));
  vec2 positionBias =
    direction * cellSize * mix(0.0, 1.15, clamp(u_position, 0.0, 1.0)) * pitchScale;
  vec2 sprayOffset = jitter * cellSize * mix(0.05, 2.4, clamp(u_spray, 0.0, 1.0));
  vec2 heldUv = clamp((cell + 0.5) / grid + positionBias + sprayOffset, vec2(0.0), vec2(1.0));

  vec2 chromaDir = normalize(direction + vec2(0.001, 0.002));
  vec2 spreadOffset = chromaDir * cellSize * clamp(u_spread, 0.0, 1.0) * 0.85;
  float shapeNorm = clamp(u_shape, 0.0, 1.0);
  float windowRadius = mix(0.98, 0.34, shapeNorm);
  float edge = max(abs(local.x * mirror.x), abs(local.y));
  float window = (1.0 - smoothstep(windowRadius, 1.0, edge * 2.0)) * active;

  vec2 drift = jitter2 * cellSize * mix(0.1, 0.85, abs(u_pitch));
  vec2 sampleR = clamp(heldUv - spreadOffset + drift, vec2(0.0), vec2(1.0));
  vec2 sampleG = clamp(heldUv, vec2(0.0), vec2(1.0));
  vec2 sampleB = clamp(heldUv + spreadOffset - drift, vec2(0.0), vec2(1.0));
  vec3 held = vec3(
    texture(u_tex, sampleR).r,
    texture(u_tex, sampleG).g,
    texture(u_tex, sampleB).b
  );

  float blockMix = wet * mix(0.45, 1.0, window);
  vec3 color = mix(base.rgb, held, blockMix);
  o_color = vec4(color, base.a);
}
