#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_advect;
uniform float u_time;
uniform float u_mix;
uniform float u_amount;
uniform float u_radius;
uniform float u_falloff;
uniform vec2 u_center;
uniform float u_drift;

void main() {
  float drift = max(u_drift, 0.0);
  vec2 orbit = vec2(cos(u_time * drift * 0.73), sin(u_time * drift * 0.59)) * min(u_radius, 1.0) * 0.08;
  vec2 center = clamp(u_center + orbit, vec2(0.0), vec2(1.0));
  vec2 d = v_uv - center;
  float dist = length(d);
  float reach = max(u_radius, 0.05);
  float normDist = clamp(dist / reach, 0.0, 1.0);
  float envelope = pow(1.0 - normDist, max(u_falloff, 0.25));
  float factor = 1.0 - u_amount * envelope * 0.65;
  factor = clamp(factor, 0.25, 2.5);
  vec2 src_uv = dist < reach ? fract(center + d * factor) : v_uv;
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
