#!/usr/bin/env python3
"""Add new tool URLs to sitemap.xml for all 22 languages.

Each tool gets 22 <url> entries (en + 21 translated languages), each with
hreflang alternates linking to all other language versions, matching the
pattern of existing tool entries in sitemap.xml.

Usage:
  python3 scripts/add-to-sitemap.py pdf-to-markdown merge split
  python3 scripts/add-to-sitemap.py edit-metadata add-image add-text redact highlight view-pdf
"""
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku
SITEMAP = SITE / 'sitemap.xml'

ALL_LANGS = ['en','es','fr','de','pt','it','ru','ja','ko','zh','zh-TW',
             'ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv']

def build_url_entry(slug: str, lang: str, today: str) -> str:
    """Build one <url> element for a given tool slug and language."""
    if lang == 'en':
        loc = f'https://browserpdf.app/{slug}'
    else:
        loc = f'https://browserpdf.app/{lang}/{slug}'

    lines = [
        '  <url>',
        f'    <loc>{loc}</loc>',
        f'    <lastmod>{today}</lastmod>',
        '    <changefreq>monthly</changefreq>',
        '    <priority>0.8</priority>',
    ]
    for alt_lang in ALL_LANGS:
        if alt_lang == 'en':
            alt_href = f'https://browserpdf.app/{slug}'
        else:
            alt_href = f'https://browserpdf.app/{alt_lang}/{slug}'
        lines.append(f'    <xhtml:link rel="alternate" hreflang="{alt_lang}" href="{alt_href}"/>')
    lines.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="https://browserpdf.app/{slug}"/>')
    lines.append('  </url>')
    return '\n'.join(lines)

def main() -> int:
    slugs = sys.argv[1:]
    if not slugs:
        print('Usage: add-to-sitemap.py SLUG1 SLUG2 ...', file=sys.stderr)
        return 1

    today = date.today().isoformat()
    content = SITEMAP.read_text(encoding='utf-8')

    # Check which slugs are already present to avoid duplicates.
    new_entries = []
    for slug in slugs:
        # Check if the English URL already exists.
        check_url = f'https://browserpdf.app/{slug}</loc>'
        if check_url in content:
            print(f'  .. {slug}: already in sitemap, skipping')
            continue
        for lang in ALL_LANGS:
            new_entries.append(build_url_entry(slug, lang, today))
        print(f'  ok {slug}: added {len(ALL_LANGS)} URL entries')

    if not new_entries:
        print('Nothing to add.')
        return 0

    # Insert before </urlset>
    insert_point = content.rfind('</urlset>')
    if insert_point == -1:
        print('Could not find </urlset> in sitemap.xml', file=sys.stderr)
        return 1

    new_content = content[:insert_point] + '\n'.join(new_entries) + '\n' + content[insert_point:]
    SITEMAP.write_text(new_content, encoding='utf-8')
    print(f'Added {len(new_entries)} URL entries to sitemap.xml')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
