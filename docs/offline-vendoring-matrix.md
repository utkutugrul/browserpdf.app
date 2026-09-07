# Full-offline dependency vendoring spike

Status: investigation only. No document tool is enabled or advertised for offline use in this release. Phase 8 caches only the static shell allowlist in `public/sw.js` and an intentional connection fallback.

## Dependency sets to vendor and verify

| Dependency | Current pinned version | Required local artifacts before any tool can be enabled offline |
|---|---:|---|
| PDF.js | 6.2.108 | API module, matching worker module, `standard_fonts/`, packed `cmaps/`, `wasm/`; confirm every requested asset is same-origin and available after network disable |
| pdf-lib | 1.17.1 | Browser bundle and integrity/version provenance |
| encryption pdf-lib fork | 2.7.4 | Browser bundle, password/permission artifacts, license/provenance review |
| Tesseract.js | 7.0.0 | API module, matching worker, WASM/core assets, and every selectable language traineddata file |
| Mammoth | 1.9.0 | Browser bundle plus real DOCX conversion fixture |
| SheetJS | 0.18.5 | Browser bundle plus real XLSX read/write fixtures |

The Tesseract spike must inventory all 14 selectable languages and measure storage before proposing an opt-in language download. A page shell loading offline is not evidence that OCR or any PDF operation works offline.

## Tool matrix

Every row defaults to **Unavailable / not enabled**. “Required set” is an investigation input, not a capability claim.

| Tool slug | Required set | Release status | Artifact gate for a future release |
|---|---|---|---|
| pdf-to-markdown | PDF.js; optional Tesseract + languages | Unavailable / not enabled | Text PDF and scanned multilingual PDF outputs offline |
| pdf-to-word | PDF.js; optional Tesseract + languages | Unavailable / not enabled | Reopenable DOCX from text and scanned PDFs offline |
| word-to-pdf | Mammoth, pdf-lib | Unavailable / not enabled | Reopenable PDF from fixture DOCX offline |
| extract-text | PDF.js; optional Tesseract + languages | Unavailable / not enabled | Exact text and OCR fallback offline |
| images | PDF.js, pdf-lib | Unavailable / not enabled | Rendered ZIP and image-to-PDF paths offline |
| markdown-to-pdf | pdf-lib | Unavailable / not enabled | Reopenable PDF with pagination offline |
| pdf-to-excel | PDF.js, SheetJS | Unavailable / not enabled | Reopenable XLSX with table fixture offline |
| excel-to-pdf | SheetJS, pdf-lib | Unavailable / not enabled | Reopenable PDF with sheet fixture offline |
| jpg-to-pdf | pdf-lib | Unavailable / not enabled | Reopenable multi-image PDF offline |
| merge | pdf-lib | Unavailable / not enabled | Ordered, reopenable merged artifact offline |
| split | PDF.js, pdf-lib | Unavailable / not enabled | Page-range PDFs and ZIP offline |
| organize | PDF.js, pdf-lib | Unavailable / not enabled | Reordered artifact and thumbnails offline |
| rotate | PDF.js, pdf-lib | Unavailable / not enabled | Rotated artifact and preview offline |
| page-numbers | PDF.js, pdf-lib | Unavailable / not enabled | Numbered artifact and preview offline |
| watermark | PDF.js, pdf-lib | Unavailable / not enabled | Watermarked artifact and preview offline |
| fill-sign | PDF.js, pdf-lib | Unavailable / not enabled | Reopenable drawing/text artifact offline |
| crop | PDF.js, pdf-lib | Unavailable / not enabled | Verified page-box artifact offline |
| delete-pages | PDF.js, pdf-lib | Unavailable / not enabled | Correct remaining pages offline |
| add-text | PDF.js, pdf-lib | Unavailable / not enabled | Reopenable positioned text artifact offline |
| add-image | PDF.js, pdf-lib | Unavailable / not enabled | Reopenable image-stamp artifact offline |
| highlight | PDF.js, pdf-lib | Unavailable / not enabled | Reopenable highlight artifact offline |
| edit-metadata | pdf-lib | Unavailable / not enabled | Exact metadata round trip offline |
| unlock | encryption pdf-lib fork | Unavailable / not enabled | Correct-password reopen and wrong-password rejection offline |
| protect | encryption pdf-lib fork | Unavailable / not enabled | Password and permission enforcement offline |
| redact | PDF.js, pdf-lib | Unavailable / not enabled | Pixel/text removal regression offline |
| compress | PDF.js, pdf-lib | Unavailable / not enabled | Reopenable bounded raster output offline |
| ocr-pdf | PDF.js, pdf-lib, Tesseract + languages | Unavailable / not enabled | Searchable multilingual artifact offline |
| markdown-viewer | pdf-lib for PDF export | Unavailable / not enabled | Viewer and reopenable export offline |
| view-pdf | PDF.js | Unavailable / not enabled | Multi-page render/navigation offline |

## Promotion gate

A future change may move one row out of the default only after an isolated browser test installs an explicit versioned cache, disables the network, runs the real fixture through every supported branch, validates the artifact, audits storage/eviction behavior, and proves updates remove only obsolete `bpdf-*` data. The normal nonce-bearing HTML pages must remain network-only; an offline-capable tool would need a separately reviewed static entry document and CSP.
