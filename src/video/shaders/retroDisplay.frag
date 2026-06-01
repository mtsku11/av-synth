#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scanlines;
uniform float u_mask;
uniform float u_warp;
uniform float u_bleed;
uniform float u_phosphor;
uniform float u_noise;
uniform float u_roll;
uniform float u_mix;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 warpUv(vec2 uv, float warp) {
  vec2 centered = uv * 2.0 - 1.0;
  float radius = dot(centered, centered);
  centered *= 1.0 + radius * warp * 0.22;
  return centered * 0.5 + 0.5;
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec2 rolledUv = v_uv;
  rolledUv.y = fract(rolledUv.y + u_time * u_roll * 0.04);
  vec2 uv = warpUv(rolledUv, u_warp);
  vec2 px = max(vec2(1.0) / max(u_resolution, vec2(1.0)), vec2(1e-5));

  float inside =
    step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);

  vec3 base = texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
  float bleedPx = u_bleed * 2.8;
  vec3 triad = vec3(
    texture(u_tex, clamp(uv + vec2(bleedPx * px.x, 0.0), 0.0, 1.0)).r,
    texture(u_tex, clamp(uv, 0.0, 1.0)).g,
    texture(u_tex, clamp(uv - vec2(bleedPx * px.x, 0.0), 0.0, 1.0)).b
  );
  vec3 color = mix(base, triad, clamp(u_bleed, 0.0, 1.0) * 0.75);

  float linePhase = uv.y * u_resolution.y * 3.14159265;
  float scanlineMask = 0.78 + 0.22 * cos(linePhase);
  color *= mix(1.0, scanlineMask, clamp(u_scanlines, 0.0, 1.0));

  float triadIndex = mod(floor(uv.x * u_resolution.x), 3.0);
  vec3 maskColor = triadIndex < 1.0
    ? vec3(1.0, 0.84, 0.76)
    : triadIndex < 2.0
      ? vec3(0.78, 1.0, 0.86)
      : vec3(0.82, 0.88, 1.0);
  color *= mix(vec3(1.0), maskColor, clamp(u_mask, 0.0, 1.0) * 0.32);

  vec3 phosphorBlur =
    texture(u_tex, clamp(uv + vec2(0.0, px.y), 0.0, 1.0)).rgb * 0.25 +
    texture(u_tex, clamp(uv - vec2(0.0, px.y), 0.0, 1.0)).rgb * 0.25;
  vec3 prev = texture(u_prev_frame, clamp(uv, 0.0, 1.0)).rgb;
  color = mix(color, max(color, phosphorBlur + prev * 0.92), clamp(u_phosphor, 0.0, 1.0) * 0.4);

  float noise = hash12(floor(uv * u_resolution) + vec2(u_time * 31.0, u_time * 19.0)) - 0.5;
  color += vec3(noise) * (u_noise * 0.06);
  color *= inside;

  vec3 outColor = mix(src.rgb, clamp(color, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));
  o_color = vec4(outColor, src.a);
}
