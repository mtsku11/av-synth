#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;
// Shared with the audio side: a global logistic-map state derived from
// ctx.time, iterated identically here and in ColoramaRingModAudioStage so the
// visual chaos and the audio carrier evolve as one stream rather than two
// coincident streams. plan.md §3.11 / memory.md 2026-05-18 colorama entry.
uniform float u_time;

// Same HSV-rotation matrix used by hue.frag (Rodrigues-style around the
// achromatic axis). Kept duplicated rather than factored out — one shader
// per operator is the project convention.
vec3 rotateHue(vec3 rgb, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  float k = (1.0 - c) / 3.0;
  float sq = sqrt(1.0 / 3.0) * s;
  mat3 m = mat3(
    c + k, k + sq, k - sq,
    k - sq, c + k, k + sq,
    k + sq, k - sq, c + k
  );
  return m * rgb;
}

// Per-pixel logistic-map seed in (0.05, 0.95). The hash steers neighbouring
// pixels into different orbits so the result reads as a scramble, not a stripe.
float seedFromUv(vec2 uv) {
  float h = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  return 0.05 + h * 0.9;
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  // Per-pixel chaos: logistic iterations seeded from a UV hash. This is the
  // spatial decorrelation that makes the result read as a scramble rather
  // than a stripe. Static for a given pixel — the temporal motion comes from
  // xGlobal below.
  float xPixel = seedFromUv(v_uv);
  for (int i = 0; i < 4; i++) {
    xPixel = 3.99 * xPixel * (1.0 - xPixel);
  }
  // Global chaos driven by time, shared bit-for-bit with the audio stage.
  // Iteration count quantises to 200 ms steps (rate = 5 Hz) so chaos reads as
  // motion, not jitter. Cap at 64 iterations — chaos is already fully
  // decorrelated from the seed by then, so longer sessions stay bounded.
  float xGlobal = 0.37;
  int steps = int(floor(u_time * 5.0)) + 1;
  if (steps > 64) steps = 64;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    xGlobal = 3.99 * xGlobal * (1.0 - xGlobal);
    if (xGlobal < 0.001 || xGlobal > 0.999) xGlobal = 0.37;
  }
  // amount=0 is exactly identity regardless of either chaos value.
  float hueDelta = u_amount * ((xPixel - 0.5) + (xGlobal - 0.5)) * 6.283185307179586;
  vec3 rgb = rotateHue(c.rgb, hueDelta);
  o_color = vec4(rgb, c.a);
}
