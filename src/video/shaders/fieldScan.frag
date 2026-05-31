#version 300 es
precision highp float;

// fieldScan — multi-tap smear along a configurable vector field.
// Each pixel samples the source at 8 positions traced back along the
// local field direction.  The result is a streak/trail that curves with
// the field rather than running along a fixed screen axis.
//
// u_angle (0→1 = full rotation) + u_twist (0=linear, 1=vortex) combine
// into the per-pixel velocity; u_scan controls total smear reach.

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_strength;
uniform float u_scan;
uniform float u_angle;
uniform float u_twist;
uniform float u_cx;
uniform float u_cy;

const float TAU = 6.28318530718;

vec2 fieldVel(vec2 uv) {
  // Linear component: uniform flow in u_angle direction
  float a = u_angle * TAU;
  vec2 linear = vec2(cos(a), sin(a));

  // Vortex component: CCW rotation around (u_cx, u_cy)
  vec2 d = uv - vec2(u_cx, u_cy);
  float r = length(d);
  float envelope = smoothstep(0.0, 0.12, r) * exp(-r * 2.2);
  vec2 vortex = r > 0.001 ? (vec2(-d.y, d.x) / r) * envelope * 3.5 : vec2(0.0);

  return mix(linear, vortex, clamp(u_twist, 0.0, 1.0)) * u_strength;
}

void main() {
  vec3 src = texture(u_tex, v_uv).rgb;

  if (u_scan < 0.0005 || u_mix < 0.0005) {
    o_color = vec4(src, 1.0);
    return;
  }

  // 8 taps traced back along the field, exponentially weighted so the
  // first sample (at v_uv) dominates and the trail decays into the distance.
  vec3 acc = vec3(0.0);
  float totalW = 0.0;
  vec2 uv = v_uv;

  for (int i = 0; i < 8; i++) {
    float w = exp(-float(i) * 1.5);
    acc += texture(u_tex, fract(uv)).rgb * w;
    totalW += w;
    // Re-evaluate velocity at each tap so the trail follows field curvature
    uv -= fieldVel(uv) * (u_scan / 8.0);
  }
  acc /= totalW;

  o_color = vec4(mix(src, acc, clamp(u_mix, 0.0, 1.0)), 1.0);
}
