#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_strength;
uniform float u_softness;
uniform float u_anisotropy;
uniform int u_count;

// Each saddle packed as ( px, py, axis_x, axis_y ). `axis` has length 1
// — strength is uniform, orientation is per-saddle. Drift-rotated on CPU.
uniform vec4 u_saddles[24];

// 2D saddle around a point: in the saddle's local frame the velocity is
// ( x, -anisotropy * y ), which stretches matter along the axis and
// compresses it across. The Gaussian envelope localises each saddle so
// they read as discrete currents rather than a single field.
vec2 saddleVel(vec2 uv, vec4 s) {
  vec2 d = uv - s.xy;
  d -= floor(d + 0.5);
  vec2 axis = s.zw;
  vec2 perp = vec2(-axis.y, axis.x);
  float u = dot(d, axis);
  float v = dot(d, perp);
  float r2 = u * u + v * v;
  float envelope = exp(-r2 / (u_softness * u_softness + 1e-4));
  vec2 localVel = vec2(u, -u_anisotropy * v);
  return (axis * localVel.x + perp * localVel.y) * envelope;
}

void main() {
  vec2 vel = vec2(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= u_count) break;
    vel += saddleVel(v_uv, u_saddles[i]);
  }
  vec2 src_uv = fract(v_uv - vel * u_strength);
  vec3 displaced = texture(u_tex, src_uv).rgb;
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
