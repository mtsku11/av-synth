#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;

// Identity copy. The previous polish blur + peak-decay terms darkened the
// stored history proportional to feedback, which collapsed any trail-shaped
// op (mix(current, prev_frame, fb)) toward black. Master limiter handles
// overflow protection; this pass must hand `final` back unaltered.
void main() {
  o_color = vec4(texture(u_tex, clamp(v_uv, 0.0, 1.0)).rgb, 1.0);
}
