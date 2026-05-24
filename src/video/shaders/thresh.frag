#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_threshold;
uniform float u_tolerance;
uniform float u_amount;

void main() {
  vec4 c = texture(u_tex, v_uv);
  float y = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float t = max(u_tolerance, 1e-4);
  float v = smoothstep(u_threshold - t, u_threshold + t, y);
  v = step(0.5, v);
  vec3 rgb_out = mix(c.rgb, vec3(v), clamp(u_amount, 0.0, 1.0));
  o_color = vec4(rgb_out, c.a);
}
