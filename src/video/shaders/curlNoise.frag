#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_strength;
uniform float u_scale;
uniform float u_time;
uniform float u_warp;

// Hash + value-noise potential. The actual displacement is the 2D curl of
// the potential, so the resulting velocity field is divergence-free —
// matter doesn't pile up or thin out, only swirls.

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two octaves stacked; the second octave drifts at a different rate so the
// field never repeats and reads more like turbulence than a frozen pattern.
float potential(vec2 p) {
  float t = u_time * 0.15;
  float n1 = vnoise(p + vec2(t, -t * 0.7));
  float n2 = vnoise(p * 2.07 + vec2(-t * 0.4, t * 1.1));
  return n1 + 0.5 * n2;
}

vec2 curl(vec2 uv) {
  vec2 p = uv * u_scale;
  float eps = 0.5;
  float dphi_dx = potential(p + vec2(eps, 0.0)) - potential(p - vec2(eps, 0.0));
  float dphi_dy = potential(p + vec2(0.0, eps)) - potential(p - vec2(0.0, eps));
  return vec2(dphi_dy, -dphi_dx) / (2.0 * eps);
}

void main() {
  vec2 vel = curl(v_uv);
  vec2 warped = v_uv + vel * u_warp * 0.05;
  vec2 vel2 = curl(warped);
  vec2 src_uv = fract(v_uv - vel2 * u_strength);
  vec3 displaced = texture(u_tex, src_uv).rgb;
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
