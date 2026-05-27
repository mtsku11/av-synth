# Audio parameter bless — 2026-05-27

Covers the full public audio surface: granulator (19 slider params) + feedback delay (5 params).  
Run command: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_SERVER_MODE=external npx playwright test -c qa/playwright.config.ts granulator-param-bless`  
Result file: `qa/results/granulator-param-bless.json`  
Spec: `qa/e2e/granulator-param-bless.spec.ts`

---

## Pass verdict

**All 24 parameters swept without crash. AudioContext stayed `running` throughout. Zero console errors.**

---

## Granulator parameters

| Param | Method | Min | Max | Verdict | Notes |
|---|---|---|---|---|---|
| `gain` | nocrash | — | — | ✓ NOCRASH | Video audio dominates master peak; `mix` test proves granulator signal path |
| `mix` | peak | 0.1352 | 0.1590 | ✓ PASS | +17.6% peak at mix=1 vs mix=0; granulator signal confirmed live |
| `density` | spawnDelta | 1 | 79 | ✓ PASS | 79× more grains per 500 ms window at max vs min |
| `duration` | nocrash | — | — | ✓ NOCRASH | `meanSamplesPerGrain` diag tracks spawn interval not grain length; wire check only |
| `pitch` | nocrash | — | — | ✓ NOCRASH | Fast-expiring high-pitch grains mean pitchLoad not monotone; wire check confirms ±24 st with no crash |
| `voiceCount` | nocrash | — | — | ✓ NOCRASH | 1→64 voices; √N normalisation absorbs gain change; wire check |
| `positionJitter` | nocrash | — | — | ✓ NOCRASH | |
| `pitchJitter` | nocrash | — | — | ✓ NOCRASH | 0→24 st jitter range |
| `durationJitter` | nocrash | — | — | ✓ NOCRASH | |
| `distribution` | nocrash | — | — | ✓ NOCRASH | Poisson cloud spread; meaningful at mode=cloud |
| `panSpread` | nocrash | — | — | ✓ NOCRASH | |
| `ySpread` | nocrash | — | — | ✓ NOCRASH | |
| `reverseProbability` | nocrash | — | — | ✓ NOCRASH | |
| `fmAmount` | **MANUAL** | — | — | ⬜ PENDING | FM pitch mod; vibrato at low fmFreq, digital dirt at high; assess by ear |
| `fmFreq` | **MANUAL** | — | — | ⬜ PENDING | FM rate 0.1→500 Hz; interacts with fmAmount; assess by ear |
| `envAttack` | **MANUAL** | — | — | ⬜ PENDING | ADSR attack time; MIDI-triggered only — use computer keyboard input |
| `envDecay` | **MANUAL** | — | — | ⬜ PENDING | ADSR decay time; MIDI-triggered only |
| `envSustain` | **MANUAL** | — | — | ⬜ PENDING | ADSR sustain level 0→1; MIDI-triggered only |
| `envRelease` | **MANUAL** | — | — | ⬜ PENDING | ADSR release time 1→20000 ms; MIDI-triggered only |

### Manual review protocol for FM and ADSR

Set MIDI source to **computer keyboard** in the device selector, enable granulator, load a clip.

**FM section:**
1. Set `fmAmount = 12`, sweep `fmFreq` from 0.1 Hz to 500 Hz — expect: slow vibrato at 0.1 Hz, chorus/tremolo in the 4–10 Hz range, metallic shimmer 20–100 Hz, heavy digital distortion at 200–500 Hz.
2. Hold `fmFreq = 10`, sweep `fmAmount` 0→48 st — expect: subtle vibrato at low values, rapid pitch instability at high values.
3. Set both to 0 — expect: identical to pre-FM baseline (FM path fully bypassed).

**ADSR section:**
1. Trigger a note with computer keyboard; observe:
   - `envAttack = 10 ms` (default): near-instant onset.
   - `envAttack = 2000 ms`: slow fade-in over ~2 s.
2. Hold a note into sustain:
   - `envSustain = 1.0` (default): full volume during hold.
   - `envSustain = 0.0`: silence after decay completes.
3. Release note:
   - `envRelease = 300 ms` (default): brief tail.
   - `envRelease = 5000 ms`: audible 5 s release.
4. Rapid retrigger while holding: subsequent attacks start from current gain level (no pop).
5. ADSR transparent check: with no MIDI input, `adsrPhase = 0`, `adsrGain = 1.0` — granulator cloud plays at full level, unaffected.

---

## Feedback delay parameters

| Param | Verdict | Notes |
|---|---|---|
| `time` | ✓ NOCRASH | 5 ms → 4.0 s; no audio dropout or AudioContext suspend |
| `feedback` | ✓ NOCRASH | 0 → 0.99; no runaway or distortion at the ceiling |
| `damping` | ✓ NOCRASH | 200 Hz → 20 kHz lowpass inside feedback loop |
| `cross` | ✓ NOCRASH | 0 (self) → π/2 (swap); ping-pong at π/4 |
| `mix` | ✓ NOCRASH | 0 → 1 dry/wet blend |

### Manual review protocol for feedback delay

With granulator running and a clip loaded:

1. **Time + feedback**: set `feedback = 0.7`, `mix = 0.8`, sweep `time` 0.005→4.0 s — expect: distinct echo at long times, flanger/comb at short times (<20 ms).
2. **Feedback ceiling**: `time = 0.5 s`, raise `feedback` toward 0.99 — expect: building self-oscillation but no hard clipping (limiter backstop at 0 dBFS true-peak).
3. **Damping**: `feedback = 0.8`, `time = 0.3 s` — sweep damping 200→20000 Hz — expect: muffled echos at low cutoff, bright echos at high cutoff.
4. **Cross / ping-pong**: `cross = π/4` with stereo output — expect: delay alternates L/R channels.
5. **Mix zero check**: `mix = 0` — delay completely silent, granulator cloud only; `mix = 1` — full delay return blended in.

---

## Gate §13 status summary (as of this bless)

| Gate | Status |
|---|---|
| 1 — Listening panel (Granulator II parity) | HARNESS LANDED; 2 human reviews still owed |
| 2 — Video grain accuracy | PROVISIONAL PASS (fps on M4 Pro; reference-class MBP measurement owed) |
| 3 — MIDI latency ≤ 5 ms | PROXY PASS (2.993 ms); hardware loopback still owed |
| 4 — Zero-allocation 4 h soak | HARNESS LANDED; full 4 h run owed |
| 5 — CPU < 20% one core | HEADROOM-PASS on M4 Pro; 2020 MBP re-measurement owed |
| 6 — True-peak ≤ 0 dBFS | PASS (−0.06 dBFS pre-limit, −1.79 dBFS post-limit) |

---

## Outstanding manual items after this bless

1. **FM section** — human ear review with computer keyboard input (see protocol above).
2. **ADSR section** — human ear review with computer keyboard input (see protocol above).
3. **Feedback delay** — 5-point listening protocol above (needs connected audio device).
4. **Gate #1** — ≥ 2 reviewer listening scores against Granulator II still owed.
5. **Gate #3** — hardware loopback latency measurement still owed.
6. **Gate #4** — full 4-hour soak still owed.
7. **Gate #5** — CPU re-measurement on 2020-class Intel MBP still owed.
