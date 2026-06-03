#version 300 es
precision highp float;

// flowMosh — optical-flow datamosh.
//
// Two ownedState FBOs (MRT):
//   layout(location=0) → mosh accumulation (ownedState,  TEXTURE1) — blitted to composite
//   layout(location=1) → stored prev frame  (ownedState2, TEXTURE7) — LK temporal reference
//
// Each frame:
//   1. Compute 5×5 Lucas-Kanade optical flow between u_tex and u_prev_vid.
//   2. Warp u_prev_mosh by flow to advect the datamosh accumulation buffer.
//   3. Blend a small amount of fresh video (u_inject rate).
//   4. On keyframe boundaries, reset: inject live video directly.

in vec2 v_uv;

layout(location = 0) out vec4 o_mosh;
layout(location = 1) out vec4 o_prev;

uniform sampler2D u_tex;       // TEXTURE0: current video
uniform sampler2D u_prev_mosh; // TEXTURE1: previous mosh accumulation (ownedState, bindAsPrevFrame)
uniform sampler2D u_prev_vid;  // TEXTURE7: previous video frame + key bucket in w (ownedState2)

uniform float u_mix;
uniform float u_inject;       // video bleed-in per frame outside keyframes [0,1]
uniform float u_flow;         // LK flow amplification [0,8]
uniform float u_key_interval; // seconds between forced keyframes [0.1,8]
uniform vec2  u_resolution;
uniform float u_time;

float luma(sampler2D s, vec2 uv) {
    return dot(texture(s, clamp(uv, 0.001, 0.999)).rgb, vec3(0.299, 0.587, 0.114));
}

// Lucas-Kanade 5×5 window optical flow.
// Returns forward flow in pixel space: (u,v) means the pixel at v_uv moved
// approximately (u,v) pixels from the previous frame to the current frame.
vec2 lkFlow(vec2 uv, vec2 px) {
    float Axx = 0.0, Axy = 0.0, Ayy = 0.0, bx = 0.0, by = 0.0;
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2  p  = uv + vec2(float(dx), float(dy)) * px;
            float Ix = (luma(u_tex, p + vec2(px.x, 0.0)) - luma(u_tex, p - vec2(px.x, 0.0))) * 0.5;
            float Iy = (luma(u_tex, p + vec2(0.0, px.y)) - luma(u_tex, p - vec2(0.0, px.y))) * 0.5;
            float It = luma(u_tex, p) - luma(u_prev_vid, p);
            Axx += Ix * Ix;
            Axy += Ix * Iy;
            Ayy += Iy * Iy;
            bx  -= Ix * It;
            by  -= Iy * It;
        }
    }
    float det = Axx * Ayy - Axy * Axy;
    if (abs(det) < 1e-8) return vec2(0.0);
    return vec2(Ayy * bx - Axy * by, Axx * by - Axy * bx) / det;
}

void main() {
    vec2 px  = 1.0 / max(u_resolution, vec2(1.0));
    vec3 src = texture(u_tex, v_uv).rgb;

    // Keyframe detection: bucket time into key_interval-sized windows.
    // key bucket ID stored in o_prev.w so we detect the boundary next frame.
    float keyBucket  = floor(u_time / max(u_key_interval, 0.033));
    float prevBucket = texture(u_prev_vid, vec2(0.5)).w;
    bool  isKey      = (abs(keyBucket - prevBucket) > 0.5) || (u_time < 0.2);

    // Always store current frame for next-frame LK reference and key tracking.
    o_prev = vec4(src, keyBucket);

    if (u_mix < 0.0005) {
        o_mosh = vec4(src, 1.0);
        return;
    }

    vec3 mosh;
    if (isKey) {
        // Keyframe: reset mosh to fresh video.
        mosh = src;
    } else {
        // Compute optical flow, clamp outliers, warp previous mosh.
        vec2 flow    = lkFlow(v_uv, px);
        flow         = clamp(flow, vec2(-20.0), vec2(20.0));
        vec2 warpUv  = v_uv - flow * px * u_flow;
        vec3 prevMosh = texture(u_prev_mosh, clamp(warpUv, 0.001, 0.999)).rgb;
        // Blend small amount of fresh video — keeps the smear alive without freezing.
        mosh = mix(prevMosh, src, u_inject * 0.04);
    }

    o_mosh = vec4(mix(src, mosh, u_mix), 1.0);
}
