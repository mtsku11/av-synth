#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_repeatX;
uniform float u_repeatY;
uniform float u_offsetX;
uniform float u_offsetY;

void main() {
  vec4 modTex = texture(u_prev_frame, v_uv);
  float rx = max(1.0, 1.0 + (u_repeatX - 1.0) * modTex.r);
  float ry = max(1.0, 1.0 + (u_repeatY - 1.0) * modTex.g);
  vec2 q = fract(v_uv * vec2(rx, ry) + vec2(u_offsetX, u_offsetY));
  o_color = texture(u_tex, q);
}
