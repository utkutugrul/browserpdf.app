# BrowserPDF Design Audit Scope

## Audited product

- Repository: `/Users/r00t/startup`
- Primary surface: `public/index.html` (tool discovery / home page)
- Representative task surface: `public/merge.html` (select PDFs, arrange them, merge, download)
- Shared presentation and behavior: `public/css/styles.css`, `public/js/hub.js`, `public/js/tool-ui.js`, `public/js/i18n.js`, `public/js/theme.js`, and relevant Worker-injected UI in `worker.js`
- Runtime target: local Cloudflare Worker development server where available; source inspection otherwise

## Primary user and task

The primary user needs to find an appropriate document tool and complete a PDF operation quickly while keeping the file in the browser rather than uploading it to a remote service.

## Constraints

- Preserve the BrowserPDF privacy promise: processing remains client-side.
- Preserve the lightweight, framework-free static HTML/CSS/JavaScript architecture.
- Preserve multilingual routing and the current 22-language coverage.
- Preserve responsive behavior and keyboard-accessible interaction.
- Treat WebMCP as progressive enhancement against the 4 September 2026 W3C Community Group draft: preserve full functionality when `document.modelContext` is unavailable.
- Do not claim that agents can directly supply or receive PDF binaries through WebMCP while transferable/streamable binary inputs and outputs remain an open specification issue. Agent tools should operate on user-selected, page-local files and current UI state.
- No implementation changes are part of this audit; the output is an evidence-backed improvement direction and planning handoff.

## Reference category

The relevant product category includes browser-based document utilities such as Smallpdf, iLovePDF, and Adobe Acrobat Online. These are category references only; this audit does not assume their patterns are automatically appropriate.

## Known scope limits

- The detailed interaction audit uses Merge PDF as the representative tool rather than exercising all 29 tools.
- Translation quality in all 22 languages is outside this pass.
- Legal accuracy and conversion fidelity are outside the visual/product-design score.
- WebMCP implementation is future work in the handoff, not part of the scored current-state audit.
