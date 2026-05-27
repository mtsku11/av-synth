#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform sampler2D u_motion_tex;
uniform float u_feedback;
uniform float u_zoom;          // per-frame scale on feedback UV (+ expands, − contracts)
uniform float u_motion_blend;  // 0 = static ghost, 1 = ghost tracks scene motion
uniform float u_chroma_drift;  // radial R/B offset on feedback sample

vec2 decodeMotion(vec4 m) {
  return (m.xy * 2.0 - 1.0) * m.b;
}

void main() {
  vec3 current = texture(u_tex, v_uv).rgb;

  // Feedback UV: optionally zoomed toward / away from frame centre.
  vec2 centre     = vec2(0.5);
  vec2 feedbackUv = centre + (v_uv - centre) * (1.0 - u_zoom);

  // Motion compensation: shift feedback UV so the ghost follows the subject.
  if (u_motion_blend > 0.0001) {
    vec2 flow = decodeMotion(texture(u_motion_tex, v_uv));
    feedbackUv -= flow * u_motion_blend;
  }

  feedbackUv = clamp(feedbackUv, 0.0, 1.0);

  // Chromatic drift: R and B sampled at a slight radial offset from G,
  // accumulating as colour fringing on the ghost trail.
  vec3 prev;
  if (u_chroma_drift > 0.0001) {
    vec2 radial = normalize(v_uv - centre + vec2(1e-6)) * u_chroma_drift;
    prev.r = texture(u_prev_frame, clamp(feedbackUv + radial, 0.0, 1.0)).r;
    prev.g = texture(u_prev_frame, feedbackUv).g;
    prev.b = texture(u_prev_frame, clamp(feedbackUv - radial, 0.0, 1.0)).b;
  } else {
    prev = texture(u_prev_frame, feedbackUv).rgb;
  }

  o_color = vec4(mix(current, prev, clamp(u_feedback, 0.0, 0.95)), 1.0);
}
