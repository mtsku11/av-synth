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
uniform float u_separation;
uniform float u_angle;
uniform float u_falloff;
uniform vec2 u_center;
uniform float u_balance;
uniform float u_drift;

vec2 poleField(vec2 uv, vec2 pole, float falloff, float weight) {
  vec2 d = uv - pole;
  float dist = max(length(d), 1e-5);
  float softened = pow(dist + 0.03, max(falloff, 0.25));
  return (d / dist) * (weight / softened);
}

void main() {
  float drift = max(u_drift, 0.0);
  vec2 centerOrbit = vec2(cos(u_time * drift * 0.49), sin(u_time * drift * 0.71)) * min(u_separation, 1.0) * 0.09;
  vec2 center = clamp(u_center + centerOrbit, vec2(0.0), vec2(1.0));
  float angle = u_angle + u_time * drift * 0.54;
  vec2 axis = vec2(cos(angle), sin(angle));
  vec2 offset = axis * (u_separation * 0.5);
  vec2 poleA = center - offset;
  vec2 poleB = center + offset;
  float weightA = 1.0 + clamp(u_balance, -1.0, 1.0) * 0.6;
  float weightB = 1.0 - clamp(u_balance, -1.0, 1.0) * 0.6;
  vec2 field = poleField(v_uv, poleA, u_falloff, weightA) - poleField(v_uv, poleB, u_falloff, weightB);
  field = clamp(field * u_strength * 0.03, vec2(-0.3), vec2(0.3));
  vec2 src_uv = fract(v_uv - field);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, src_uv).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
