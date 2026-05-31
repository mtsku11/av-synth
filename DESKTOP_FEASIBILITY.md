# Desktop feasibility

Desktop implementation is intentionally deferred until the web showcase gates close. Electron is the
recommended first shell because it pins the Chromium substrate already exercised by the web app.

| Capability | Electron | Tauri | Release-hardening conclusion |
|---|---|---|---|
| WebGL2 | Strong: pinned Chromium behavior | Variable by OS WebView | Prefer Electron for renderer parity |
| AudioWorklet | Strong: pinned Chromium scheduling and worklet behavior | Variable across WebView2 / WKWebView / WebKitGTK | Prefer Electron; retest soak gate in packaged builds |
| SharedArrayBuffer / cross-origin isolation | Feasible with packaged response headers and a locked renderer policy | Feasible but platform-WebView behavior needs per-OS verification | Preserve COOP / COEP / CORP policy in desktop shell |
| Web MIDI | Chromium support available; permission UX still needs packaging tests | Platform-WebView support varies | Electron is the lower-risk MIDI path |
| Local files | Native file picker through a narrow preload IPC bridge | Native dialog plugin path | Both feasible; keep renderer sandboxed |
| Recording / export | Current MediaRecorder path works; native FFmpeg sidecar can be added later for offline export | MediaRecorder depends on WebView codecs; native sidecar integration is feasible | Ship web capture parity first; design offline export separately |

## Desktop guardrails

- Do not scaffold the desktop app during showcase hardening.
- Use `contextIsolation: true`, `nodeIntegration: false`, a locked CSP, and a narrow typed preload bridge.
- Repeat B2.3 soak, D3 listening, D4 latency, WebGL2 parity, MIDI, local-file, and capture tests on each packaged OS target.
