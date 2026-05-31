# Release verdict

Status date: 2026-05-31

## Verdict

- **Private Cloudflare staging deploy:** **READY TO DEPLOY, NOT YET SIGNED OFF**
- **Public showcase:** **BLOCKED**

The repo is prepared for the first Cloudflare Pages staging deployment. Public showcase readiness remains
blocked on the hosted smoke pass, reference-hardware CPU measurement, D3 human listening panel, D4 physical
loopback/scope latency measurement, manual audible exceptions, and showcase-capture review.

## Exact gate status

| Gate | Status | Evidence / next action |
|---|---|---|
| Cloudflare Pages workflow matches runbook | PASS | `.github/workflows/deploy-cloudflare.yml`, `deploy.md` |
| COOP / COEP / CORP static headers | PASS | `public/_headers`; workflow verifies `dist/_headers` before upload |
| Runtime capability diagnostic | PASS | Footer reports isolation, SAB, AudioWorklet, WebGL2, Web MIDI, recording |
| B2.3 worklet no-allocation soak | PASS WITH ACCEPTED WAIVER | 4-hour soak on 2026-05-25: zero allocation-driven worklet major GC; one V8 incremental-marking code-flush cycle accepted |
| B2.3 no-spawn vs `grainField` vs forced-dense discriminator | PASS | Early pair was reproduced across low/live/dense shapes and classified through the completed ladder; it is not a grain-lifecycle leak |
| Master true-peak gate | PASS | Worst-case post-limit true peak `-7.52 dBFS` |
| D4 in-app latency proxy | PASS | Refreshed 2026-05-30: `3.152 ms` against the `5 ms` proxy target |
| Public preset bank limited to 8–12 programs | PASS | 11 curated programs led by `Singularity Bloom`, `Fracture Relay`, and `Magnetic Cathedral`; remaining programs are Advanced experiments |
| Every public preset exposes three stable macros | PASS | Public allowlist uses the authored three-macro programs only; focused serial recall/performance spec passes |
| Local 8-second showcase recorder proof | PASS | Refreshed 2026-05-31: 11 non-empty VP9/Opus WebM exports generated under `qa/results/showcase-captures/` |
| Per-public-preset visual / CPU showcase review | FAIL: MANUAL REVIEW OWED | Capture slate in `SHOWCASE_CAPTURES.md` |
| Canonical 2020-class Intel MBP CPU measurement | FAIL: HARDWARE OWED | Record reference-class measurement |
| D3 listening panel against Granulator II | FAIL: HUMAN REVIEW OWED | `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md` |
| D4 physical loopback / scope latency | FAIL: HARDWARE OWED | Same D3/D4 review note |
| First Cloudflare staging deploy + hosted smoke | FAIL: DEPLOY OWED | Record canonical URL in `deploy.md`, run `qa:smoke:external` |
| Desktop download | NOT SHIPPED BY DESIGN | Feasibility only; see `DESKTOP_FEASIBILITY.md` |

## B2.3 verdict

**Accept with narrow waiver.** The early major-GC behavior is not waived broadly. Only V8
`MajorGC.args.type` values containing `incremental marking` are treated as informational code-flush
housekeeping. Any other worklet `MajorGC` remains a release failure because it indicates allocation-driven
heap pressure.

Repeatable warmed matrix command:

```bash
npm run qa:granulator:soak:matrix
```
