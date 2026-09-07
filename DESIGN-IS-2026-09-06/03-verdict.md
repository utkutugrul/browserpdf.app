# Verdict: REDESIGN

**REDESIGN — BrowserPDF’s processing engine, speed, and direct tool flows are strong, but the shared shell and homepage need a focused redesign because the audit scored 13/30 and the load-bearing honesty principle scored 0.**

This is not a rewrite of the 29 conversion engines. It is a redesign of the shared product experience: homepage information architecture, header/trust/consent surfaces, state language, accessibility behavior, and a progressively enhanced WebMCP layer.

## Preserve

- The local-only document-processing architecture and absence of a file-upload endpoint (`public/js/merge.js:227-255`, `public/js/lib-loader.js:64-118`).
- The lightweight framework-free delivery model: 9 KB initial JS on home, 35 KB on Merge, zero idle animation ([evidence §9](01-evidence.md#9-environmentally-friendly)).
- Direct task entry on tool pages: literal heading, one-sentence explanation, then dropzone (`public/merge.html:79-96`).
- Brand tokens, dark theme and logo accent (`public/css/styles.css:42-104`; `public/index.html:43-56`).
- Cross-tool continuation after a result (`public/js/tool-ui.js:154-249`).

## Discard

- The equal-weight wall of 29 cards as the only primary discovery model (`public/index.html:86-497`). It caused failures on principles #4 and #10.
- Repeating the same privacy claim in five homepage regions and four Merge regions (`public/index.html:58-63,80-81,499-505,517-534,541-554`; `public/merge.html:58-63,81-83,139-145,176-185`). It caused failures on principles #6 and #10.
- The fixed mobile consent layout whose panel occupies 40.5% of the viewport and covers the primary task (`public/css/styles.css:1777-1828`; `worker.js:130`). It caused failures on principles #2, #3 and #5.

## Highest-leverage moves

1. **Principle #6 — Honest:** Replace absolute privacy/open-source/server claims with verifiable language, label the license “source-available” unless it changes, and make the consent request exactly match the storage categories granted with equal visual weight for Accept and Reject. Evidence: `public/index.html:81,502-504`; `LICENSE.md:5-15`; `worker.js:130`; `public/js/consent.js:8-37`.
2. **Principles #5 and #2 — Unobtrusive and useful:** Replace the mobile consent takeover with a compact, content-sized choice that never covers the primary dropzone; remove the inherited 260 px flex basis in column layout and preserve immediate access to the task. Evidence: `public/css/styles.css:1777-1828`; mobile measurement in [01-evidence.md](01-evidence.md#accessibility-evidence).
3. **Principles #4 and #10 — Understandable and minimal:** Redesign home around intent-first search, a small “most used” set, and progressively disclosed categories; reduce trust copy to one concise proof strip with optional technical details instead of repeating all 29 equal-weight cards and the privacy promise across the page. Evidence: `public/index.html:84-535`; [01-evidence.md §10](01-evidence.md#10-as-little-design-as-possible).
4. **Principle #8 — Thorough:** Build one shared accessible state contract for no results, file-selected, loading/progress, error, persistent success, and disabled states; add skip links, progress semantics, explicit header focus, and correct dialog focus/Escape behavior. Evidence: `public/js/hub.js:7-17`; `public/merge.html:121-128`; `public/js/tool-ui.js:35-40`; `public/js/consent.js:19-49`.
5. **Principle #1 — Innovative:** Add WebMCP as progressive enhancement: register only a small hub discovery/navigation tool set and state-relevant tools on the active utility page, reuse the existing client-side action functions, honor cancellation and annotations, and operate only on user-selected page-local files until binary transfer is standardized. Evidence: current conventional patterns at `public/index.html:79-497` and `public/merge.html:81-119`; WebMCP draft guidance summarized in [01-evidence.md §1](01-evidence.md#webmcp-opportunity).
