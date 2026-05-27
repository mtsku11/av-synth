#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_tex;
uniform sampler2D u_prev_motion_tex;
uniform vec2 u_resolution;
uniform float u_prev_valid;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 decodeMotion(vec2 e) { return e * 2.0 - 1.0; }
vec2 encodeMotion(vec2 v) { return v * 0.5 + 0.5; }

void main() {
  if (u_prev_valid < 0.5) {
    o_color = vec4(0.5, 0.5, 0.0, 0.0);
    return;
  }

  vec2 px = 1.0 / max(u_resolution, vec2(1.0));

  // Lucas-Kanade optical flow — 5×5 patch structure tensor.
  // Central-difference gradients are computed using one pixel step on each
  // side, so the raw vx/vy values are in units of (It / Ix_fd).
  // Multiplying by 2*px converts to UV/frame (see derivation: Ix_fd ≈ Ix_true * 2px).
  float Ixx = 0.0, Ixy = 0.0, Iyy = 0.0;
  float Ixt = 0.0, Iyt = 0.0;

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 p = v_uv + vec2(float(i), float(j)) * px;

      float It = luma(texture(u_tex,      p).rgb)
               - luma(texture(u_prev_tex, p).rgb);

      // Gradients averaged across both frames for better stability.
      float Ix = 0.5 * (
          luma(texture(u_tex,      p + vec2(px.x, 0.0)).rgb)
        - luma(texture(u_tex,      p - vec2(px.x, 0.0)).rgb)
        + luma(texture(u_prev_tex, p + vec2(px.x, 0.0)).rgb)
        - luma(texture(u_prev_tex, p - vec2(px.x, 0.0)).rgb)
      );
      float Iy = 0.5 * (
          luma(texture(u_tex,      p + vec2(0.0, px.y)).rgb)
        - luma(texture(u_tex,      p - vec2(0.0, px.y)).rgb)
        + luma(texture(u_prev_tex, p + vec2(0.0, px.y)).rgb)
        - luma(texture(u_prev_tex, p - vec2(0.0, px.y)).rgb)
      );

      Ixx += Ix * Ix;
      Ixy += Ix * Iy;
      Iyy += Iy * Iy;
      Ixt += Ix * It;
      Iyt += Iy * It;
    }
  }

  // Solve [Ixx Ixy; Ixy Iyy] * [vx; vy] = -[Ixt; Iyt].
  float det = Ixx * Iyy - Ixy * Ixy;
  float vx = 0.0, vy = 0.0;
  if (abs(det) > 1e-9) {
    vx = (-Ixt * Iyy + Iyt * Ixy) / det;
    vy = (-Iyt * Ixx + Ixt * Ixy) / det;
  }

  // Scale to UV/frame. Central difference uses a 1px step on each side, so
  // the raw ratio needs * 2*px to land in UV-space velocity units.
  vec2 flowUV = clamp(vec2(vx, vy) * px * 2.0, -0.2, 0.2);

  float mag = length(flowUV);
  vec2 dir  = (mag > 1e-7) ? flowUV / mag : vec2(0.0);

  // Normalise: 0.05 UV/frame (~100 px at 1920) → magnitude 1.0.
  float normMag = clamp(mag / 0.05, 0.0, 1.0);

  // Confidence from structure tensor (Harris-style: det / trace).
  float trace = Ixx + Iyy + 1e-8;
  float confidence = clamp(det / (trace * trace) * 400.0, 0.0, 1.0);

  // Temporal smoothing (same style as before — blend toward new reading
  // faster when motion is large).
  vec4 prevMotion   = texture(u_prev_motion_tex, v_uv);
  vec2 smoothedDir  = mix(decodeMotion(prevMotion.xy), dir, 0.35 + normMag * 0.45);
  float smoothedMag = mix(prevMotion.b * 0.82, normMag, 0.35 + normMag * 0.4);
  float smoothedConf = mix(prevMotion.a * 0.8, confidence, 0.4 + confidence * 0.3);
  vec2 finalDir = length(smoothedDir) > 1e-5 ? normalize(smoothedDir) : vec2(0.0);

  o_color = vec4(encodeMotion(finalDir), smoothedMag, smoothedConf);
}
