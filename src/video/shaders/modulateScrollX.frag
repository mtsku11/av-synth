#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_amount;
uniform float u_speed;
uniform float u_time;

void main() {
  float modSample = texture(u_prev_frame, v_uv).r * 2.0 - 1.0;
  vec2 q = vec2(fract(v_uv.x + modSample * u_amount + u_time * u_speed), v_uv.y);
  o_color = texture(u_tex, q);
}
