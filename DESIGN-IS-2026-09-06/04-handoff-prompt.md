```text
/make-plan Redesign BrowserPDF’s shared shell, homepage, representative Merge PDF experience, and agent-facing integration. Current design failed audit at 13/30 with critical gaps in principles #4 understandable, #5 unobtrusive, #6 honest, #8 thorough, and #10 as little design as possible.

Verdict paragraph (quoted from 03-verdict.md):
> REDESIGN — BrowserPDF’s processing engine, speed, and direct tool flows are strong, but the shared shell and homepage need a focused redesign because the audit scored 13/30 and the load-bearing honesty principle scored 0.

Why redesign and not refine: The total is below the 20/30 refine threshold, the consent flow and absolute trust claims make the load-bearing honesty principle score 0, and the homepage’s equal-weight catalog needs a new information architecture rather than cosmetic restyling.

Preserve from current design:
- The local-only document-processing architecture and absence of a file-upload endpoint (`public/js/merge.js:227-255`, `public/js/lib-loader.js:64-118`).
- The lightweight framework-free delivery model: 9 KB initial JS on home, 35 KB on Merge, zero idle animation (`DESIGN-IS-2026-09-06/01-evidence.md#9-environmentally-friendly`).
- Direct task entry on tool pages: literal heading, one-sentence explanation, then dropzone (`public/merge.html:79-96`).
- Brand tokens, dark theme and logo accent (`public/css/styles.css:42-104`; `public/index.html:43-56`).
- Cross-tool continuation after a result (`public/js/tool-ui.js:154-249`).

Discard:
- The equal-weight wall of 29 cards as the only primary discovery model. Evidence: `public/index.html:86-497`. Caused failure on principles #4 and #10.
- Repetition of the same privacy claim in five homepage regions and four Merge regions. Evidence: `public/index.html:58-63,80-81,499-505,517-534,541-554`; `public/merge.html:58-63,81-83,139-145,176-185`. Caused failure on principles #6 and #10.
- The fixed mobile consent takeover. Evidence: `public/css/styles.css:1777-1828`; `worker.js:130`; it occupies 40.5% of a 390×844 viewport and overlaps roughly 32% of Merge’s dropzone. Caused failure on principles #2, #3 and #5.

Top 5 moves from the audit (verbatim):
1. **Principle #6 — Honest:** Replace absolute privacy/open-source/server claims with verifiable language, label the license “source-available” unless it changes, and make the consent request exactly match the storage categories granted with equal visual weight for Accept and Reject. Evidence: `public/index.html:81,502-504`; `LICENSE.md:5-15`; `worker.js:130`; `public/js/consent.js:8-37`.
2. **Principles #5 and #2 — Unobtrusive and useful:** Replace the mobile consent takeover with a compact, content-sized choice that never covers the primary dropzone; remove the inherited 260 px flex basis in column layout and preserve immediate access to the task. Evidence: `public/css/styles.css:1777-1828`; mobile measurement in `DESIGN-IS-2026-09-06/01-evidence.md#accessibility-evidence`.
3. **Principles #4 and #10 — Understandable and minimal:** Redesign home around intent-first search, a small “most used” set, and progressively disclosed categories; reduce trust copy to one concise proof strip with optional technical details instead of repeating all 29 equal-weight cards and the privacy promise across the page. Evidence: `public/index.html:84-535`; `DESIGN-IS-2026-09-06/01-evidence.md#10-as-little-design-as-possible`.
4. **Principle #8 — Thorough:** Build one shared accessible state contract for no results, file-selected, loading/progress, error, persistent success, and disabled states; add skip links, progress semantics, explicit header focus, and correct dialog focus/Escape behavior. Evidence: `public/js/hub.js:7-17`; `public/merge.html:121-128`; `public/js/tool-ui.js:35-40`; `public/js/consent.js:19-49`.
5. **Principle #1 — Innovative:** Add WebMCP as progressive enhancement: register only a small hub discovery/navigation tool set and state-relevant tools on the active utility page, reuse the existing client-side action functions, honor cancellation and annotations, and operate only on user-selected page-local files until binary transfer is standardized. Evidence: current conventional patterns at `public/index.html:79-497` and `public/merge.html:81-119`; WebMCP draft guidance summarized in `DESIGN-IS-2026-09-06/01-evidence.md#webmcp-opportunity`.

