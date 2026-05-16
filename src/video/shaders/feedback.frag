#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;         // current input from upstream stage
uniform sampler2D u_prev_frame;  // final output of the previous frame
uniform float u_feedback;        // 0..0.95 — mix with previous output

// plan.md §9 — equivalent to src(o0).blend(o1, feedback) in Hydra terms.
void main() {
  vec3 current = texture(u_tex, v_uv).rgb;
  vec3 prev = texture(u_prev_frame, v_uv).rgb;
  vec3 mixed = mix(current, prev, clamp(u_feedback, 0.0, 0.95));
  o_color = vec4(mixed, 1.0);
}
