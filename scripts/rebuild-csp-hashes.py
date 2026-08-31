#!/usr/bin/env python3
"""Rebuild the CSP script-src hash list in worker.js from the actual inline
<script> tags found in every HTML file in the repo.

Why: each page's JSON-LD inline script (and the theme-toggle bootstrap)
needs its SHA-256 in the CSP, or the browser silently refuses to run it.
After editing any inline script, re-run this script and redeploy.

Reads:   worker.js, *.html
Writes:  worker.js (in place)
Idempotent: re-running produces the same output.
"""
import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'public'  # deploy edilen site koku
WORKER = SITE / 'worker.js'

SCRIPT_RE = re.compile(r'<script(?:\s[^>]*)?>(.*?)</script>', re.DOTALL)

def collect_hashes() -> list[str]:
    """Return sorted list of unique sha256-<b64> hashes for every inline
    <script> (no src=) that can end up in a served HTML response.

    Two sources:
      1. Static <script> tags inside every *.html file at the repo root.
      2. Inline scripts that worker.js dynamically injects into pages via
         HTMLRewriter (CONSENT_DEFAULT_SCRIPT). These are not visible in the
         HTML files but the browser still sees them as inline scripts and
         requires their hashes in script-src.
    """
    seen = set()

    # (1) Static HTML inline scripts.
    for html in sorted(SITE.glob('*.html')):
        text = html.read_text(encoding='utf-8')
        for m in SCRIPT_RE.finditer(text):
            tag = m.group(0)
            body = m.group(1)
            if re.search(r'\ssrc\s*=', tag):
                continue
            if not body.strip():
                continue
            h = hashlib.sha256(body.encode('utf-8')).digest()
            b64 = base64.b64encode(h).decode('ascii')
            seen.add(f"'sha256-{b64}'")

    # (2) Inline scripts injected by worker.js. Pull each `<script>...</script>`
    # template literal out of worker.js and hash its inner body the same way
    # the browser will: the text between the <script> and </script> tags.
    worker = (SITE / 'worker.js').read_text(encoding='utf-8')
    # Find every backtick string containing a <script> tag.
    for m in re.finditer(r'`([^`]*<script[^>]*>[^<]*</script>[^`]*)`', worker):
        template = m.group(1)
        # The template may contain ${...} interpolations (e.g. buildHreflang);
        # those produce different content per request and can't be hashed
        # statically. Skip any template with ${...} in it; those are handled
        # by the HTMLRewriter at runtime and would need a different strategy
        # (nonce or 'unsafe-inline' under a separate CSP scope).
        if '${' in template:
            continue
        # Pull every <script>...</script> body out of the template.
        for sm in re.finditer(r'<script(?:\s[^>]*)?>(.*?)</script>', template, re.DOTALL):
            body = sm.group(1)
            if not body.strip():
                continue
            h = hashlib.sha256(body.encode('utf-8')).digest()
            b64 = base64.b64encode(h).decode('ascii')
            seen.add(f"'sha256-{b64}'")

    return sorted(seen)

def rebuild_csp(hashes: list[str]) -> str:
    """Return the new HTML_CSP string with the updated script-src hash list."""
    # Pull the existing HTML_CSP from worker.js to preserve the rest of the policy.
    worker = WORKER.read_text(encoding='utf-8')
    # The script-src line is the only one with sha256- entries. Replace every
    # 'sha256-...' token in it with our fresh list.
    script_src_line = re.search(r'"script-src[^"]*"', worker)
    if not script_src_line:
        raise SystemExit('could not find script-src in worker.js')
    old_line = script_src_line.group(0)
    # Build the new script-src line. Keep the leading sources, then append hashes.
    # The leading sources include GA/Cloudflare domains that are manually maintained
    # (not derived from HTML scanning). The hash list is auto-generated.
    new_line = (
        '"script-src \'self\' blob: https://cdn.jsdelivr.net '
        'https://www.googletagmanager.com https://static.cloudflareinsights.com '
        '\'wasm-unsafe-eval\' '
        + ' '.join(hashes)
        + '"'
    )
    return worker.replace(old_line, new_line)

def main() -> int:
    hashes = collect_hashes()
    print(f'Found {len(hashes)} unique inline script hashes.')
    new_worker = rebuild_csp(hashes)
    if new_worker == WORKER.read_text(encoding='utf-8'):
        print('worker.js already up to date.')
        return 0
    WORKER.write_text(new_worker, encoding='utf-8')
    print(f'Updated worker.js with {len(hashes)} script-src hashes.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
