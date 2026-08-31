#!/usr/bin/env python3
"""Normalize Twitter Card meta tags in every tool HTML file.

Replaces whatever twitter:* block exists with a clean, correctly-ordered:
    twitter:card
    twitter:title
    twitter:description
    twitter:image

The title and description are taken from the file's existing <meta name="twitter:title">
and <meta name="twitter:description"> (or, if missing, from og:title / og:description
or the page <title> / meta description). The image is /og/{slug}.png.

Idempotent: re-running produces the same output.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku

SLUGS = [
    'pdf-to-markdown','merge','split','markdown-viewer','compress','images',
    'markdown-to-pdf','fill-sign','pdf-to-word','extract-text','rotate',
    'organize','page-numbers','watermark','ocr-pdf','unlock','protect',
    'crop','delete-pages','word-to-pdf','excel-to-pdf','pdf-to-excel','jpg-to-pdf',
    'edit-metadata','add-image','add-text','redact','highlight','view-pdf',
]

# Matches the entire twitter:* block: one or more contiguous <meta name="twitter:*">
# lines, possibly separated by blank lines, from the first twitter: line to the
# last one before a non-twitter line or end of file.
TWITTER_BLOCK = re.compile(
    r'(?:<meta name="twitter:[a-z]+"[^>]*>\n(?:\n)?)+',
    re.MULTILINE,
)

def extract_meta(text: str, name: str) -> str | None:
    m = re.search(rf'<meta name="{re.escape(name)}" content="([^"]*)"', text)
    return m.group(1) if m else None

def extract_property(text: str, prop: str) -> str | None:
    m = re.search(rf'<meta property="{re.escape(prop)}" content="([^"]*)"', text)
    return m.group(1) if m else None

def extract_title_tag(text: str) -> str | None:
    m = re.search(r'<title>([^<]*)</title>', text)
    return m.group(1) if m else None

def update_file(html_path: Path, slug: str) -> bool:
    text = html_path.read_text(encoding='utf-8')
    title = (extract_meta(text, 'twitter:title')
             or extract_property(text, 'og:title')
             or extract_title_tag(text)
             or 'BrowserPDF')
    desc = (extract_meta(text, 'twitter:description')
            or extract_property(text, 'og:description')
            or extract_meta(text, 'description')
            or '')
    img = f'https://browserpdf.app/og/{slug}.png'
    replacement = (
        f'<meta name="twitter:card" content="summary_large_image">\n'
        f'<meta name="twitter:title" content="{title}">\n'
        f'<meta name="twitter:description" content="{desc}">\n'
        f'<meta name="twitter:image" content="{img}">\n'
    )
    new_text, n = TWITTER_BLOCK.subn(replacement, text, count=1)
    if n == 0:
        # No existing twitter block; insert one right after the OG block.
        # Find the og:image:alt line (or og:image if alt is missing) and
        # append after it.
        anchor = re.search(r'<meta property="og:image:alt"[^\n]*\n', text)
        if not anchor:
            anchor = re.search(r'<meta property="og:image"[^\n]*\n', text)
        if not anchor:
            print(f'  !! {html_path.name}: no anchor for twitter block', file=sys.stderr)
            return False
        idx = anchor.end()
        new_text = text[:idx] + '\n' + replacement + text[idx:]
    else:
        # Collapse any double blank lines the substitution may have left.
        new_text = re.sub(r'\n\n\n+', '\n\n', new_text)
    if new_text == text:
        print(f'  .. {html_path.name}: already up to date')
        return False
    html_path.write_text(new_text, encoding='utf-8')
    print(f'  ok {html_path.name}')
    return True

def main() -> int:
    rc = 0
    for slug in SLUGS:
        html = SITE / f'{slug}.html'
        if not html.exists():
            print(f'  !! missing {html}', file=sys.stderr)
            rc = 1
            continue
        update_file(html, slug)
    return rc

if __name__ == '__main__':
    raise SystemExit(main())
