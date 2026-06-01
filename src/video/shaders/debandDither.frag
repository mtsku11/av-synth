#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_radius;
uniform float u_threshold;
uniform int u_iterations;
uniform float u_grain;
uniform float u_debug;
uniform float u_mix;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float bandMetric(vec3 a, vec3 b) {
  vec3 delta = abs(a - b);
  return max(delta.r, max(delta.g, delta.b));
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec2 px = max(vec2(1.0) / max(u_resolution, vec2(1.0)), vec2(1e-5));
  vec3 debanded = src.rgb;
  float bandMask = 0.0;
  float angleSeed = hash12(floor(v_uv * u_resolution) + 0.5) * 6.28318530718;
  vec2 dir = vec2(cos(angleSeed), sin(angleSeed));

  for (int i = 0; i < 4; i += 1) {
    if (i >= u_iterations) break;
    float stepRadius = u_radius * float(i + 1);
    vec2 offset = dir * stepRadius * px;
    vec3 s0 = texture(u_tex, clamp(v_uv + offset, 0.0, 1.0)).rgb;
    vec3 s1 = texture(u_tex, clamp(v_uv - offset, 0.0, 1.0)).rgb;
    vec3 s2 = texture(u_tex, clamp(v_uv + vec2(-offset.y, offset.x), 0.0, 1.0)).rgb;
    vec3 s3 = texture(u_tex, clamp(v_uv + vec2(offset.y, -offset.x), 0.0, 1.0)).rgb;
    vec3 avg = (s0 + s1 + s2 + s3) * 0.25;
    float band = 1.0 - smoothstep(u_threshold * 0.5, u_threshold * 1.75, bandMetric(debanded, avg));
    debanded = mix(debanded, avg, band * 0.42);
    bandMask = max(bandMask, band);
    dir = vec2(dir.y, -dir.x);
  }

  float noise = hash12(floor(v_uv * u_resolution) + vec2(19.19, 73.73)) - 0.5;
  vec3 dithered = debanded + vec3(noise) * (u_grain * bandMask * (1.0 / 96.0));
  vec3 finalColor = mix(src.rgb, clamp(dithered, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));

  if (u_debug > 0.5) {
    finalColor = vec3(bandMask, bandMask * 0.7, 0.0);
  }

  o_color = vec4(finalColor, src.a);
}
