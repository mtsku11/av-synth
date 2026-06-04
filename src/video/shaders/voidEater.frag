#version 300 es
precision highp float;

// voidEater — Flockaroo-style fluid advection with pixel-block quantization
// and a forced spiral vortex drain.
//
// Two ownedState FBOs (MRT):
//   layout(location=0) → dye buffer  (ownedState,  bindAsPrevFrame, TEXTURE1)
//   layout(location=1) → velocity    (ownedState2, TEXTURE7) — rg=[0,1], 0.5=rest
//
// Frame sequence:
//   1. Flockaroo multi-scale curl from prev velocity.
//   2. Advect + rotate velocity; apply forced spiral vortex at (cx, cy).
//   3. Back-trace dye through velocity at pixel-quantized coordinates.
//   4. Decay dye (trail), inject fresh source.

in vec2 v_uv;
layout(location = 0) out vec4 o_dye;
layout(location = 1) out vec4 o_vel;

uniform sampler2D u_tex;      // TEXTURE0: live video
uniform sampler2D u_prev_dye; // TEXTURE1: previous dye (ownedState, bindAsPrevFrame)
uniform sampler2D u_prev_vel; // TEXTURE7: previous velocity (ownedState2)

uniform float u_mix;
uniform float u_twirl;      // spiral rotation strength, signed (+ = CCW)
uniform float u_sink;       // inward radial pull strength [0, 1]
uniform float u_pixel_size; // quantization block size in pixels [1, 64]
uniform float u_inject;     // fresh video injection rate [0, 1]
uniform float u_trail;      // dye persistence [0,1] → actual [0.82, 1.0]
uniform float u_scale;      // advection spatial scale [0.5, 4]
uniform float u_radius;     // vortex envelope radius [0.05, 1.5]
uniform vec2  u_center;     // vortex center in UV coords
uniform vec2  u_resolution; // FBO pixel dimensions for quantization

const float TAU = 6.28318530718;
#define ROT_NUM 3
// 120° CCW rotation matrix (column-major)
const mat2 ROT_M = mat2(-0.5, 0.866025, -0.866025, -0.5);

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Flockaroo: mean signed curl sampled at ROT_NUM equally-spaced points on a
// circle of radius sc. Returns the local rotation rate of the velocity field.
float getRot(vec2 uv, float sc) {
  float startAng = hash21(uv) * TAU / float(ROT_NUM);
  vec2 p = vec2(cos(startAng), sin(startAng)) * sc;
  float rot = 0.0;
  for (int i = 0; i < ROT_NUM; i++) {
    vec2 v = texture(u_prev_vel, fract(uv + p)).rg - vec2(0.5);
    rot += (v.x * p.y - v.y * p.x) / max(dot(p, p), 1e-6);
    p = ROT_M * p;
  }
  return rot / float(ROT_NUM);
}

// Snap UV to pixel-block centres.
vec2 quantize(vec2 uv) {
  if (u_pixel_size < 1.5) return uv;
  vec2 res = max(u_resolution, vec2(1.0));
  vec2 block = floor(uv * res / u_pixel_size) * u_pixel_size + vec2(u_pixel_size * 0.5);
  return clamp(block / res, vec2(0.0), vec2(1.0));
}

void main() {
  if (u_mix < 0.0005) {
    o_dye = vec4(texture(u_tex, v_uv).rgb, 1.0);
    o_vel = texture(u_prev_vel, v_uv);
    return;
  }

  // Source frame sampled at quantized coords — blocky pixels throughout.
  vec3 src = texture(u_tex, quantize(v_uv)).rgb;

  // ── Flockaroo velocity update ─────────────────────────────────────────────
  float rot = 0.0;
  float sc = u_scale * 0.003;
  for (int i = 0; i < 4; i++) {
    rot += getRot(v_uv, sc);
    sc *= 2.0;
  }
  rot *= 0.28;

  vec2 vel = texture(u_prev_vel, v_uv).rg - vec2(0.5);
  vec2 velAdvUV = fract(v_uv - vel * u_scale * 0.01);
  vec2 advVel = texture(u_prev_vel, velAdvUV).rg - vec2(0.5);

  float cosR = cos(rot), sinR = sin(rot);
  vec2 newVel = vec2(
    cosR * advVel.x - sinR * advVel.y,
    sinR * advVel.x + cosR * advVel.y
  );
  newVel *= 0.997; // mild decay toward rest

  // ── Forced spiral vortex at center ────────────────────────────────────────
  vec2 d    = v_uv - clamp(u_center, vec2(0.02), vec2(0.98));
  float r   = length(d);
  float reach = max(u_radius, 0.05);
  // Envelope: zero at origin (avoids singularity), falls off beyond radius.
  float env = smoothstep(0.0, 0.04, r) * exp(-r / reach);
  vec2 tangent = r > 0.001 ? vec2(-d.y, d.x) / r : vec2(0.0, 1.0); // CCW tangent
  vec2 inward  = r > 0.001 ? -d / r : vec2(0.0);                    // toward center
  vec2 force   = (tangent * u_twirl + inward * u_sink) * env * 0.38;

  // Gently steer velocity toward the forced direction each frame.
  float forceMix = clamp((abs(u_twirl) * 0.018 + u_sink * 0.012), 0.0, 0.06);
  newVel = mix(newVel, force, forceMix);

  newVel = clamp(newVel, vec2(-0.49), vec2(0.49));
  o_vel  = vec4(newVel + vec2(0.5), 0.0, 1.0);

  // ── Dye advection ─────────────────────────────────────────────────────────
  // Back-trace: where did the dye at v_uv come from last frame?
  vec2 dyeUV  = quantize(fract(v_uv - vel * u_scale * 0.012));
  vec3 advDye = texture(u_prev_dye, dyeUV).rgb;

  // Trail decay: 1.0 → no fade (0% decay), 0.0 → 2% decay per frame.
  // Deliberately tight range so the dye stays bright and spiral motion is visible.
  advDye *= 0.98 + u_trail * 0.02;

  // Inject fresh source pixels at a controlled rate.
  vec3 newDye = mix(advDye, src, u_inject * 0.14);

  o_dye = vec4(mix(src, newDye, u_mix), 1.0);
}
