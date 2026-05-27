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
uniform float u_radius;
uniform float u_falloff;
uniform vec2 u_center;
uniform float u_spin;
uniform float u_drift;

void main() {
  float drift = max(u_drift, 0.0);
  vec2 orbit = vec2(cos(u_time * drift * 0.61), sin(u_time * drift * 0.83)) * min(u_radius, 1.0) * 0.11;
  vec2 center = clamp(u_center + orbit, vec2(0.0), vec2(1.0));
  vec2 d = v_uv - center;
  float dist = length(d);
  vec2 dir = dist > 1e-5 ? d / dist : vec2(0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float reach = max(u_radius, 0.05);
  float edge = clamp(1.0 - dist / reach, 0.0, 1.0);
  float envelope = pow(edge, max(u_falloff, 0.25));
  vec2 field = (dir + perp * u_spin) * u_strength * envelope * 0.16;
  field = clamp(field, vec2(-0.3), vec2(0.3));
  vec2 src_uv = fract(v_uv - field);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
