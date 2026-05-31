#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2DArray u_history_tex;
uniform float u_mix;
uniform float u_depth;         // slit width as fraction of axis (0 = hairline, 1 = full)
uniform float u_orientation;   // 0 = vertical slit (scan across X), 1 = horizontal
uniform float u_slit_x;
uniform float u_slit_y;
uniform float u_scan_speed;    // scan rate (0–1 mapped to UV/frame); sign unused
uniform float u_delay_amount;
uniform float u_smear_width;
uniform float u_feedback_blend;
uniform float u_direction;
uniform float u_strobe;
uniform float u_history_capacity;
uniform float u_history_valid;
uniform float u_history_write_index;

float wrapLayer(float layer, float capacity) {
  float w = mod(layer, capacity);
  return w < 0.0 ? w + capacity : w;
}

vec3 sampleHistoryLayer(vec2 uv, float age) {
  float newest = u_history_write_index - 1.0;
  float layer = wrapLayer(newest - age, u_history_capacity);
  return texture(u_history_tex, vec3(clamp(uv, 0.0, 1.0), layer)).rgb;
}

vec3 sampleHistoryAge(vec2 uv, float age) {
  float maxAge = max(u_history_valid - 1.0, 0.0);
  float clampedAge = clamp(age, 0.0, maxAge);
  float lo = floor(clampedAge);
  float hi = min(lo + 1.0, maxAge);
  return mix(sampleHistoryLayer(uv, lo), sampleHistoryLayer(uv, hi), clampedAge - lo);
}

void main() {
  vec3 current = texture(u_tex, v_uv).rgb;

  if (u_history_valid < 1.0 || u_mix <= 0.0001 || abs(u_scan_speed) <= 0.0001) {
    o_color = vec4(current, 1.0);
    return;
  }

  float axis    = (u_orientation < 0.5) ? v_uv.x : v_uv.y;
  float slitPos = (u_orientation < 0.5) ? u_slit_x : u_slit_y;
  vec2 centre = vec2(u_slit_x, u_slit_y);
  vec2 delta = v_uv - centre;
  float radius = length(delta) / 0.70710678118;
  float angle = atan(delta.y, delta.x) / 6.28318530718 + 0.5;
  if (u_orientation > 1.5 && u_orientation < 2.5) {
    axis = radius;
    slitPos = 0.0;
  } else if (u_orientation > 2.5) {
    axis = fract(radius + angle);
    slitPos = 0.0;
  }
  // u_depth is the full slit width as a fraction of the axis (0–1).
  float halfW   = clamp(u_depth * 0.5, 0.0, 0.5);

  if (axis >= slitPos - halfW && axis <= slitPos + halfW) {
    // Inside the slit band: always show the current source frame so fresh
    // content enters the feedback loop here every frame.
    o_color = vec4(current, 1.0);
    return;
  }

  // Outside the slit: read from the previous rendered output (history[newest])
  // at a UV coordinate shifted one step toward the slit. Each frame the
  // content moves one step, so the trail grows outward from the slit over time
  // — the classic slit-scan accumulation effect.
  float speed = abs(u_scan_speed) * 0.01 * sign(u_direction);   // UV units per frame at full speed
  bool leftOfSlit = (axis < slitPos - halfW);
  float shiftDir  = leftOfSlit ? 1.0 : -1.0; // always shift toward slit
  float newAxis   = clamp(axis + shiftDir * speed, 0.0, 1.0);

  vec2 shiftedUv;
  if (u_orientation < 0.5) {
    shiftedUv = vec2(newAxis, v_uv.y);
  } else if (u_orientation < 1.5) {
    shiftedUv = vec2(v_uv.x, newAxis);
  } else {
    vec2 radial = length(delta) > 1e-5 ? normalize(delta) : vec2(0.0);
    vec2 tangent = vec2(-radial.y, radial.x);
    vec2 field = u_orientation < 2.5 ? -radial : normalize(-radial + tangent * 0.72);
    shiftedUv = v_uv + field * speed;
  }

  float ageSpan = max(u_history_valid - 1.0, 0.0) * clamp(u_delay_amount, 0.0, 1.0);
  float distanceFromSlit = abs(axis - slitPos);
  float agePosition = clamp(distanceFromSlit * clamp(u_smear_width, 0.0, 1.0), 0.0, 1.0);
  float age = ageSpan * pow(agePosition, mix(1.55, 0.72, clamp(u_feedback_blend, 0.0, 1.0)));
  float strobeStep = mix(1.0, max(ageSpan, 1.0), clamp(u_strobe, 0.0, 1.0));
  age = floor(age / strobeStep + 0.5) * strobeStep;
  vec3 propagated = sampleHistoryAge(shiftedUv, 0.0);
  vec3 delayed = sampleHistoryAge(shiftedUv, min(age, ageSpan));
  vec3 scanned = mix(propagated, delayed, clamp(u_feedback_blend, 0.0, 1.0));

  o_color = vec4(clamp(mix(current, scanned, u_mix), 0.0, 1.0), 1.0);
}
