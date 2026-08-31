// Generates per-tool 1200x630 PNG OG images into /og/{slug}.png.
// Re-run when adding a tool or changing brand visuals.
//
// Usage (sharp is installed ephemerally, outside this repo's dependencies):
//   mkdir -p /tmp/og-gen && cd /tmp/og-gen && npm init -y && npm install sharp
//   NODE_PATH=/tmp/og-gen/node_modules node <repo>/scripts/gen-og.mjs
//
// Output: <repo>/og/{slug}.png  (+ browserpdf.png for the hub)
//
// Each OG image is a single PNG (no JS, no external fonts) so it renders on
// Twitter, Facebook, WhatsApp, LinkedIn, Telegram, Slack, Discord, Bluesky,
// Mastodon, iMessage, and every other consumer of og:image.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITE = resolve(ROOT, 'public'); // deploy edilen site koku
const OUT_DIR = resolve(SITE, 'og');
mkdirSync(OUT_DIR, { recursive: true });

// Per-tool icon SVG markup, in a 24x24 viewBox (matches index.html tool cards).
// All shapes use stroke="white" inherited from the wrapping <g>.
const ICONS = {
  'pdf-to-markdown': '<path d="M7 4h6l4 4v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M9 12h6M9 15h6M9 9h2"/>',
  'merge': '<rect x="4" y="7" width="11" height="13" rx="1.5"/><rect x="9" y="4" width="11" height="13" rx="1.5"/>',
  'split': '<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M5 12h14" stroke-dasharray="2 2"/>',
  'markdown-viewer': '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>',
  'compress': '<path d="M8 3v4a1 1 0 0 1-1 1H3"/><path d="M21 8h-4a1 1 0 0 1-1-1V3"/><path d="M3 16h4a1 1 0 0 1 1 1v4"/><path d="M16 21v-4a1 1 0 0 1 1-1h4"/>',
  'images': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  'markdown-to-pdf': '<rect x="1" y="7" width="7" height="10" rx="1"/><path d="M10 12h4m0 0l-1.5-1.5M14 12l-1.5 1.5"/><rect x="16" y="5" width="7" height="10" rx="1"/>',
  'fill-sign': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  'pdf-to-word': '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><path d="M8.5 13l1.2 5 1.8-4 1.8 4 1.2-5"/>',
  'extract-text': '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  'rotate': '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  'organize': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  'page-numbers': '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  'watermark': '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  'ocr-pdf': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'unlock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'protect': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'crop': '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  'delete-pages': '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  'word-to-pdf': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  'excel-to-pdf': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h2l2 3 2-3h2"/>',
  'pdf-to-excel': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  'jpg-to-pdf':       '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  'browserpdf': '<path d="M18 6H10a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V12z"/><path d="M18 6v6h6"/>',
  'edit-metadata': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
  'add-image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  'add-text': '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  'redact': '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="9" y="9" width="6" height="6"/>',
  'highlight': '<path d="M9 11l-4 4v4h4l4-4"/><path d="M14 6l4 4-7 7-4-4z"/>',
  'view-pdf': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M15 2v5h5"/><circle cx="12" cy="13" r="1.5"/>',
};

// Short display name + one-line tagline. Keep titles under ~22 chars so they
// fit on one line at 58px bold. Taglines should be one sentence, under ~80 chars.
const TOOLS = [
  { slug: 'browserpdf',         title: 'BrowserPDF',           tagline: 'Free PDF tools that run in your browser. No upload, no signup, no watermark.' },
  { slug: 'pdf-to-markdown',    title: 'PDF to Markdown',     tagline: 'Convert PDFs to clean Markdown, with OCR for scanned pages.' },
  { slug: 'merge',              title: 'Merge PDFs',           tagline: 'Combine multiple PDFs into one, in the order you choose.' },
  { slug: 'split',              title: 'Split PDF',           tagline: 'Extract page ranges, or split every page into its own file.' },
  { slug: 'markdown-viewer',    title: 'Markdown Viewer',     tagline: 'Paste or drop Markdown and see it rendered live, side by side.' },
  { slug: 'compress',           title: 'Compress PDF',        tagline: 'Shrink file size for easier sharing, in your browser.' },
  { slug: 'images',             title: 'PDF & Images',        tagline: 'Export pages as images, or build a PDF from images.' },
  { slug: 'markdown-to-pdf',    title: 'Markdown to PDF',     tagline: 'Turn Markdown into a clean, paginated PDF.' },
  { slug: 'fill-sign',           title: 'Fill & Sign',         tagline: 'Fill form fields and add a signature, drawn or typed.' },
  { slug: 'pdf-to-word',        title: 'PDF to Word',         tagline: 'Convert to an editable .docx, with headings and lists preserved.' },
  { slug: 'extract-text',       title: 'Extract Text',        tagline: 'Pull all text out as plain .txt, with OCR fallback.' },
  { slug: 'rotate',             title: 'Rotate PDF',         tagline: 'Fix sideways pages, one at a time or all at once.' },
  { slug: 'organize',           title: 'Organize PDF',        tagline: 'Reorder, rotate, and delete pages in one view.' },
  { slug: 'page-numbers',       title: 'Add Page Numbers',    tagline: 'Stamp numbers in the corner, format, and start you choose.' },
  { slug: 'watermark',          title: 'Add Watermark',       tagline: 'Stamp DRAFT or CONFIDENTIAL across every page.' },
  { slug: 'ocr-pdf',            title: 'Make Searchable',     tagline: 'Add an invisible OCR text layer so scanned PDFs become searchable.' },
  { slug: 'unlock',             title: 'Unlock PDF',         tagline: 'Remove a password from a protected PDF.' },
  { slug: 'protect',            title: 'Protect PDF',         tagline: 'Add password encryption and permissions to a PDF.' },
  { slug: 'crop',               title: 'Crop PDF',           tagline: 'Trim margins from every page with a live preview.' },
  { slug: 'delete-pages',       title: 'Delete PDF Pages',   tagline: 'Mark pages to remove and download a leaner PDF.' },
  { slug: 'word-to-pdf',       title: 'Word to PDF',         tagline: 'Convert a .docx to a paginated PDF entirely in your browser.' },
  { slug: 'excel-to-pdf',      title: 'Excel to PDF',        tagline: 'Turn a spreadsheet into a clean PDF, sheet by sheet.' },
  { slug: 'pdf-to-excel',      title: 'PDF to Excel',        tagline: 'Pull table-like text into an editable .xlsx spreadsheet.' },
  { slug: 'jpg-to-pdf',         title: 'JPG to PDF',         tagline: 'Combine photos or scans into one PDF file.' },
  { slug: 'edit-metadata',      title: 'Edit Metadata',      tagline: 'View and edit PDF title, author, subject, and keywords.' },
  { slug: 'add-image',          title: 'Add Image to PDF',   tagline: 'Stamp a logo, photo, or image onto your pages.' },
  { slug: 'add-text',           title: 'Add Text to PDF',    tagline: 'Type text onto any page, wherever you click.' },
  { slug: 'redact',             title: 'Redact PDF',         tagline: 'Permanently black out sensitive text or areas.' },
  { slug: 'highlight',          title: 'Highlight PDF',      tagline: 'Highlight text with a virtual highlighter pen.' },
  { slug: 'view-pdf',           title: 'PDF Viewer',         tagline: 'Open and read PDFs with zoom, navigation, and print.' },
];

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

