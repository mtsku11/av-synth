# Feedback / Composition Review

Date: 2026-05-17
Audit run: `audit-*` green in Playwright and `qa:analyze` green for the current feedback/modulate cases.

Scope:

- `audit-feedback-osc-baseline`
- `audit-feedback-osc-sweep`
- `audit-feedback-video-cross-source`
- `audit-modulate-osc-baseline`
- `audit-modulate-osc-sweep`
- `audit-modulate-video-cross-source`

Current notes:

- The exported-WAV gate caught a real audio-routing bug earlier in the audit cycle; that fix is now in `src/audio/engine.ts`.
- `feedback` on decoded media keeps manual visual review by design because the current `temporalDiff` metric is not a trustworthy monotonic discriminator for visible persistence on the CI clip.
- `modulate` on the procedural oscillator keeps manual timbre review by design because stronger PM depth does not map to a stable monotonic centroid lift on the rendered export.

Manual review focus:

- `feedback`: does persistence stay intentional instead of turning into runaway smear?
- `modulate`: does higher depth sound like coherent phase/time warping instead of broken aliasing?
- Both: do the stronger settings still feel professionally usable, not just dramatic?

Outstanding local sign-off:

- Re-listen to `audit-modulate-osc-sweep` and re-watch `audit-feedback-video-cross-source` before deploy.
