#version 300 es

// Instanced quad draw: each instance is one grain voice.
// Per-instance attributes carry center position, frame layer index, and envelope alpha.
// The quad corners are generated procedurally from gl_VertexID (0..3, triangle strip)
// so no base vertex buffer is needed.

layout(location = 0) in vec2 a_center;
layout(location = 1) in float a_layer;
layout(location = 2) in float a_alpha;
layout(location = 3) in float a_amplitude;

uniform vec2 u_halfSize;
// Fraction of the source frame each grain samples (1.0 = full frame, 0.5 = 50% crop).
// The crop window is centred on the grain's screen position in UV space.
uniform float u_uvScale;
// 0 = flat (all voices same size/brightness). 1 = full depth effect.
uniform float u_depth;

out vec2 v_uv;
out vec2 v_quadPos;
out float v_layer;
out float v_alpha;
out float v_brightness;

void main() {
  vec2 p = vec2(
    ((gl_VertexID & 1) == 1) ? 1.0 : -1.0,
    ((gl_VertexID & 2) == 2) ? 1.0 : -1.0
  );
  // Map grain centre from clip space [-1,1] to UV space [0,1], then offset by
  // the scaled quad corner so the crop window is centred at the grain position.
  vec2 uvCenter = a_center * 0.5 + 0.5;
  v_uv = uvCenter + p * (u_uvScale * 0.5);
  v_quadPos = p;
  v_layer = a_layer;
  v_alpha = a_alpha;
  // G3: per-voice scale — loud grains larger, quiet grains smaller.
  float scale = mix(1.0, mix(0.15, 1.5, a_amplitude), u_depth);
  vec2 pos = a_center + p * u_halfSize * scale;
  gl_Position = vec4(pos, 0.0, 1.0);
  // G4: per-voice brightness passed to fragment stage.
  v_brightness = mix(1.0, a_amplitude, u_depth);
}
