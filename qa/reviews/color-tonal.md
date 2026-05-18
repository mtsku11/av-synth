# Color / Tonal Review

Date: 2026-05-17
Audit run: `audit-*` green in Playwright and `qa:analyze` green for the current color-family cases.

Scope:

- `audit-brightness-video-sweep`
- `audit-contrast-osc-sweep`
- `audit-color-solid-band-sweep`
- `audit-saturate-video-sweep`
- `audit-posterize-video-sweep`
- `audit-chromaShift-video-sweep`

Current notes:

- The live QA metrics now include mean RGB and mean saturation specifically so this family can be audited on something closer to the visual intent than grayscale alone.
- `brightness` remains the most aggressive coupling in the family; the automated gate proves it moves, but a listening pass should decide whether the current loudness law is still too severe for professional use.
- `color` on the solid fixture, plus `posterize`, `saturate`, and `chromaShift`, are intentionally more manual-heavy on the audio side because the current fixtures/metrics are not yet strong enough to reduce their aesthetic judgment to one scalar threshold.

Manual review focus:

- `brightness`: does the louder setting still feel musical rather than limiter-led?
- `contrast`: does the driven oscillator stay intentional instead of harsh?
- `color`: does the low-band vs high-band mapping feel intuitive enough to learn?
- `saturate`: does the stereo widening correspond to visible color intensity in a believable way?
- `posterize`: does the stepped texture read as intentional quantization, not broken compression?
- `chromaShift`: is the visible channel split tasteful enough for professional use?

Outstanding local sign-off:

- Do a real audible pass on `brightness`, `saturate`, `posterize`, and `chromaShift` before deploy.
