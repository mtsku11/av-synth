#version 300 es
// repeat(axis, repeatX, repeatY, offsetX, offsetY) — UV tiling (plan.md §2.4).
//
//   axis 0 (both): fract(uv · [rx, ry] + [ox, oy])
//   axis 1 (X-only): fract(uv.x · rx + ox), uv.y unchanged
//   axis 2 (Y-only): uv.x unchanged, fract(uv.y · ry + oy)

precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_axis;
uniform float u_repeatX;
uniform float u_repeatY;
uniform float u_offsetX;
uniform float u_offsetY;

void main() {
  int axis = int(round(u_axis));
  vec2 q;
  if (axis == 1) {
    q = vec2(fract(v_uv.x * u_repeatX + u_offsetX), v_uv.y);
  } else if (axis == 2) {
    q = vec2(v_uv.x, fract(v_uv.y * u_repeatY + u_offsetY));
  } else {
    q = fract(v_uv * vec2(u_repeatX, u_repeatY) + vec2(u_offsetX, u_offsetY));
  }
  o_color = texture(u_tex, q);
}
