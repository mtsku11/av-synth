#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform vec2 u_resolution;
uniform float u_mix;
uniform float u_mode;
uniform float u_threshold;
uniform float u_softness;
uniform float u_displace;
uniform float u_memory;
uniform float u_glow;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float pickStructure(vec4 structureSample) {
  float mode = clamp(u_mode, 0.0, 1.0);
  if (mode < 0.5) return mix(structureSample.r, structureSample.g, mode * 2.0);
  return mix(structureSample.g, structureSample.b, (mode - 0.5) * 2.0);
}

vec4 sampleStructure(vec2 uv) {
  vec2 clampedUv = clamp(uv, 0.0, 1.0);
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec3 centerColor = texture(u_tex, clampedUv).rgb;
  float center = luma(centerColor);
  float left = luma(texture(u_tex, clamp(clampedUv - vec2(px.x, 0.0), 0.0, 1.0)).rgb);
  float right = luma(texture(u_tex, clamp(clampedUv + vec2(px.x, 0.0), 0.0, 1.0)).rgb);
  float up = luma(texture(u_tex, clamp(clampedUv - vec2(0.0, px.y), 0.0, 1.0)).rgb);
  float down = luma(texture(u_tex, clamp(clampedUv + vec2(0.0, px.y), 0.0, 1.0)).rgb);
  float gx = right - left;
  float gy = down - up;
  float edge = clamp(length(vec2(gx, gy)) * 0.9, 0.0, 1.0);
  float prevLuma = luma(texture(u_prev_frame, clampedUv).rgb);
  float flux = clamp(abs(center - prevLuma) * 5.5, 0.0, 1.0);
  float contour = clamp(
    edge * (0.55 + smoothstep(0.24, 0.82, center) * 0.65) + flux * 0.25,
    0.0,
    1.0
  );
  return vec4(center, edge, flux, contour);
}

float sampleStructureValue(vec2 uv) {
  return pickStructure(sampleStructure(uv));
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec3 current = texture(u_tex, v_uv).rgb;
  vec4 analysis = sampleStructure(v_uv);
  float structure = pickStructure(analysis);
  float softness = max(0.001, u_softness);
  float mask = smoothstep(u_threshold - softness, u_threshold + softness, structure);

  float structureLeft = sampleStructureValue(v_uv - vec2(px.x, 0.0));
  float structureRight = sampleStructureValue(v_uv + vec2(px.x, 0.0));
  float structureUp = sampleStructureValue(v_uv - vec2(0.0, px.y));
  float structureDown = sampleStructureValue(v_uv + vec2(0.0, px.y));
  vec2 gradient = vec2(structureRight - structureLeft, structureDown - structureUp);

  vec2 displacement =
    gradient * (10.0 + analysis.a * 10.0) * clamp(u_displace, 0.0, 1.0) * px;
  vec2 displacedUv = clamp(v_uv + displacement, 0.0, 1.0);
  vec3 displaced = texture(u_tex, displacedUv).rgb;
  vec3 previous = texture(
    u_prev_frame,
    clamp(v_uv + displacement * (0.6 + clamp(u_memory, 0.0, 1.0) * 0.7), 0.0, 1.0)
  ).rgb;

  float memory = clamp(u_memory, 0.0, 1.0) * mask;
  vec3 wet = mix(displaced, previous, memory);

  float contour = max(analysis.g, analysis.a);
  float glow = clamp(u_glow, 0.0, 1.0) * max(mask, contour * 0.75);
  vec3 glowTint = mix(vec3(0.94, 0.98, 1.0), vec3(1.0, 0.92, 0.84), analysis.r);
  wet += glowTint * contour * glow * (0.18 + analysis.b * 0.16);

  float edgeLift = glow * analysis.g * 0.35;
  wet = mix(wet, max(wet, current + vec3(edgeLift)), glow * 0.45);

  o_color = vec4(mix(current, wet, clamp(u_mix, 0.0, 1.0)), 1.0);
}
