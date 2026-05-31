# Showcase capture slate

Use `qa/fixtures/ci-smoke.mp4` for repeatable staging captures, then replace selected clips with stronger
licensed footage before public publication. Capture 8–12 second exports through the app recorder at the
default macro positions and review clipping, visual stability, and CPU on the hosted Cloudflare build.

```bash
npm run qa:showcase:capture
```

Generated exports and `manifest.json` land in `qa/results/showcase-captures/`.

Local recorder proof refreshed on 2026-05-31: all 11 programs exported non-empty VP9/Opus WebM payloads
from the default 8-second capture window. Hosted visual, clipping, and CPU review remains owed.

| Order | Public program | Capture intent | Status |
|---|---|---|---|
| 1 | `singularityBloom` | First-run flagship; warm radial gravity field with routed displacement and bloom macros | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 2 | `fractureRelay` | Slit-scan, codec-hold, field-sort, routed-hue fracture with sparse reverse-capable grains | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 3 | `magneticCathedral` | Symmetric magnetic prism with routed rotation, colorama, loop grains, and ping-pong delay | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 4 | `temporalBloomGhost` | Soft memory field supporting look | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 5 | `grainField` | Granulator-first identity shot after loading a short clip | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 6 | `slitScanEcho` | Vertical temporal-band replay | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 7 | `datamoshSmear` | Directional block tear | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 8 | `datamoshHold` | Held-frame codec-warp look | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 9 | `flowMelt` | Polished liquid pull | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 10 | `kaleidoFeedbackTunnel` | Prism tunnel finish | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 11 | `freezeFeedback` | Near-static contour freeze | LOCAL EXPORT PASS; HOSTED REVIEW OWED |

Public publication is blocked until the hosted capture pass is reviewed and 6–12 strongest exports are
selected. The remaining programs stay visible only under **Advanced → experiments**.
