#version 300 es
// gradient(speed) — Hydra hue-cycling gradient.
//
// Hue ramps across x and rotates over time at `speed`. The audio analogue
// is a log-swept bandpass on white noise; sweep rate = baseFreq · speed
// (plan.md §1.5).

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform float u_speed;
uniform float u_time;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  float h = v_uv.x + u_time * u_speed;
  o_color = vec4(hsv2rgb(vec3(fract(h), 1.0, 1.0)), 1.0);
}
