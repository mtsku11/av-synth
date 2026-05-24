#version 300 es

// Procedural unit quad: gl_VertexID 0..3 traced as a triangle strip with corners
// at (-1,-1), (1,-1), (-1,1), (1,1). Each draw is one grain voice; center and
// half-extent are passed via uniforms so the scheduler controls per-voice placement.

uniform vec2 u_center;
uniform vec2 u_halfSize;

out vec2 v_uv;

void main() {
  vec2 p = vec2(
    ((gl_VertexID & 1) == 1) ? 1.0 : -1.0,
    ((gl_VertexID & 2) == 2) ? 1.0 : -1.0
  );
  v_uv = p * 0.5 + 0.5;
  vec2 pos = u_center + p * u_halfSize;
  gl_Position = vec4(pos, 0.0, 1.0);
}
