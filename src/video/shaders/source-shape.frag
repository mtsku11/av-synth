#version 300 es
// shape(sides, radius, smoothing) — Hydra polygon SDF.
//
//   d(p) = cos( floor(0.5 + θ/Δ) · Δ − θ ) · |p|     with Δ = 2π/sides
//   v   = 1 − smoothstep(radius, radius + smoothing, d)
//
// The audio analogue is a bandlimited additive polygon wave: harmonics at
// k·sides + 1, fundamental amp = radius, lowpass cutoff = baseFreq /
// smoothing (plan.md §1.4).

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform float u_sides;
uniform float u_radius;
uniform float u_smoothing;

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float n = max(u_sides, 3.0);
  // atan(y, x) maps to (-π, π]; fold into one sector around the bisector.
  float a = atan(p.y, p.x);
  float r = 6.28318531 / n;
  float folded = mod(a + 3.14159265 + 0.5 * r, r) - 0.5 * r;
  float d = cos(folded) * length(p);
  float v = 1.0 - smoothstep(u_radius, u_radius + max(u_smoothing, 1e-5), d);
  o_color = vec4(vec3(v), 1.0);
}
