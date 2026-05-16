#version 300 es
// pixelate(pixelX, pixelY) — UV-domain quantisation (Hydra plan.md §2.3).
//
//   uv → (floor(uv · N) + 0.5) / N
//
// Audio analogue: per-channel sample-rate reduction at SR/(2·N). Cascaded with
// the visual: the same N that quantises pixels lowpasses the signal at the
// corresponding Nyquist of the decimated rate.

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_pixelX;
uniform float u_pixelY;

void main() {
  vec2 n = vec2(max(u_pixelX, 1.0), max(u_pixelY, 1.0));
  vec2 q = (floor(v_uv * n) + 0.5) / n;
  o_color = texture(u_tex, q);
}
