#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_mix;
uniform float u_threshold;
uniform float u_angle;         // [0,1] → [0, 2π]: direction of the base sort vector
uniform float u_bands;         // number of band pairs for sort-direction reversal
uniform float u_speed;         // comparison stride in pixels
uniform float u_frame_parity;  // 0.0 or 1.0, alternates each frame for odd-even sort

float gray(vec3 c) { return (c.r + c.g + c.b) / 3.0; }

void main() {
  vec3 live = texture(u_tex, v_uv).rgb;

  vec2 res = vec2(textureSize(u_prev_frame, 0));
  vec2 px  = 1.0 / res;
  vec2 iuv = floor(v_uv * res);

  // ── Inline vector field (Buffer A algorithm from ciphrd.com) ──────────────
  // Base direction from angle param
  float a    = u_angle * 6.28318;
  vec2  base = vec2(cos(a), sin(a));

  // Row alternation: each row flips direction, giving the bidirectional pairing
  // needed so every pixel has exactly one comparison partner per pass.
  float r  = mod(iuv.y, 2.0) * 2.0 - 1.0;     // -1 or +1 by row
  float ff = u_frame_parity * 2.0 - 1.0;        // -1 or +1 by frame
  vec2  dir = base * r * ff;

  // Band flip: groups of rows sort in opposite directions, creating the
  // characteristic visual breaks. Mirrors the `b` band variable in Buffer A.
  float band_count = max(1.0, u_bands);
  float b = mod(floor(v_uv.y * band_count), 2.0); // 0.0 or 1.0
  dir.x *= b * 2.0 - 1.0;

  // ── Sort step (Buffer D) ──────────────────────────────────────────────────
  float steps = max(1.0, round(clamp(u_speed, 1.0, 32.0)));
  vec2  dr    = dir * px * steps;
  vec2  p     = vec2(fract(v_uv.x + dr.x + 1.0), v_uv.y + dr.y);

  // Don't sort across top/bottom boundaries
  if (p.y < 0.0 || p.y > 1.0) {
    o_color = vec4(mix(live, texture(u_prev_frame, v_uv).rgb, clamp(u_mix, 0.0, 1.0)), 1.0);
    return;
  }

  vec4  actv   = texture(u_prev_frame, v_uv);
  vec4  comp   = texture(u_prev_frame, p);
  float gAct   = gray(actv.rgb);
  float gCom   = gray(comp.rgb);
  float thresh = clamp(u_threshold, 0.0, 1.0);

  // classed separates the direction into two groups — each side of a pair
  // ends up in opposite groups, giving complementary swap conditions.
  float classed = sign(dr.x * 2.0 + dr.y);

  // Swap logic direct port of Buffer D: b + classed → ascending or descending.
  vec4 color = actv;
  if (classed < 0.0) {
    if (b > 0.5) {
      if (gCom > thresh && gAct > gCom) color = comp;
    } else {
      if (gAct > thresh && gAct < gCom) color = comp;
    }
  } else {
    if (b > 0.5) {
      if (gAct > thresh && gAct < gCom) color = comp;
    } else {
      if (gCom > thresh && gAct > gCom) color = comp;
    }
  }

  o_color = vec4(mix(live, color.rgb, clamp(u_mix, 0.0, 1.0)), 1.0);
}
