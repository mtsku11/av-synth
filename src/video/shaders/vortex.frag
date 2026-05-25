#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_strength;
uniform float u_softness;
uniform int u_vortex_count;

// Packed as (x, y, w, _) per vortex. Position is in normalised UV space,
// w is signed rotation strength (~ -1.2 .. 1.2). Kept as a vec4 array so
// drivers don't pad std140 quirkily across vec2/float boundaries.
uniform vec4 u_vortices[64];

// 2D point-vortex (Biot-Savart) velocity, summed over all active vortices.
// Each vortex contributes ( -dy, dx ) * w / ( r^2 + softness ). Toroidal
// wrap on the UV difference so swirls at the edges still couple smoothly.
vec2 velocityAt(vec2 uv) {
  vec2 vel = vec2(0.0);
  float soft = u_softness * u_softness + 1e-4;
  for (int i = 0; i < 64; i++) {
    if (i >= u_vortex_count) break;
    vec4 vortex = u_vortices[i];
    vec2 d = vortex.xy - uv;
    d -= floor(d + 0.5);
    float r2 = dot(d, d) + soft;
    vel += vec2(-d.y, d.x) * vortex.z / r2;
  }
  return vel;
}

void main() {
  vec2 vel = velocityAt(v_uv);
  vec2 src_uv = fract(v_uv - vel * u_strength);
  vec3 displaced = texture(u_tex, src_uv).rgb;
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
