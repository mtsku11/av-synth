#version 300 es
// voronoi(scale, speed, blending) — Hydra source.
//
// Cell points are jittered hash positions per integer grid cell, animated
// in a small circle by `speed`. `blending` interpolates between hard-min
// (classic Voronoi) and soft-min (exp-weighted blend of nearest neighbours).
// The audio analogue is a granular cloud (plan.md §1.3); scale controls
// grain density (Hz), speed the per-grain envelope rate, blending the
// envelope smoothness.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform float u_scale;
uniform float u_speed;
uniform float u_blending;
uniform float u_time;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

void main() {
  vec2 uv = v_uv * u_scale;
  vec2 i = floor(uv);
  vec2 f = fract(uv);

  float hardMin = 1e6;
  float softAccum = 0.0;
  float k = max(u_blending, 1e-3) * 8.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 n = vec2(float(x), float(y));
      vec2 h = hash2(i + n);
      vec2 p = n + 0.5 + 0.4 * vec2(
        sin(u_time * u_speed + 6.2831853 * h.x),
        cos(u_time * u_speed + 6.2831853 * h.y)
      );
      float d = length(p - f);
      hardMin = min(hardMin, d);
      softAccum += exp(-k * d);
    }
  }

  float softMin = -log(max(softAccum, 1e-6)) / k;
  float d = mix(hardMin, softMin, clamp(u_blending, 0.0, 1.0));
  o_color = vec4(vec3(d), 1.0);
}
