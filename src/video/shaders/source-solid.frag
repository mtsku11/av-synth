#version 300 es
// solid(r, g, b, a) — Hydra constant-colour source.
//
// Audio analogue: three sinusoids on R/G/B at f₀, f₀·3/2, f₀·2 (fifth +
// octave), amplitudes = channel values, master gain = a (plan.md §1.6).

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform vec4 u_color;

void main() {
  // v_uv is declared so the vertex/fragment varying interface matches the
  // shared VS_FULLSCREEN — the value itself is unused.
  o_color = u_color;
}
