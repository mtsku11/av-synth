#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_nSides; // 1 .. 12; effective number of polar segments
uniform float u_drive;
uniform float u_symmetry;
uniform float u_bias;
uniform float u_tone;
uniform float u_output;
uniform float u_mix;

// plan.md §2.6 — polar fold with n-way rotational symmetry.
// Map UVs into one wedge of the n-fold symmetry, then mirror.
void main() {
  vec4 base = texture(u_tex, v_uv);
  vec2 p = v_uv - 0.5;
  p.x += clamp(u_bias, -1.0, 1.0) * 0.18;
  float r = length(p);
  float a = atan(p.y, p.x);

  float n = max(1.0, u_nSides);
  float seg = 3.14159265 * 2.0 / n;
  float driveNorm = clamp((u_drive - 1.0) / 3.0, 0.0, 1.0);
  float foldCenter = clamp(0.5 + u_symmetry * 0.22, 0.08, 0.92);
  a = mod(a, seg);
  a = abs(a - seg * foldCenter);
  r = pow(min(r * mix(1.0, 1.08, driveNorm), 1.2), mix(1.0, 0.82, driveNorm));

  vec2 q = vec2(cos(a), sin(a)) * r + 0.5;
  vec4 sharp = texture(u_tex, q);
  vec2 px = 1.0 / vec2(textureSize(u_tex, 0));
  vec4 blurred = (
    texture(u_tex, q) +
    texture(u_tex, q + vec2(px.x, 0.0) * 1.5) +
    texture(u_tex, q - vec2(px.x, 0.0) * 1.5) +
    texture(u_tex, q + vec2(0.0, px.y) * 1.5) +
    texture(u_tex, q - vec2(0.0, px.y) * 1.5)
  ) / 5.0;
  vec4 folded = mix(blurred, sharp, clamp(u_tone, 0.0, 1.0));
  folded.rgb *= u_output;
  o_color = mix(base, folded, clamp(u_mix, 0.0, 1.0));
}