// Wrap a tagline to at most 2 lines of ~46 chars each, centered as a block.
// Returns an array of strings (1 or 2 lines).
function wrapTagline(text) {
  const MAX = 52;
  if (text.length <= MAX) return [text];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > MAX) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function makeSvg({ title, tagline, iconMarkup }) {
  const tagLines = wrapTagline(tagline);
  const tagY = 430;
  const tagTexts = tagLines.map((line, i) =>
    `<text x="64" y="${tagY + i * 32}" font-family="${FONT}" font-size="24" font-weight="400" fill="rgba(255,255,255,0.85)">${escapeXml(line)}</text>`
  ).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7b76f0"/>
      <stop offset="1" stop-color="#4f46d6"/>
    </linearGradient>
    <linearGradient id="iconBox" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Decorative oversized PDF glyph in the bottom-right corner -->
  <g transform="translate(880,330)" opacity="0.07">
    <path d="M180 60H100a20 20 0 0 0-20 20v160a20 20 0 0 0 20 20h120a20 20 0 0 0 20-20V120z" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M180 60v60h60" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Brand mark + wordmark, top-left -->
  <g transform="translate(64,52)">
    <rect width="32" height="32" rx="8" fill="#ffffff"/>
    <path d="M18 6H10a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V12z" fill="none" stroke="#4f46d6" stroke-width="1.8"/>
    <path d="M18 6v6h6" fill="none" stroke="#4f46d6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="108" y="74" font-family="${FONT}" font-size="22" font-weight="500" fill="#ffffff">browser<tspan font-weight="700">pdf</tspan></text>

  <!-- Tool icon inside a translucent rounded tile -->
  <g transform="translate(64,160)">
    <rect width="140" height="140" rx="28" fill="url(#iconBox)" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1"/>
    <g transform="translate(26,26) scale(3.6667)" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
      ${iconMarkup}
    </g>
  </g>

  <!-- Tool name -->
  <text x="64" y="380" font-family="${FONT}" font-size="58" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>

  <!-- Tagline (1 or 2 lines) -->
  ${tagTexts}

  <!-- Bottom strip: privacy note + domain -->
  <g transform="translate(64,556)">
    <rect x="0" y="6" width="14" height="11" rx="2" fill="none" stroke="#ffffff" stroke-width="1.5"/>
    <path d="M3 6V4a4 4 0 0 1 8 0v2" fill="none" stroke="#ffffff" stroke-width="1.5"/>
    <text x="22" y="16" font-family="${FONT}" font-size="15" font-weight="400" fill="rgba(255,255,255,0.85)">Runs entirely in your browser. No upload, no signup, no watermark.</text>
  </g>
  <text x="1136" y="572" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="500" fill="rgba(255,255,255,0.85)">browserpdf.app</text>
</svg>`;
}

let count = 0;
for (const tool of TOOLS) {
  const iconMarkup = ICONS[tool.slug];
  if (!iconMarkup) {
    console.error(`Missing icon for ${tool.slug}`);
    process.exit(1);
  }
  const svg = makeSvg(tool);
  const outPath = resolve(OUT_DIR, `${tool.slug}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  count++;
  console.log(`  wrote ${outPath.replace(ROOT + '/', '')}`);
}

console.log(`\nDone. ${count} OG images written to ${OUT_DIR.replace(ROOT + '/', '')}/`);
