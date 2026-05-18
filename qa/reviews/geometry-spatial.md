# Geometry / Spatial Review

Date: 2026-05-17
Audit run: `audit-*` green in Playwright and `qa:analyze` green for the current geometry-family cases.

Scope:

- `scale`, `rotate`, `scrollX`, `scrollY`, `repeat`, `repeatX`, `repeatY`, `pixelate`, `kaleid`

Current notes:

- The geometry family now has dedicated osc and decoded-media coverage across every implemented operator.
- `kaleid` on the procedural oscillator now also keeps manual visual review; the fold-count change is visible, but the current live temporal metric flips sign often enough that it is not safe as a CI gate.
- `pixelate` keeps manual visual review on both the decoded-media cross-source case and the oscillator sweep because the current live grayscale metrics do not capture visible blockiness reliably enough to be a release-grade gate.
- `scrollY` oscillator visual review and `repeatY` oscillator visual review remain manual for the same reason: the operator is visibly changing, but the live metric is not stable enough to encode that change safely.
- `scrollX` oscillator exported-audio review stays manual because the current descriptors do not separate the intended stereo-delay behavior robustly across runs.

Manual review focus:

- `pixelate`: does stronger blockiness feel like the same family as the harsher sample-hold texture?
- `scrollX` / `scrollY`: do the delay/pan analogues feel directionally plausible rather than arbitrary?
- `repeat*`: do the comb-like audio changes stay intentional and not overly brittle?
- `kaleid`: does higher fold count stay musically usable, not just bright and sharp?

Outstanding local sign-off:

- Manual visual pass on `kaleid` osc, `pixelate`, `scrollY` osc, and `repeatY` osc.
- Manual audio pass on `scrollX` osc.
