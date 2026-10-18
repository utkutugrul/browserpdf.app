# Service engine foundation — Phase 1 evidence

2026-10-18. This records the engine stream of `plans/02-browserpdf-service-improvements.md`; the complete 32-service program remains open.

## Implemented contracts

- `public/js/core/pdf-fonts.js`: `embedUnicodeFont(doc,{text,weight,signal,onStatus})`, `embedDocumentFonts(doc,{text,styles,signal,onStatus})`, `assertFontSupports(font,text)`, `resolveDocumentFont({text,weight})`, `ensureUnicodePreviewFont(weight,{text})`. Preview and export resolve the same local font bytes. Weights are regular/bold/italic/boldItalic/code. Unsupported characters and unavailable script styles fail visibly before drawing; characters are never filtered or replaced.
- `public/js/core/page-geometry.js`: `viewportPointToPdf`, `pdfPointToViewport`, `viewportRectToPdf`, `visualTransform`. Optional CSS width/height account for resized and HiDPI previews; PDF.js supplies rotation, CropBox origin and UserUnit handling. The full matrix handles glyph/image orientation, not just anchor position.
- `public/js/core/text-layout.js`: validated Letter/A4/custom dimensions and grapheme-aware `wrapText` without cell/token truncation.
- `public/js/core/spreadsheet-pdf.js`: `buildSpreadsheetPdf(sheets,pdfLib,options)` wraps complete cells, continues tall rows across pages, measures column widths, accepts explicit widths/paper/margin, and exports multiple selected sheets. The adapter exposes All sheets. Bounds are 100 columns, 10,000 rows per sheet and 200,000 cells. A page/font/margin combination must fit at least one full line before any PDF allocation; pagination also checks capacity after creating a page and checks cancellation inside tall rows.
- `public/js/md-layout.js`: compatible `layoutMarkdownToPdf(markdown,pdfLib,options={})`, shared real fonts/metrics, long-token wrapping, page size/margin/AbortSignal and future block extension. Code uses a real monospaced font.
- `public/js/pdf-convert.js`: `extractPdfTextModel(file,opts,callbacks)` returns per-page source/text/lines/items/confidence before Markdown serialization. Any embedded text is retained; OCR runs only for text-empty pages or explicit `forceOcr`/`ocrPages`. PDF tasks are destroyed. OCR render surfaces are capped at 4096 pixels per dimension and 16 million pixels, render cancellation is wired, and cancellation terminates the OCR worker. `renderOcrPageToCanvas` releases its surface on synchronous render errors, rejected render tasks and cancellation. `recognizeOcrPage` owns successful surfaces through recognition and always releases them, racing an in-flight job with abort so a terminated worker's unresolved recognition promise cannot hang the operation. Shared worker termination is idempotent.
- `public/js/extract-text.js`: direct plain-text serialization retains literal punctuation; the visible text result provides an explicit final download and typed continuation.
- `public/js/pdf-to-excel.js`: a text-empty extraction produces an error and OCR continuation, with no empty successful workbook; PDF tasks are destroyed. Successful workbook results follow shared review before download.

## Dependencies and sources

The exact pinned Noto font commit, source URL and SHA-256 of each local file are in `public/fonts/provenance.json`. Noto Sans regular/bold/italic/boldItalic, Noto Sans Mono regular, Noto Sans Hebrew regular/bold and Noto Naskh Arabic regular/bold are licensed under the supplied `public/fonts/OFL.txt` (SIL OFL 1.1). Files are fetched lazily for the needed style/script.

The nine TTF assets total 3,182,468 bytes; the regular Latin/Greek/Cyrillic font is 569,208 bytes. The whole collection is not fetched for every tool or document.

