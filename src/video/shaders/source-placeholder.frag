#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
uniform float u_time;

// Slow plasma — shown when no source video is loaded. Lets the user see the
// canvas is alive even with an empty patch.
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float v = 0.5 + 0.5 * sin(r * 6.0 - u_time * 0.5 + a * 2.0);
  vec3 col = mix(vec3(0.02, 0.06, 0.10), vec3(0.40, 0.85, 1.0), v * v);
  o_color = vec4(col, 1.0);
}
