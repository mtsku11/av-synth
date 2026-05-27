#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_mix;
uniform float u_threshold;
uniform float u_direction;
uniform float u_speed;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec3 live = texture(u_tex, v_uv).rgb;

  vec2 px      = 1.0 / vec2(textureSize(u_prev_frame, 0));
  float steps  = max(1.0, round(clamp(u_speed, 1.0, 32.0)));
  vec2 sortDir = u_direction < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 offset  = sortDir * px * steps;

  vec3 curr  = texture(u_prev_frame, v_uv).rgb;
  vec3 ahead = texture(u_prev_frame, clamp(v_uv + offset, 0.0, 1.0)).rgb;

  float keyCurr  = luma(curr);
  float keyAhead = luma(ahead);
  float thresh   = clamp(u_threshold, 0.0, 1.0);

  bool currActive  = keyCurr  > thresh;
  bool aheadActive = keyAhead > thresh;

  vec3 sorted = curr;

  // Bubble sort step: if both segments are active and ahead pixel is brighter,
  // pull it here — bright pixels stream backward along sortDir over frames.
  if (currActive && aheadActive && keyCurr < keyAhead) {
    sorted = ahead;
  }

  // Below-threshold pixels are break points — reset to live input.
  if (!currActive) sorted = live;

  o_color = vec4(mix(live, sorted, clamp(u_mix, 0.0, 1.0)), 1.0);
}