`public/vendor/fontkit-1.1.1.umd.min.js` is the published `@pdf-lib/fontkit@1.1.1` UMD bundle (758,440 bytes). `lib-loader.js` verifies SHA-384 `2p6U+1mmqF10USehFeRiyG2ESG9FwIqN+jxULn5w9jjQIihSn9Pt13dVCn/Hawjn` before executing it. Package metadata declares MIT; attribution, metadata source and license text are in `public/vendor/fontkit-LICENSE.txt`. No font or library was generated from document contents.

API evidence: installed `pdf-lib/es/api/PDFDocument.d.ts` (`registerFontkit`, `embedFont`), `PDFFont.d.ts` (`getCharacterSet`), `pdfjs-dist/types/src/display/page_viewport.d.ts` (forward/inverse point transforms), and `pdfjs-dist/types/src/display/api.d.ts` (text item model). Primary references: [pdf-lib fonts](https://pdf-lib.js.org/docs/api/classes/pdfdocument#registerfontkit), [matching PDF.js viewport source](https://github.com/mozilla/pdf.js/blob/v6.2.108/src/display/page_viewport.js), [Tesseract worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [fontkit fork](https://github.com/Hopding/fontkit), [Noto pinned source](https://github.com/notofonts/noto-fonts/tree/c971829a87e7920f960e7277c3dafd9bedd3c601).

## Verification

`rtk proxy env BASE_URL=http://localhost:8788 npx playwright test tests/service-engines.spec.mjs --workers=1 --output=test-results/engine-final-phase1`: **10 passed** (33.2 seconds, final Phase 1 correction run with both workers' runtime sources frozen). Installed Chromium 151.0.7922.34; root-owned persistent local Wrangler at port 8788. No test process owns or shuts down this server.

The suite exercises the real Extract Text route using a one-item `2 * 3 * 4` PDF; real Excel→PDF CSV input retaining Turkish/Greek/Cyrillic and every character of a long cell; real scan-only PDF→Excel error/OCR handoff; real reviewed XLSX bytes reopened as a workbook; cancellation before the last extraction page is published; long-token pagination and actual saved-rectangle rendering at all four rotations with a nonzero CropBox and resized CSS surface.

Independent-review regressions also cover the zero-capacity page allocation defect using `{pageSize:[100,100],landscape:false,margin:0,fontSize:72}`. A guarded PDF allocator makes the pre-fix regression fail safely without unbounded pages; the fixed code rejects before allocation, and a neighboring valid 107-point-tall page exports one readable page. A real two-sheet XLSX is selected through the route's All sheets option and its exported PDF reopens with both sheets' Unicode content in order. Deterministic resource-boundary cases verify canvas release for synchronous/rejected render failure, recognition failure, render abort, recognition abort with an unresolved worker job, and abort inside the canvas factory.

Font artifacts are actual saved/reopened PDFs and rendered PNGs under `test-results/engine-final-phase1/service-engines-shared-Uni-33bdd-with-visible-glyph-failures-chromium/unicode-{0..6}.{pdf,png}`: Turkish/Greek/Cyrillic, Hebrew regular, Arabic regular, Hebrew bold, Arabic bold, Latin italic, Latin bold-italic. Re-extracted text equals the source. Rendered ink and contextual Arabic glyph substitution are additionally checked. These are bounded fixture results, not universal shaping or bidirectional layout certification.

## Remaining scope

Mixed Latin/Arabic/Hebrew text requiring multiple fallback fonts, complex bidirectional number ordering/diacritics, CJK/Indic/Thai fonts and general shaping remain Phase 3 work. The current resolver deliberately rejects text it cannot fully represent. Arabic/Hebrew italic and monospaced fallback are explicit unavailable-style errors. The current document-font helper selects one complete script font per text request; its future extension is styled fallback runs with shared preview/export placement. Serif family selection remains a workspace follow-up; no Times-equivalence claim is made.

Office layout fidelity, editable table correction, richer Markdown blocks, page-linked OCR controls, compression and the remaining audited services have not been marked complete by this foundation. No perfect Office conversion, arbitrary PDF text editing, structural redaction, full offline processing or universal Unicode support is claimed.
