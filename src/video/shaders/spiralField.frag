#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_advect;
uniform float u_time;
uniform float u_mix;
uniform float u_twist;
uniform float u_radius;
uniform float u_falloff;
uniform vec2 u_center;
uniform float u_phase;
uniform float u_drift;

const float TAU = 6.28318530718;

void main() {
  float drift = max(u_drift, 0.0);
  vec2 orbit = vec2(cos(u_time * drift * 0.52), sin(u_time * drift * 0.68)) * min(u_radius, 1.0) * 0.08;
  vec2 center = clamp(u_center + orbit, vec2(0.0), vec2(1.0));
  vec2 d = v_uv - center;
  float radius = max(length(d), 1e-5);
  float reach = max(u_radius, 0.05);
  float edge = clamp(1.0 - radius / reach, 0.0, 1.0);
  float envelope = pow(edge, max(u_falloff, 0.25));
  float angle = atan(d.y, d.x);
  float phase = u_phase * TAU + u_time * drift * 0.85;
  float twisted = angle + (u_twist + phase * 0.25) * envelope;
  vec2 warped = vec2(cos(twisted), sin(twisted)) * radius;
  vec2 src_uv = fract(center + warped);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
