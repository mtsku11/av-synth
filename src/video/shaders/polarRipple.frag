#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_advect;
uniform float u_time;
uniform float u_mix;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_phase;
uniform float u_falloff;
uniform vec2 u_center;
uniform float u_drift;

const float TAU = 6.28318530718;

void main() {
  vec2 d = v_uv - u_center;
  float radius = length(d);
  vec2 dir = radius > 1e-5 ? d / radius : vec2(0.0);
  float driftPhase = u_time * max(u_drift, 0.0) * 3.1;
  float wave = sin(radius * u_frequency * TAU - driftPhase + u_phase * TAU);
  float envelope = exp(-radius * max(u_falloff, 0.0));
  vec2 disp = dir * (u_amplitude * wave * envelope);
  disp = clamp(disp, vec2(-0.2), vec2(0.2));
  vec2 src_uv = fract(v_uv - disp);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