Redesign principles in priority order:
1. Principle #6 — Honest — Every privacy, licensing, consent and capability claim must map exactly to shipped behavior and configuration.
2. Principles #2 and #4 — Useful and understandable — A first-time user should identify the right tool, add files and reach the primary action without interruption or technical vocabulary.
3. Principles #5 and #10 — Unobtrusive and minimal — Content and the active document task remain the figure; trust proof, navigation and consent stay quiet and progressively disclosed.
4. Principle #8 — Thorough — Every state and keyboard path has visible, semantic and recoverable behavior.
5. Principle #1 — Innovative — WebMCP adds agent collaboration without weakening local processing, confusing agents with 29 registrations, or degrading non-supporting browsers.

Product and visual direction:
- Create a calm, premium document workspace, not a marketing-heavy SaaS landing page: neutral surfaces, one purple brand accent, stronger type hierarchy, cleaner whitespace, consistent icon geometry, and no decorative motion.
- On home, lead with an intent search (“What do you want to do with your document?”), show at most six popular/recent tools, then reveal the complete catalog through clear categories and search results.
- On tool pages, keep heading → privacy proof → working surface above the fold. Move long FAQ/technical proof below the task and make technical details expandable.
- Consolidate spacing and typography into small explicit scales; preserve WCAG AA in light/dark modes and fix the 4.31:1 filter placeholder.
- Keep the vanilla HTML/CSS/ES-module architecture, Cloudflare Worker delivery, 22-language i18n, clean routes, strict CSP, current security properties, and full operation without WebMCP.

WebMCP technical constraints and target design:
- Follow the 4 September 2026 W3C Community Group draft at https://webmachinelearning.github.io/webmcp/; treat it as an evolving draft, not a finished W3C Standard.
- Feature-detect `document.modelContext`; failure or absence must be a silent no-op for normal users.
- Create one small shared adapter with AbortController-based registration lifecycle and localized titles/descriptions.
- On home, prefer two non-overlapping tools such as `find-document-tools` and `open-document-tool`; do not register 29 separate catalog tools.
- On Merge, dynamically register only state-relevant operations such as `get-selected-files`, `set-file-order`, `remove-selected-file`, and `merge-selected-files`, reusing extracted existing application functions instead of simulating clicks.
- WebMCP tools may act only on files the user has already selected into current page state. Return bounded JSON metadata, never document contents by default. Do not invent binary transfer while transferable/streamable inputs and outputs remain an open spec issue.
- Use precise JSON Schemas, stable non-overlapping names, `readOnlyHint` where accurate, `untrustedContentHint` for any document-derived text, `AbortSignal` cancellation, same-origin exposure, and an explicit `Permissions-Policy` decision.
- Add a test-only ModelContext stub or adapter seam so registration, schema, lifecycle, cancellation, state relevance and fallback behavior can be tested in standard Playwright Chromium even when the native API is unavailable.

Deliverables for the plan:
- New information architecture not derived mechanically from the old card wall.
- New primary home and Merge flows, with labeled low-fi desktop/mobile wireframes compared side-by-side to current.
- Consolidated token decisions: type scale, spacing scale, semantic colors, focus treatment, and color-count cap.
- States checklist: no-results/empty, selected, loading/progress, error/recovery, persistent success, focus, disabled, consent and unsupported-WebMCP fallback.
- Exact copy corrections across visible HTML, metadata, JSON-LD, privacy copy and consent behavior; account for all translation keys.
- WebMCP adapter/API design, per-page registration matrix, schemas, security/privacy boundaries and progressive-enhancement tests.
- Migration path that first fixes honesty/consent, then ships shared tokens/shell and home IA, then migrates Merge, then rolls the shared pattern through the remaining tools, then enables WebMCP progressively.
- Cutover criteria: WCAG AA; no primary-action overlap at 320 px and above; keyboard-complete flows; all existing smoke tests pass; initial JS remains under 100 KB per audited surface; zero idle animation; WebMCP feature absence causes zero errors; tool schemas/lifecycle pass adapter tests; all capability/privacy claims match runtime and license.

Anti-patterns to guard against:
- Porting the old 29-card wall under new colors.
- Adding a framework, animation library, remote font or decorative gradient that harms the existing speed advantage.
- Registering all 29 WebMCP tools at once or exposing document bytes/text without explicit user intent.
- Claiming “WebMCP compliant” as if the draft and binary transport were stable; describe exact supported behavior.
- Keeping both old and new shared shells indefinitely.
- Treating the Preserve list as optional.
```
