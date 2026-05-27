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
uniform int u_cells;
uniform float u_scale;
uniform float u_phase;
uniform float u_bias;
uniform float u_drift;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

void main() {
  vec2 grid = u_cells < 3 ? vec2(2.0, 1.0) : vec2(2.0, 2.0);
  vec2 p = (v_uv - 0.5) * u_scale + 0.5;
  float phase = u_phase * TAU + u_time * max(u_drift, 0.0) * 0.75;
  float ax = PI * grid.x;
  float ay = PI * grid.y;
  float sx = sin(ax * p.x + phase);
  float cx = cos(ax * p.x + phase);
  float sy = sin(ay * (p.y + u_bias * 0.08) - phase * 0.7);
  float cy = cos(ay * (p.y + u_bias * 0.08) - phase * 0.7);
  vec2 vel = vec2(ay * cy * sx, -ax * cx * sy);
  vel *= 0.03 / max(u_scale, 0.25);
  vel += u_bias * vec2(-sy, cx) * 0.012;
  vel = clamp(vel * u_strength, vec2(-0.3), vec2(0.3));
  vec2 src_uv = fract(v_uv - vel);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
