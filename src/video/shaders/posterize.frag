#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_bins;   // 1 .. 64 — number of quantisation levels per channel
uniform float u_gamma;  // companding curve, > 0 (e.g. 0.3 .. 2.5)

// plan.md §3.1
// colour -> floor( colour^gamma * bins ) / bins
//
// gamma < 1 emphasises shadows (more bands in darks), gamma > 1 emphasises
// highlights. Bins must be at least 1.
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  c = pow(max(c, 0.0), vec3(u_gamma));
  float bins = max(u_bins, 1.0);
  c = floor(c * bins) / bins;
  // Restore approximate luminance after companding.
  c = pow(c, vec3(1.0 / u_gamma));
  o_color = vec4(c, 1.0);
}
