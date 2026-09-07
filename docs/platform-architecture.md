# BrowserPDF platform architecture and verified boundaries

Status: implementation reference for the Phase 1–9 browser platform. This
document describes shipped source behavior and explicit non-capabilities; it is
not a deployment, certification, or package-publication claim.

## Request and processing architecture

Cloudflare Worker `worker.js` serves the static `public/` assets, normalizes
localized extensionless routes, injects the shared shell, and applies the sole
normal-page CSP. Every normal HTML response contains a fresh nonce and
`Cache-Control: no-store`. It also sends `Permissions-Policy: tools=(self)`;
WebMCP remains feature-detected progressive enhancement.

The 29-item catalog is unchanged. Workflows, Privacy Scan, and Document Doctor
are separate service calls to action. PDF computation runs in DOM-free cores;
page adapters own file selection, visible state, cancellation, and manual
downloads. There is no document-processing backend or file-upload endpoint.
Ordinary page, library, analytics (subject to consent), and hosting requests
still occur.

## Privacy coverage

- Merge owns byte copies and copies pages in the selected file order.
- Workflows run a maximum of 20 PDFs and 250 MiB with concurrency one. Its
  privacy recipe detects and removes only standard document-info metadata.
- Privacy Scan inspects bounded Info/XMP presence, catalog and page attachments,
  annotations/URLs/actions, document and page JavaScript actions, forms,
  calculation order, permissions/encryption signals, detectable invisible-text
  operators, and bounded document-text patterns. It neither executes scripts nor
  follows URLs. Raw matches stay collapsed in the page and are excluded from
  WebMCP. Cleanup supports only standard document-info metadata and verifies a
  new copy by reopen, render, and rescan.
- Document Doctor compares strict pdf-lib, tolerant pdf-lib, and strict PDF.js
  loads. Deep mode checks bounded page operators, text, boxes, and renders.
  Optional inspection failures remain unknown/error signals rather than false
  absences. Its only transforms are reserialization (“Normalize”) and an
  explicitly lossy image-page rebuild; both create and verify a new copy.

These checks are not comprehensive privacy, malware, hidden-content, PDF/A,
PDF/UA, WCAG, repair, accessibility-compliance, or signature-validity checks.
Any rewrite can invalidate a digital signature. Inputs remain immutable, but
browser/device memory limits apply.

## WebMCP boundary

The only API used is `document.modelContext.registerTool(tool, { signal })`.
AbortController ownership removes state-dependent registrations. Schemas are
bounded, reject extra properties, and results are JSON-serializable metadata.
Results never contain bytes, base64, blob URLs, raw document text, raw sensitive
matches, or local paths. Tools never select files or start downloads.

| Page/state | Registered tools |
|---|---|
| Home | `find-document-tools`, `open-document-tool` |
| Merge, no selection | none |
| Merge, selection | `get-selected-files`, `set-file-order`, `remove-selected-file`, `merge-selected-files` as state permits |
| Workflows, always | `recommend-document-workflow` |
| Workflows, queue state | `get-workflow-queue-status`, `cancel-workflow-queue`, `retry-workflow-file` as state permits |
| Privacy Scan, selected file | `scan-selected-document-privacy` |
| Document Doctor, selected file | `diagnose-document`, `normalize-document-structure`, `rebuild-document-page-content` as state permits |

All schemas set `additionalProperties:false` at their object boundary and use
the source caps in `public/js/webmcp.js`. Read-only inspection tools carry
`readOnlyHint`; PDF-content-derived summaries carry `untrustedContentHint`; and
transforms carry `consequentialHint`. UI and external abort signals cooperate
with the same cores. Selection/import generations suppress stale completion.

## Workflow storage and race ownership

`browserpdf-workflows` is the only IndexedDB database owned by the workflow
feature. A workflow record contains its ID, ordered stable step IDs, bounded
non-secret parameters, current step, file reference, and created/updated/expiry
timestamps. File bytes and workflow metadata are written atomically. Cleanup
removes expired BrowserPDF records and unreferenced owned file records without
enumerating or deleting unrelated databases/stores. Passwords are never
persisted and must be entered again after resume.

Concurrent imports reserve file-count and byte capacity before reads. Clear
invalidates import epochs, and queue run generations own cancellation; stale
imports/runs cannot repopulate or publish. Retry applies only after the current
run settles and retains successful outputs.

## Offline tiers

Release tier 1 is a static connection shell only. `public/sw.js` cache-first
serves exactly its same-origin allowlist, sends `/metrics/**` network-only, and
never caches normal HTML, user files, downloads, non-GET/cross-origin/blob/data
requests, or other paths. Normal navigations are network-first and fall back to
the script-free, nonce-free `/offline.html`. Each deployment has a deterministic
shell revision; waiting workers populate an isolated `bpdf-*` cache and activate
only after the visible update action. Removal first disables the controlling
owned worker, unregisters the exact scope, then deletes only `bpdf-*` caches.

Document tools are not enabled for offline use. The dependency and artifact gate
for every catalog tool is recorded in `docs/offline-vendoring-matrix.md`.

## Browser SDK

The isolated `sdk/` package is unpublished and source-available under the
repository's custom license. Package version `0.1.0` and API generation `v1` are
separate runtime/type constants. Explicit exports provide merge, privacy inspect,
doctor quick/deep diagnose, and normalize APIs for
`Blob | ArrayBuffer | Uint8Array`, with owned copies, AbortSignal, and structured
progress. It uses exact peer dependencies pdf-lib 1.17.1 and pdfjs-dist 6.2.108;
the caller supplies the matching local worker/assets and canvas runtime where
required. There are no CDN strings or site-shell/analytics/WebMCP/DOM imports in
the SDK build.

The deterministic build cleans only `sdk/dist`, emits an allowlisted package,
rejects stale/unexpected output, typechecks declarations, and exercises a clean
Chromium consumer. No npm publication or broad browser-support claim is made.

## Verification record

The repository tests cover real PDF artifacts, including a bounded one-page
scanned-image OCR output reopened through PDF.js, parser/render lifecycle cleanup,
abort/recovery and stale-operation races, exact WebMCP CDP discovery/invocation,
offline allow/block behavior, exact localized service head/JSON-LD responses,
responsive/keyboard/component-text-contrast checks,
SDK runtime/type parity, and normal CSP/no-store headers. Exact command counts
belong in the implementation handoff because they change as tests are added;
passing tests are evidence for the bounded capabilities above, not for any
explicit non-capability.
