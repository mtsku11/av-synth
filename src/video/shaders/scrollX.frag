#version 300 es
// scrollX(amount, speed) — horizontal UV translation (plan.md §2.7).
//
//   uv.x → fract(uv.x + amount + time · speed)
//
// Audio analogue: delay-line scrub. `amount` sets the static delay-tap
// position; `speed` modulates it at speed Hz (auto-vibrato when audio-rate).

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;
uniform float u_speed;
uniform float u_time;

void main() {
  vec2 q = vec2(fract(v_uv.x + u_amount + u_time * u_speed), v_uv.y);
  o_color = texture(u_tex, q);
}
