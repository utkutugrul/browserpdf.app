#!/usr/bin/env python3
"""Update OG image meta tags in all tool HTML files to use per-tool PNGs.

For each tool, replaces whatever og:image block exists with a consistent
5-line block pointing at /og/{slug}.png, including image:type and image:alt.

Does NOT touch twitter:* meta tags; those are owned by
normalize-twitter-meta.py. Run that script after this one if you want
twitter:image to also point at the new PNG.

Idempotent: running it twice produces the same output.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku

# slug -> og:image:alt text (short, descriptive; helps screen readers and some
# social platforms show a fallback title when the image fails to load).
ALT = {
    'pdf-to-markdown':  'Preview of the PDF to Markdown tool: a PDF page converting into clean Markdown text.',
    'merge':            'Preview of the Merge PDF tool: several PDF files combining into one document.',
    'split':            'Preview of the Split PDF tool: a PDF being split into separate page files.',
    'markdown-viewer':  'Preview of the Markdown Viewer tool: Markdown source next to its live rendered preview.',
    'compress':         'Preview of the Compress PDF tool: a large PDF being shrunk into a smaller file.',
    'images':           'Preview of the PDF to Images tool: PDF pages exporting as PNG and JPG files.',
    'markdown-to-pdf':  'Preview of the Markdown to PDF tool: Markdown source laid out as a paginated PDF.',
    'fill-sign':        'Preview of the Fill and Sign tool: a PDF form being filled and a signature placed on the page.',
    'pdf-to-word':      'Preview of the PDF to Word tool: a PDF converting into an editable .docx document.',
    'extract-text':     'Preview of the Extract Text tool: text being pulled out of a PDF into a plain text file.',
    'rotate':           'Preview of the Rotate PDF tool: a sideways PDF page being rotated upright.',
    'organize':         'Preview of the Organize PDF tool: PDF page thumbnails being reordered and rotated.',
    'page-numbers':     'Preview of the Add Page Numbers tool: page numbers stamped into the corner of every PDF page.',
    'watermark':        'Preview of the Add Watermark tool: a DRAFT watermark stamped across every PDF page.',
    'ocr-pdf':          'Preview of the Make Searchable (OCR) tool: an invisible text layer being added to a scanned PDF.',
    'unlock':           'Preview of the Unlock PDF tool: a password-protected PDF being opened without a password.',
    'protect':          'Preview of the Protect PDF tool: a PDF being encrypted with a password.',
    'crop':             'Preview of the Crop PDF tool: the margins of a PDF page being trimmed with a live preview.',
    'delete-pages':     'Preview of the Delete PDF Pages tool: selected page thumbnails being removed from a PDF.',
    'word-to-pdf':      'Preview of the Word to PDF tool: a .docx file converting into a paginated PDF.',
    'excel-to-pdf':    'Preview of the Excel to PDF tool: a spreadsheet being laid out onto PDF pages.',
    'pdf-to-excel':     'Preview of the PDF to Excel tool: table text in a PDF being clustered into .xlsx rows and columns.',
    'jpg-to-pdf':       'Preview of the JPG to PDF tool: several JPG and PNG images combining into one PDF file.',
}

# Match og:image and any og:image:* sub-properties. Deliberately does NOT
# match twitter:image (that line belongs to normalize-twitter-meta.py).
BLOCK = re.compile(
    r'<meta property="og:image"[^\n]*\n'
    r'(?:<meta property="og:image:(?:width|height|type|alt)"[^\n]*\n)*',
    re.MULTILINE,
)

def new_block(slug: str) -> str:
    alt = ALT[slug].replace('"', '&quot;')
    return (
        f'<meta property="og:image" content="https://browserpdf.app/og/{slug}.png">\n'
        f'<meta property="og:image:width" content="1200">\n'
        f'<meta property="og:image:height" content="630">\n'
        f'<meta property="og:image:type" content="image/png">\n'
        f'<meta property="og:image:alt" content="{alt}">\n'
    )

def update_file(html_path: Path, slug: str) -> bool:
    text = html_path.read_text(encoding='utf-8')
    new_text, n = BLOCK.subn(new_block(slug), text, count=1)
    if n == 0:
        print(f'  !! {html_path.name}: no OG block matched', file=sys.stderr)
        return False
    if new_text == text:
        print(f'  .. {html_path.name}: already up to date')
        return False
    html_path.write_text(new_text, encoding='utf-8')
    print(f'  ok {html_path.name}')
    return True

def main() -> int:
    rc = 0
    for slug in ALT:
        html = SITE / f'{slug}.html'
        if not html.exists():
            print(f'  !! missing {html}', file=sys.stderr)
            rc = 1
            continue
        update_file(html, slug)
    return rc

if __name__ == '__main__':
    raise SystemExit(main())
