#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;
uniform float u_source; // 0=internal oscillator, 1=routed u_tex_b
uniform float u_time;
uniform float u_rate;

void main() {
  if (u_source > 0.5) {
    vec2 modSample = texture(u_tex_b, v_uv).rg * 2.0 - 1.0;
    o_color = texture(u_tex, v_uv + modSample * (u_amount * 0.12));
  } else {
    float omega = u_time * u_rate * 6.28318530718;
    vec2 offset = vec2(
      sin(v_uv.x * 6.28318530718 + omega),
      cos(v_uv.y * 6.28318530718 + omega)
    ) * u_amount * 0.1;
    o_color = texture(u_tex, v_uv + offset);
  }
}
