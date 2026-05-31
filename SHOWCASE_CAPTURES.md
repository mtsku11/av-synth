# Showcase capture slate

Use `qa/fixtures/ci-smoke.mp4` for repeatable staging captures, then replace selected clips with stronger
licensed footage before public publication. Capture 8–12 second exports through the app recorder at the
default macro positions and review clipping, visual stability, and CPU on the hosted Cloudflare build.

```bash
npm run qa:showcase:capture
```

Generated exports and `manifest.json` land in `qa/results/showcase-captures/`.

Local recorder proof refreshed on 2026-05-31: all nine programs exported non-empty VP9/Opus WebM payloads
from the default 8-second capture window. Hosted visual, clipping, and CPU review remains owed.

| Order | Public program | Capture intent | Status |
|---|---|---|---|
| 1 | `singularityBloom` | First-run flagship; warm radial gravity field with routed displacement and bloom macros | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 2 | `fractureRelay` | Slit-scan, codec-hold, field-sort, routed-hue fracture with sparse reverse-capable grains | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 3 | `magneticCathedral` | Symmetric magnetic prism with routed rotation, colorama, loop grains, and ping-pong delay | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 4 | `asciiGhostDelay` | Amber analytical ASCII field with radial temporal echo | LOCAL EXPORT PASS; HOSTED REVIEW OWED; CHECK LOW-ENTROPY 158 KB EXPORT |
| 5 | `binaryBassRain` | Bass-reactive binary grid and digital columns | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 6 | `halftoneFeedbackBloom` | Printed-dot texture with contour memory and bloom | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 7 | `slitScanHands` | Spiral gesture ribbon with block glyph silhouette | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 8 | `glyphVortex` | Mirrored palette-glyph vortex with cell rotation | LOCAL EXPORT PASS; HOSTED REVIEW OWED |
| 9 | `terminalKaleidoscope` | Chrome terminal mandala with unstable digital columns | LOCAL EXPORT PASS; HOSTED REVIEW OWED |

Public publication is blocked until the hosted capture pass is reviewed and 6–12 strongest exports are
selected. The remaining programs stay visible only under **Advanced → experiments**.
