#version 300 es
precision highp float;

// fluidSim — true Flockaroo-style rotational CFD with separate velocity + dye.
//
// Two ownedState FBOs (MRT):
//   layout(location=0) → dye buffer  (ownedState,  TEXTURE1) — blitted to composite
//   layout(location=1) → velocity    (ownedState2, TEXTURE7) — internal only
//
// Each frame:
//   1. Compute multi-scale rotation from the velocity buffer (Flockaroo method).
//   2. Rotate + advect the velocity field (self-consistent, no div-free solve).
//   3. Back-trace the DYE through the velocity to transport video pixels.
//   4. Inject live video as fresh dye at rate u_inject.
//
// Reference: Florian Berger (flockaroo) 2016 — shadertoy.com/view/MdlSzM

in vec2 v_uv;

// MRT outputs
layout(location = 0) out vec4 o_dye; // → composite (what downstream ops see)
layout(location = 1) out vec4 o_vel; // → velocity buffer (internal)

uniform sampler2D u_tex;      // TEXTURE0: live video — dye injection source
uniform sampler2D u_prev_dye; // TEXTURE1: previous dye (ownedState, bindAsPrevFrame)
uniform sampler2D u_prev_vel; // TEXTURE7: previous velocity  rg=[0,1] where 0.5=rest

uniform float u_mix;
uniform float u_inject;    // dye injection rate  [0,1] → actual rate * 0.06
uniform float u_viscosity; // velocity decay      [0,1] → multiplier [0.993, 1.000]
uniform float u_scale;     // rotation sample base radius [0.5, 4]
uniform float u_speed;     // rotation amplification      [0, 2]
uniform float u_fieldType; // 0=none, 1=vortex, 2=linear, 3=curl  (rounded to int)
uniform float u_angle;     // linear field direction normalised [0,1]
uniform float u_cx;        // field centre x
uniform float u_cy;        // field centre y
uniform float u_seedStr;   // continuous field forcing strength  [0,1]

const float TAU = 6.28318530718;
#define ROT_NUM 3

// 120° CCW rotation matrix  (GLSL mat2 is column-major)
const mat2 ROT_M = mat2(-0.5, 0.866025, -0.866025, -0.5);

// Per-pixel hash — removes directional bias without needing a noise texture.
float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Flockaroo rotational curl sampling.
// Samples ROT_NUM velocity vectors equally spaced around a circle of radius sc,
// returns the mean signed curl  cross(v, p) / |p|^2 — the local rotation rate.
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

void main() {
    vec3 src = texture(u_tex, v_uv).rgb;

    if (u_mix < 0.0005) {
        o_dye = vec4(src, 1.0);
        o_vel = texture(u_prev_vel, v_uv); // pass velocity through unchanged
        return;
    }

    int ft = int(u_fieldType + 0.5);

    // ── Flockaroo CFD: multi-scale rotational velocity update ──────────────
    float rot = 0.0;
    float sc = u_scale * 0.003;
    for (int i = 0; i < 4; i++) {
        rot += getRot(v_uv, sc);
        sc *= 2.0;
    }
    rot *= u_speed * 0.3;

    // Read current velocity and advect the velocity field backwards.
    vec2 vel = texture(u_prev_vel, v_uv).rg - vec2(0.5);
    vec2 velAdvUV = fract(v_uv - vel * u_scale * 0.006);
    vec2 advVel = texture(u_prev_vel, velAdvUV).rg - vec2(0.5);

    // Rotate velocity by computed rotation angle.
    float cosR = cos(rot);
    float sinR = sin(rot);
    vec2 newVel = vec2(
        cosR * advVel.x - sinR * advVel.y,
        sinR * advVel.x + cosR * advVel.y
    );

    // Viscosity decay toward rest.
    float visc = 0.993 + u_viscosity * 0.007;
    newVel *= visc;

    // Continuous geometric field forcing — steers without overriding CFD.
    if (ft > 0) {
        vec2 force = vec2(0.0);
        if (ft == 1) {
            vec2 d = v_uv - vec2(u_cx, u_cy);
            float r = length(d);
            float env = smoothstep(0.0, 0.15, r) * exp(-r * 2.5);
            force = r > 0.001 ? (vec2(-d.y, d.x) / r) * env * 0.35 : vec2(0.0);
        } else if (ft == 2) {
            float a = u_angle * TAU;
            force = vec2(cos(a), sin(a)) * 0.35;
        } else if (ft == 3) {
            vec2 uv2 = v_uv - vec2(u_cx, u_cy);
            float nx = sin(uv2.x * 6.2 + 0.5) * cos(uv2.y * 5.1);
            float ny = cos(uv2.x * 5.1) * sin(uv2.y * 6.2 - 0.7);
            force = normalize(vec2(-ny, nx) + vec2(0.001)) * 0.35;
        }
        newVel = mix(newVel, force, u_seedStr * 0.025);
    }

    newVel = clamp(newVel, vec2(-0.49), vec2(0.49));
    o_vel = vec4(newVel + vec2(0.5), 0.0, 1.0);

    // ── Dye advection: back-trace video pixels through the velocity field ──
    // Using the velocity at this pixel, find where the dye at v_uv came from.
    vec2 dyeAdvUV = fract(v_uv - vel * u_scale * 0.008);
    vec3 advDye = texture(u_prev_dye, dyeAdvUV).rgb;

    // Inject live video as fresh dye.
    float injectRate = u_inject * 0.06;
    vec3 newDye = mix(advDye, src, injectRate);

    o_dye = vec4(mix(src, newDye, u_mix), 1.0);
}
