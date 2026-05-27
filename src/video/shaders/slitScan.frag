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
uniform float u_history_capacity;
uniform float u_history_valid;
uniform float u_history_write_index;

float wrapLayer(float layer, float capacity) {
  float w = mod(layer, capacity);
  return w < 0.0 ? w + capacity : w;
}

void main() {
  vec3 current = texture(u_tex, v_uv).rgb;

  if (u_history_valid < 1.0 || u_mix <= 0.0001 || abs(u_scan_speed) <= 0.0001) {
    o_color = vec4(current, 1.0);
    return;
  }

  float axis    = (u_orientation < 0.5) ? v_uv.x : v_uv.y;
  float slitPos = (u_orientation < 0.5) ? u_slit_x : u_slit_y;
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
  float speed = abs(u_scan_speed) * 0.01;   // UV units per frame at full speed
  bool leftOfSlit = (axis < slitPos - halfW);
  float shiftDir  = leftOfSlit ? 1.0 : -1.0; // always shift toward slit
  float newAxis   = clamp(axis + shiftDir * speed, 0.0, 1.0);

  vec2 shiftedUv = (u_orientation < 0.5)
    ? vec2(newAxis, v_uv.y)
    : vec2(v_uv.x, newAxis);

  float newest = wrapLayer(u_history_write_index - 1.0, u_history_capacity);
  vec3 scanned = texture(u_history_tex, vec3(shiftedUv, newest)).rgb;

  o_color = vec4(clamp(mix(current, scanned, u_mix), 0.0, 1.0), 1.0);
}
