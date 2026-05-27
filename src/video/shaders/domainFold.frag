#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_advect;
uniform float u_time;
uniform float u_mix;
uniform float u_folds;
uniform float u_angle;
uniform float u_softness;
uniform float u_zoom;
uniform float u_drift;

const float PI = 3.14159265359;

vec2 rotate2d(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec2 foldAxis(vec2 p, float folds, float softness) {
  vec2 scaled = (p + 0.5) * folds;
  vec2 tri = abs(fract(scaled) - 0.5) * 2.0;
  float soft = clamp(softness * 2.0, 0.0, 1.0);
  vec2 rounded = 0.5 - 0.5 * cos(tri * PI);
  vec2 blended = mix(tri, rounded, soft);
  return (blended - 0.5) / max(folds, 1.0);
}

void main() {
  float angle = u_angle + u_time * max(u_drift, 0.0) * 0.42;
  vec2 p = rotate2d(v_uv - 0.5, angle) * max(u_zoom, 0.25);
  vec2 folded = foldAxis(p, max(u_folds, 1.0), u_softness);
  vec2 src_uv = fract(rotate2d(folded / max(u_zoom, 0.25), -angle) + 0.5);
  vec3 displaced = mix(
    texture(u_tex, src_uv).rgb,
    texture(u_prev_frame, fract(2.0 * v_uv - src_uv)).rgb,
    clamp(u_advect, 0.0, 0.95)
  );
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
