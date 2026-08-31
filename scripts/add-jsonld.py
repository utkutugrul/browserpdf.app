#!/usr/bin/env python3
"""Add SoftwareApplication + BreadcrumbList JSON-LD to every tool HTML page.

Each tool page already has a FAQPage JSON-LD block. This script wraps it
inside an @graph array alongside a SoftwareApplication node (so Google can
show a rich result for the tool itself, not just its FAQ) and a BreadcrumbList
(so the SERP shows "Home > Tool Name" instead of a bare URL).

The existing FAQPage JSON is parsed, kept verbatim, and re-emitted as the
third @graph entry. Nothing else on the page is touched.

After running, regenerate the CSP hashes with compute-csp-hashes.py.
Idempotent: re-running produces the same output.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku

# Per-tool metadata for SoftwareApplication + BreadcrumbList. name is the
# user-facing tool name (matches the hub card title); description is a short
# one-liner (mirrors the meta description but tighter). category follows
# schema.org's applicationCategory conventions.
TOOLS = {
    'pdf-to-markdown':  {'name': 'PDF to Markdown',     'category': 'UtilitiesApplication'},
    'merge':            {'name': 'Merge PDFs',          'category': 'UtilitiesApplication'},
    'split':            {'name': 'Split PDF',           'category': 'UtilitiesApplication'},
    'markdown-viewer':  {'name': 'Markdown Viewer',     'category': 'UtilitiesApplication'},
    'compress':         {'name': 'Compress PDF',        'category': 'UtilitiesApplication'},
    'images':           {'name': 'PDF to Images',       'category': 'UtilitiesApplication'},
    'markdown-to-pdf':  {'name': 'Markdown to PDF',     'category': 'UtilitiesApplication'},
    'fill-sign':        {'name': 'Fill & Sign',         'category': 'UtilitiesApplication'},
    'pdf-to-word':      {'name': 'PDF to Word',         'category': 'UtilitiesApplication'},
    'extract-text':     {'name': 'Extract Text',        'category': 'UtilitiesApplication'},
    'rotate':           {'name': 'Rotate PDF',          'category': 'UtilitiesApplication'},
    'organize':         {'name': 'Organize PDF',        'category': 'UtilitiesApplication'},
    'page-numbers':     {'name': 'Add Page Numbers',    'category': 'UtilitiesApplication'},
    'watermark':        {'name': 'Add Watermark',       'category': 'UtilitiesApplication'},
    'ocr-pdf':          {'name': 'Make Searchable (OCR)', 'category': 'UtilitiesApplication'},
    'unlock':           {'name': 'Unlock PDF',          'category': 'UtilitiesApplication'},
    'protect':          {'name': 'Protect PDF',         'category': 'UtilitiesApplication'},
    'crop':             {'name': 'Crop PDF',            'category': 'UtilitiesApplication'},
    'delete-pages':     {'name': 'Delete PDF Pages',   'category': 'UtilitiesApplication'},
    'word-to-pdf':      {'name': 'Word to PDF',         'category': 'UtilitiesApplication'},
    'excel-to-pdf':     {'name': 'Excel to PDF',        'category': 'UtilitiesApplication'},
    'pdf-to-excel':     {'name': 'PDF to Excel',        'category': 'UtilitiesApplication'},
    'jpg-to-pdf':       {'name': 'JPG to PDF',          'category': 'UtilitiesApplication'},
}

def get_meta(text: str, name: str) -> str | None:
    m = re.search(rf'<meta name="{name}" content="([^"]*)"', text)
    return m.group(1) if m else None

def get_title(text: str) -> str | None:
    m = re.search(r'<title>([^<]*)</title>', text)
    return m.group(1) if m else None

# Pulls the existing FAQPage JSON-LD out of the HTML and returns it as a
# parsed dict (with @type already set to FAQPage).
def parse_existing_faq(text: str) -> tuple[dict, re.Match] | None:
    pat = re.compile(
        r'<script type="application/ld\+json">(\{.*?\})</script>',
        re.DOTALL,
    )
    m = pat.search(text)
    if not m:
        return None
    try:
        obj = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        print(f'  !! could not parse JSON-LD: {e}', file=sys.stderr)
        return None
    if obj.get('@type') != 'FAQPage':
        # Already migrated to @graph, or some other shape; leave alone.
        return None
    return (obj, m)

def build_graph(slug: str, faq: dict, description: str, url: str) -> dict:
    meta = TOOLS[slug]
    name = meta['name']
    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'SoftwareApplication',
                'name': f'{name} - BrowserPDF',
                'description': description,
                'applicationCategory': meta['category'],
                'operatingSystem': 'Any (web browser)',
                'url': url,
                'offers': {
                    '@type': 'Offer',
                    'price': '0',
                    'priceCurrency': 'USD',
                },
                'featureList': [
                    '100% client-side: no file is ever uploaded',
                    'Free, no watermarks, no signup, no usage limits',
                    'Runs in the browser using JavaScript and WebAssembly',
                ],
            },
            {
                '@type': 'BreadcrumbList',
                'itemListElement': [
                    {
                        '@type': 'ListItem',
                        'position': 1,
                        'name': 'Home',
                        'item': 'https://browserpdf.app/',
                    },
                    {
                        '@type': 'ListItem',
                        'position': 2,
                        'name': name,
                        'item': url,
                    },
                ],
            },
            faq,
        ],
    }

def update_file(html_path: Path, slug: str) -> bool:
    text = html_path.read_text(encoding='utf-8')
    parsed = parse_existing_faq(text)
    if parsed is None:
        # Either no FAQPage JSON-LD, or already migrated to @graph. Check the
        # latter so we can be idempotent.
        already = re.search(
            r'<script type="application/ld\+json">\{"@context":"https://schema\.org","@graph":\['
            r'.*?"@type":"SoftwareApplication".*?"@type":"BreadcrumbList".*?\]\}</script>',
            text, re.DOTALL,
        )
        if already:
            print(f'  .. {html_path.name}: already has @graph')
            return False
        print(f'  !! {html_path.name}: no FAQPage JSON-LD to migrate', file=sys.stderr)
        return False

    faq_obj, match = parsed
    description = get_meta(text, 'description') or ''
    url = f'https://browserpdf.app/{slug}'
    graph = build_graph(slug, faq_obj, description, url)
    # Compact JSON, matching the existing single-line style.
    new_json = json.dumps(graph, separators=(',', ':'), ensure_ascii=False)
    new_block = f'<script type="application/ld+json">{new_json}</script>'

    new_text = text[:match.start()] + new_block + text[match.end():]
    if new_text == text:
        print(f'  .. {html_path.name}: no change')
        return False
    html_path.write_text(new_text, encoding='utf-8')
    print(f'  ok {html_path.name}')
    return True

def main() -> int:
    rc = 0
    for slug in TOOLS:
        html = SITE / f'{slug}.html'
        if not html.exists():
            print(f'  !! missing {html}', file=sys.stderr)
            rc = 1
            continue
        update_file(html, slug)
    return rc

if __name__ == '__main__':
    raise SystemExit(main())
