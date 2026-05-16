#version 300 es
// osc(freq, sync, offset) — Hydra canonical oscillator.
//
//   colour_c = 0.5 + 0.5 · sin(x · 2π · freq + t · sync + c·offset)
//
// where x is the normalised horizontal coord and c ∈ {0,1,2} for R/G/B.
// freq is in cycles-per-screen. sync is the temporal drift of the sine in
// rad/s (Hydra docs frame it as 0.1 ≈ slow). offset is the per-channel
// phase shift in radians; it controls the chromatic aberration character.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform float u_freq;
uniform float u_sync;
uniform float u_offset;
uniform float u_time;

void main() {
  float x = v_uv.x;
  float base = x * 6.2831853 * u_freq + u_time * u_sync;
  float r = 0.5 + 0.5 * sin(base + 0.0 * u_offset);
  float g = 0.5 + 0.5 * sin(base + 1.0 * u_offset);
  float b = 0.5 + 0.5 * sin(base + 2.0 * u_offset);
  o_color = vec4(r, g, b, 1.0);
}
