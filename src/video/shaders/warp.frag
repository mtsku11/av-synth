#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_time;
uniform float u_mode;     // 0=lens (pinch/bulge), 1=flow (sink/source)
uniform float u_mix;
uniform float u_strength; // lens: scale factor [-1.5,1.5]; flow: field magnitude
uniform float u_radius;
uniform float u_falloff;
uniform vec2  u_center;
uniform float u_spin;     // flow mode: tangential curl; ignored in lens mode
uniform float u_drift;
uniform float u_advect;

void main() {
  float drift = max(u_drift, 0.0);
  float reach = max(u_radius, 0.05);
  vec2 src_uv;

  if (u_mode < 0.5) {
    // lens mode: barrel/pincushion distortion (pinchBulge)
    vec2 orbit = vec2(cos(u_time * drift * 0.73), sin(u_time * drift * 0.59)) * min(u_radius, 1.0) * 0.08;
    vec2 center = clamp(u_center + orbit, vec2(0.0), vec2(1.0));
    vec2 d = v_uv - center;
    float dist = length(d);
    float normDist = clamp(dist / reach, 0.0, 1.0);
    float envelope = pow(1.0 - normDist, max(u_falloff, 0.25));
    float factor = 1.0 - u_strength * envelope * 0.65;
    factor = clamp(factor, 0.25, 2.5);
    src_uv = dist < reach ? fract(center + d * factor) : v_uv;
  } else {
    // flow mode: radial vector-field displacement with optional spin (sinkSourceField)
    vec2 orbit = vec2(cos(u_time * drift * 0.61), sin(u_time * drift * 0.83)) * min(u_radius, 1.0) * 0.11;
    vec2 center = clamp(u_center + orbit, vec2(0.0), vec2(1.0));
    vec2 d = v_uv - center;
    float dist = length(d);
    vec2 dir = dist > 1e-5 ? d / dist : vec2(0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float edge = clamp(1.0 - dist / reach, 0.0, 1.0);
    float envelope = pow(edge, max(u_falloff, 0.25));
    vec2 field = (dir + perp * u_spin) * u_strength * envelope * 0.16;
    field = clamp(field, vec2(-0.3), vec2(0.3));
    src_uv = fract(v_uv - field);
  }

  float advect = clamp(u_advect, 0.0, 1.0);
  vec3 live = texture(u_tex, src_uv).rgb;
  vec3 carried = texture(u_prev_frame, src_uv).rgb;
  float inject = (1.0 - advect) * 0.5;
  vec3 displaced = advect > 0.0001 ? mix(carried, live, inject) : live;
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
