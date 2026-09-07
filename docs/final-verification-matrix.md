# Final verification matrix

This index maps every advertised Phase 1–9 capability to executable evidence.
It deliberately points to existing focused tests instead of duplicating costly
PDF/browser operations in a superficial final test.

| Contract | Evidence |
|---|---|
| 29-tool discovery, intent search, localized links, responsive home/Merge, keyboard reorder, ordered merge artifact, and Merge request fingerprint | `tests/phase2.spec.mjs` — home disclosure/search; responsive matrix; keyboard reorder; reordered artifact and post-selection URL/body/prefix checks |
| Shared shell, consent, CSP/no-store, claims, localization and contrast | `tests/phase1.spec.mjs`; `tests/phase9.spec.mjs` — all-page inventory, exact localized head/JSON-LD responses, and final component-text contrast matrix |
| Exact WebMCP home/Merge discovery, state schemas, abort, no binary/text/path leaks, merge races | `tests/phase3.spec.mjs` — fallback and real CDP discovery/invocation plus three deterministic mutation races |
| Workflow manifest/store/resume/expiry, concurrent import caps, queue cancellation/retry, WebMCP and all three recipe artifacts | `tests/phase4.spec.mjs` — every test; artifact test also fingerprints outbound requests |
| Privacy PDF.js lifecycle, full fixture corpus, bounded findings, cleanup exactness, WebMCP, stale-operation races and signed warning | `tests/phase5.spec.mjs`; real rich-fixture URL/body/64-byte-prefix request fingerprint check |
| Doctor corpus, unknown inspection signals, graph truncation, verified normalize/rebuild artifacts, immutable originals, WebMCP CDP and races | `tests/phase6.spec.mjs`; transform test also fingerprints outbound requests |
| SDK build/type/runtime parity, inputs, progress, abort, lifecycle, clean browser consumer and local PDF.js worker/assets | `npm --prefix sdk test`; `tests/phase7.spec.mjs` |
| Manifest/icons, strict cache allowlist/exclusions, network-only metrics, generation-isolated waiting update, removal race, offline fallback, storage controls and blocked-SW parity | `tests/phase8.spec.mjs` |
| Real scanned-image English OCR output reopens with searchable text | `tests/smoke.spec.mjs` — bounded one-page OCR artifact and direct PDF.js text extraction |
| 36-page shell inventory, three service JSON-LD/related links, 3×22 exactly localized head/JSON-LD responses, sitemap, Arabic RTL, 320–1440 light/dark component-text contrast and overflow, real service keyboard actions, idle state, requested initial JS graph and request budgets | `tests/phase9.spec.mjs` |

Artifact claims are limited to the outputs asserted above. In particular, the
offline fallback is not an offline document tool, the bounded scans are not
certifications, workflow privacy cleanup is not a comprehensive scan, and the
SDK has not been published.
