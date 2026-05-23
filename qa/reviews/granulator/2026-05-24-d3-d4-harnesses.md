# Granulator D3 / D4 harnesses — 2026-05-24

This pass does two things:

1. lands the repeatable assets and render path for the **D3 listening panel**
2. lands the repeatable proxy + manual protocol for the **D4 MIDI-latency gate**

It does **not** claim the human-review gate or the hardware loopback gate are fully closed. Those still require real reviewers and a real loopback/scope run.

---

## D3 — listening pack

Committed input fixtures now exist:

- `qa/fixtures/granulator-held-tone-48k.wav`
- `qa/fixtures/granulator-source-stereo-48k.wav`

Render command:

```bash
npm run qa:granulator:listening
```

Outputs land in `qa/results/granulator-listening/`:

- `held-tone-plus12.wav`
- `held-tone-plus24.wav`
- `curated-classic.wav`
- `curated-cloud-dense.wav`
- `manifest.json`

The manifest is the authority for the exact av-synth parameter sets and seeds. Granulator II should be matched against those settings as closely as possible, then scored by at least two human reviewers on:

- artefact-freeness
- musicality at `+12` / `+24` semitones
- cloud density stability at `100+ grains/sec`
- parameter feel

Reviewer sheet:

| Test | Files | Reviewer 1 | Reviewer 2 | Verdict |
|---|---|---|---|---|
| Held tone | `held-tone-plus12.wav`, `held-tone-plus24.wav` | PENDING | PENDING | PENDING |
| Curated source | `curated-classic.wav`, `curated-cloud-dense.wav` | PENDING | PENDING | PENDING |

Release status after this pass: **harness landed, review still owed**.

---

## D4 — MIDI latency

Two harness shapes now exist:

1. **Internal proxy** for repeatable regression checking in-browser
2. **Manual loopback probe** for the final hardware-facing sign-off

Proxy command:

```bash
npm run qa:granulator:latency
```

Current local result on this machine:

- proxy latency: **2.993 ms**
- capture fixture: `qa/fixtures/ci-smoke.mp4`
- result file: `qa/results/granulator-latency-proxy.json`

Important limitation: this is a **lower bound**, not the release gate by itself. It measures marker-to-grain delta inside the app capture path, not the full physical output/input round trip.

Manual loopback protocol:

1. Start the app with a real audio device and load a clip.
2. Start transport so the granulator pipeline exists.
3. Patch interface output to interface input, or use an interface with internal loopback.
4. In DevTools, call:

```js
await window.__AV_SYNTH_QA__.fireGranulatorLatencyProbe()
```

5. Measure the delta between the marker click and the first granulator onset on the recorded loopback track or scope trace.
6. Log the observed value in a follow-up review note in this directory.

Release status after this pass: **proxy PASS, hardware loopback still owed**.
