#version 300 es
// scrollY(amount, speed) — vertical UV translation (plan.md §2.7).
//
//   uv.y → fract(uv.y + amount + time · speed)
//
// Audio analogue: stereo pan. `amount` sets the pan position; `speed`
// modulates it at speed Hz (auto-pan).

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;
uniform float u_speed;
uniform float u_time;

void main() {
  vec2 q = vec2(v_uv.x, fract(v_uv.y + u_amount + u_time * u_speed));
  o_color = texture(u_tex, q);
}
