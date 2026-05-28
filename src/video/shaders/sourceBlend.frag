#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_source_b;
uniform float u_mix;
uniform float u_mode;  // 0=over, 1=add, 2=multiply, 3=screen

void main() {
  vec3 a = texture(u_tex,      v_uv).rgb;
  vec3 b = texture(u_source_b, v_uv).rgb;
  float m = clamp(u_mix, 0.0, 1.0);

  vec3 blended;
  int mode = int(round(u_mode));
  if (mode == 1) {
    blended = a + b * m;
  } else if (mode == 2) {
    blended = a * mix(vec3(1.0), b, m);
  } else if (mode == 3) {
    vec3 s = 1.0 - (1.0 - a) * (1.0 - b);
    blended = mix(a, s, m);
  } else {
    // mode 0: over — dissolve between chain and source B
    blended = mix(a, b, m);
  }
  o_color = vec4(blended, 1.0);
}
