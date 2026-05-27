#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_advect;
uniform float u_time;
uniform float u_mix;
uniform float u_strength;
uniform float u_scale;
uniform int u_octaves;
uniform float u_phase;
uniform float u_anisotropy;
uniform float u_drift;

const float TAU = 6.28318530718;

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

void main() {
  float phase = u_phase * TAU + u_time * max(u_drift, 0.0) * 0.6;
  vec2 stretch = vec2(exp(u_anisotropy * 0.55), exp(-u_anisotropy * 0.55));
  vec2 p = v_uv * (u_scale * stretch) + vec2(cos(phase), sin(phase)) * 2.7;
  vec2 acc = vec2(0.0);
  float amp = 1.0;
  float ampSum = 0.0;
  vec2 warpOffset = vec2(17.31, -9.17);
  for (int i = 0; i < 5; i++) {
    if (i >= u_octaves) break;
    float nx = vnoise(p + warpOffset);
    float ny = vnoise(p.yx * vec2(1.21, 0.87) - warpOffset);
    acc += (vec2(nx, ny) * 2.0 - 1.0) * amp;
    ampSum += amp;
    p = p * 2.03 + vec2(4.2, -3.7);
    amp *= 0.5;
    warpOffset = warpOffset.yx * vec2(-0.91, 1.13) + 0.37;
  }
  vec2 vel = ampSum > 0.0 ? acc / ampSum : vec2(0.0);
  vel = clamp(vel, vec2(-1.0), vec2(1.0));
  vec2 src_uv = fract(v_uv - vel * u_strength * 0.18);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
