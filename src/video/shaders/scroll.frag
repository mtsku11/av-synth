#version 300 es
// scroll(x, y, speedX, speedY) — simultaneous horizontal and vertical UV translation.
//
//   uv → fract(uv + vec2(x + time·speedX, y + time·speedY))

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_x;
uniform float u_y;
uniform float u_speedX;
uniform float u_speedY;
uniform float u_time;

void main() {
  vec2 q = fract(v_uv + vec2(u_x + u_time * u_speedX, u_y + u_time * u_speedY));
  o_color = texture(u_tex, q);
}
