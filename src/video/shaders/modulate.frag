#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount; // 0..1 — UV displacement magnitude
uniform float u_time;   // seconds, ctx.time
uniform float u_rate;   // Hz, ctx.rate

// plan.md §5.1 — modulate is function composition in the UV domain:
//   output(uv) = base(uv + amount · mod(uv, t))
// For M2 the modulator is an internal sin/cos pattern animated at the global
// rate (clock.rate). M3+ will allow external modulator chains.
void main() {
  float omega = u_time * u_rate * 6.28318530718;
  vec2 offset = vec2(
    sin(v_uv.x * 6.28318530718 + omega),
    cos(v_uv.y * 6.28318530718 + omega)
  ) * u_amount * 0.1;
  o_color = texture(u_tex, v_uv + offset);
}
