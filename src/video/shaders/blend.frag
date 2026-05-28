#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;
uniform int u_mode;  // 0=over, 1=add, 2=multiply, 3=screen

void main() {
  vec3 a = texture(u_tex,   v_uv).rgb;
  vec3 b = texture(u_tex_b, v_uv).rgb;
  float m = clamp(u_amount, 0.0, 1.0);

  vec3 blended;
  if (u_mode == 1) {
    blended = a + b * m;
  } else if (u_mode == 2) {
    blended = a * mix(vec3(1.0), b, m);
  } else if (u_mode == 3) {
    vec3 s = 1.0 - (1.0 - a) * (1.0 - b);
    blended = mix(a, s, m);
  } else {
    blended = mix(a, b, m);
  }
  o_color = vec4(blended, 1.0);
}
