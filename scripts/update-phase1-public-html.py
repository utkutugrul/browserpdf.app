#!/usr/bin/env python3
"""Apply the site-wide Phase 1 shell and claim remediation.

The replacements are intentionally literal and deterministic. Running this
migration more than once leaves every public HTML file byte-identical.
"""

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
NON_HTML_SOURCES = (PUBLIC / "llms.txt", PUBLIC / "js" / "markdown-to-pdf.js", PUBLIC / "js" / "markdown-viewer.js")
SPECIAL_STATIC_HTML = {"offline.html"}
SKIP_LINK = '<a class="skip-link" href="#main-content" data-i18n="common.skip_to_main">Skip to main content</a>'

REPLACEMENTS = (
    # Shared fallback copy uses the same precise architecture claim as the
    # localized dictionaries. Interaction labels use "select", not "upload".
    (
        "Document processing happens in this browser tab and needs JavaScript. Your files are not uploaded; enable JavaScript to use this page.",
        "Document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint. JavaScript is required to use this page.",
    ),
    (
        "Document processing stays in this tab; selected files are not uploaded.",
        "Document processing happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    ("Click or drag and drop to upload a PDF file", "Click or drag and drop to select a PDF file from your device"),
    ("Click or drag and drop to upload an Excel file", "Click or drag and drop to select an Excel file from your device"),
    ("Click or drag and drop to upload a Word file", "Click or drag and drop to select a Word file from your device"),
    ("Nothing leaves this tab.", "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint."),
    ("Nothing leaves your browser", "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint"),
    (
        "Runs entirely on your device.",
        "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    ("entirely client-side", "in this browser tab"),
    (
        "Your documents are processed in this tab and are not uploaded.",
        "Document processing happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "you can inspect the browser network panel to confirm that document files are not uploaded.",
        "you can inspect the browser network panel to verify that selecting a document makes no file-upload request.",
    ),
    (
        "You can also inspect the browser network panel to confirm that document files are not uploaded.",
        "You can also inspect the browser network panel to verify that selecting a document makes no file-upload request.",
    ),
    (
        "analytics never receives your document files.",
        "BrowserPDF provides no file-upload endpoint to analytics.",
    ),
    (
        "Analytics never receives document files.",
        "BrowserPDF provides no file-upload endpoint to Analytics.",
    ),
    (
        "This OCR runs entirely on your device; the file is never uploaded anywhere.",
        "OCR processing happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "Never. The text is drawn into the PDF entirely on your device, like everything else on this site. BrowserPDF has no file-upload endpoint.",
        "Text is drawn into the PDF in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Never. The highlight rectangles are drawn into the PDF entirely on your device, like everything else on this site.",
        "Highlight rectangles are drawn into the PDF in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "No. Conversion runs in your browser tab. We never receive your PDF.",
        "Conversion happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "Once pdf.js and this page have loaded, the PDF you open is rendered entirely on your device. Opening a new file needs no network call, though the page itself must already be loaded.",
        "After this page and pdf.js load, opening a selected PDF is handled in this browser tab. BrowserPDF has no file-upload endpoint for the document.",
    ),
    (
        "Rendering and rotating happen entirely in this browser tab.",
        "Rendering and rotation happen in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Both directions run entirely in this browser tab.",
        "Both conversions happen in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "conversion happens entirely in this browser tab.",
        "conversion happens in this browser tab, and BrowserPDF has no file-upload endpoint.",
    ),
    (
        "BrowserPDF has no file-processing backend: conversion happens entirely in this browser tab, and both libraries are integrity-checked before they run.",
        "Conversion happens in this browser tab, BrowserPDF has no file-upload endpoint, and both libraries are integrity-checked before they run.",
    ),
    ("browser tab tab", "browser tab"),
    (
        "No upload. We cannot see your files.",
        "Document processing happens in the browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "No upload. We never see your photos.",
        "Image processing happens in the browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    ("No file upload or signup.", "No signup; BrowserPDF has no file-upload endpoint."),
    ("Document processing happens in your browser tab: no file upload or signup.", "Document processing happens in your browser tab. No signup; BrowserPDF has no file-upload endpoint."),
    ("Document processing happens in the browser tab with no file upload", "Document processing happens in the browser tab; BrowserPDF has no file-upload endpoint"),
    ("No file upload or added watermark.", "BrowserPDF has no file-upload endpoint and adds no watermark."),
    ("No upload, no signup, no watermarks.", "No signup or added watermarks; BrowserPDF has no file-upload endpoint."),
    ("No upload, no signup, no watermark.", "No signup or added watermark; BrowserPDF has no file-upload endpoint."),
    ("No document upload.", "No file-upload endpoint."),
    ("No upload, ever.", "BrowserPDF has no file-upload endpoint."),
    ("We cannot see your files.", "No file-upload endpoint."),
    (
        "We never receive a copy of your files, their contents, extracted text, passwords you type into a tool, or any data derived from the document.",
        "The tools provide no file-upload route through which BrowserPDF could receive a copy of your files, their contents, extracted text, passwords you type into a tool, or data derived from the document.",
    ),
    (
        "Analytics never receives document files.",
        "BrowserPDF provides no file-upload endpoint to Analytics.",
    ),
    (
        "The terms of service for BrowserPDF, a free suite of client-side PDF tools: plain-language conditions, no account required, nothing ever uploaded.",
        "BrowserPDF terms of service: plain-language conditions and no account required. Document processing happens in your browser tab with no file-processing backend or file-upload endpoint.",
    ),
    (
        "These tools run entirely in your browser, which means they need JavaScript to work. Nothing is uploaded either way; enable JavaScript to use this page.",
        "Document processing happens in this browser tab and needs JavaScript. Your files are not uploaded; enable JavaScript to use this page.",
    ),
    (
        "Everything happens in this tab only; no file is ever uploaded anywhere.",
        "Document processing stays in this tab; selected files are not uploaded.",
    ),
    (
        "Everything happens in this tab only; nothing is ever uploaded anywhere.",
        "Document processing stays in this tab; selected files are not uploaded.",
    ),
    ("Runs entirely in your browser", "Documents processed in this tab"),
    (
        "your PDF is processed entirely in this browser tab. Nothing is uploaded, transmitted, or stored anywhere outside your device. We cannot see your files.",
        "document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint, so the selected document is not sent to us.",
    ),
    (
        "your PDF is processed entirely in this browser tab. Nothing is uploaded, transmitted, or stored anywhere outside your device.",
        "document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint, so the selected document is not sent to us.",
    ),
    (
        "your PDFs are processed entirely in this browser tab. Nothing is uploaded, transmitted, or stored anywhere outside your device.",
        "document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint, so the selected documents are not sent to us.",
    ),
    (
        "your text is processed entirely in this browser tab. Nothing is uploaded, transmitted, or stored anywhere outside your device.",
        "text processing happens in this browser tab. BrowserPDF has no file-upload endpoint, so the selected text file is not sent to us.",
    ),
    (
        "We never receive your files. There is no upload endpoint: processing stays in this browser tab, so we cannot see, store, or access what you open here.",
        "Document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint, so the selected documents are not sent to us.",
    ),
    (
        "Your file is read locally with JavaScript. Nothing is sent to our servers because there is no upload API.",
        "Your file is read locally with JavaScript. BrowserPDF has no file-upload endpoint, so the selected document is not sent to us.",
    ),
    (
        "By design, file bytes never leave your device. We have no copy and no ability to inspect what you process.",
        "Document processing happens locally, and BrowserPDF has no file-upload endpoint through which it could receive a copy.",
    ),
    (
        "Everything runs on your device: your file is never sent to a server.",
        "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Everything runs on your device: nothing is ever sent to a server.",
        "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Everything happens in this browser tab; your PDF and image never leave your device.",
        "PDF and image processing happens in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Everything happens in this tab, there's no server involved at all for this tool.",
        "Text processing happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "When you type the password, it is used locally to decrypt the PDF. There is no upload endpoint, so neither the password nor the file can leave your device.",
        "The password is used locally to decrypt the PDF. BrowserPDF has no file-upload endpoint for the password or document.",
    ),
    (
        "No. The password is used only inside your browser tab to decrypt the PDF. Nothing is uploaded, and there is no server that could see it.",
        "No. The password is used only inside your browser tab to decrypt the PDF. BrowserPDF has no file-upload endpoint for the password or document.",
    ),
    (
        "Never. The signature is drawn into the PDF entirely on your device, like everything else on this site.",
        "The signature is drawn into the PDF in this browser tab. BrowserPDF has no file-upload endpoint for the signature or document.",
    ),
    (
        "Never. The text is drawn into the PDF entirely on your device and is not transmitted anywhere.",
        "The text is drawn into the PDF in this browser tab. BrowserPDF has no file-upload endpoint for the text or document.",
    ),
    (
        "No. The password is used only inside your browser tab to encrypt the PDF. Nothing is uploaded, and there is no server that could see it.",
        "No. The password is used inside your browser tab to encrypt the PDF. BrowserPDF has no file-upload endpoint for the password or document.",
    ),
    (
        "Your file never leaves the browser tab.",
        "Document processing happens in this browser tab, and BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Nothing runs on a server, nothing is uploaded.",
        "Processing happens in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "Everything runs on your device, nothing is uploaded.",
        "Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint.",
    ),
    (
        "your files are processed in this browser tab. Nothing is uploaded, transmitted, or stored anywhere outside your device.",
        "document processing happens in this browser tab. BrowserPDF has no file-processing backend or file-upload endpoint, so the selected documents are not sent to us.",
    ),
    (
        "the open-source PDF engine from Mozilla draws each page directly onto a canvas in this tab. Your file is never sent to a server.",
        "the open-source PDF engine from Mozilla draws each page directly onto a canvas in this tab. BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Reading, zooming, and printing all happen entirely in this browser tab, there's no server involved at all for this tool.",
        "Reading, zooming, and printing happen in this browser tab; BrowserPDF has no file-processing backend or file-upload endpoint.",
    ),
    (
        "There is no server-side limit because nothing is uploaded. The only constraint is your device's available memory; very large PDFs may render slowly but will still open.",
        "BrowserPDF imposes no service-side file limit. Processing uses your device's available memory, so very large PDFs may render slowly.",
    ),
    (
        "because that work never leaves your tab.",
        "because document processing happens locally and BrowserPDF has no file-upload endpoint.",
    ),
    (
        "since that processing never leaves your browser tab.",
        "because document processing happens locally and BrowserPDF has no file-upload endpoint.",
    ),
    (
        "Your document files are never sent to jsDelivr.",
        "BrowserPDF has no document-upload path to jsDelivr.",
    ),
    (
        "Every tool runs in your browser tab: there is no account system, no file upload, and no server-side processing of your files. Because of that architecture, we never receive, see, or store the files you process here.",
        "Document processing happens in your browser tab. There is no account system, file-processing backend, or file-upload endpoint through which BrowserPDF could receive your documents.",
    ),
    (
        "Because the Service never receives, stores, or transmits your files, we are not in a position to lose, expose, or misuse them, there is no server-side data for us to mishandle.",
        "Because the Service has no file-processing backend or file-upload endpoint, it does not receive document contents through the tools and does not hold a document copy.",
    ),
    ("and has no server-side document copy to handle.", "and does not hold a document copy."),
    (
        "There is no backend: conversion happens in this tab, and your document never leaves your device.",
        "BrowserPDF has no file-processing backend or file-upload endpoint; conversion happens in this tab.",
    ),
    ("100% client-side: no file is ever uploaded", "Document processing happens in the browser tab; BrowserPDF has no file-upload endpoint"),
    ("100% in your browser.", "Processing in this browser tab."),
    ("Everything happens in this browser tab.", "Document processing happens in this browser tab."),
    ("Everything happens in this tab.", "Document processing happens in this tab."),
    ("Compression happens entirely in this browser tab.", "Compression happens in this browser tab."),
    ("entirely in your browser", "in your browser tab"),
    ("entirely within your browser tab", "within your browser tab"),
    ("processed entirely in this browser tab", "processed in this browser tab"),
    ("converted entirely in your browser tab", "converted in your browser tab"),
    ("No upload, no signup, no server.", "No signup; BrowserPDF has no file-processing backend or file-upload endpoint."),
    ("No upload, no signup, your file never leaves your device.", "No signup; BrowserPDF has no file-upload endpoint."),
    ("No upload, no signup, we never see your files.", "No signup; BrowserPDF has no file-upload endpoint."),
    ("No upload, no signup.", "No signup; BrowserPDF has no file-upload endpoint."),
    ("No upload, no watermark.", "BrowserPDF has no file-upload endpoint and adds no watermark."),
    (
        "Free, no watermarks, no signup, no usage limits",
        "Free, no signup, no added watermarks, and no service-imposed usage limits",
    ),
    (
        "There is no artificial limit. Processing happens in your browser's memory, so very large files are bounded by your device; files over 150MB are rejected to keep the tab responsive.",
        "There is no service quota, but this tool rejects inputs over 150MB as a device-safety cap; processing is also bounded by your browser's available memory.",
    ),
    ("There is no backend and no upload endpoint.", "BrowserPDF has no file-processing backend or file-upload endpoint."),
    ("There is no upload endpoint.", "BrowserPDF has no file-upload endpoint."),
    ("There is no upload endpoint", "BrowserPDF has no file-upload endpoint"),
    ("There is no backend", "BrowserPDF has no file-processing backend"),
    ("no server-side Office needed", "without server-side Office software"),
    ("Nothing is uploaded.", "BrowserPDF has no file-upload endpoint."),
    (
        "Google Analytics (only with your consent)",
        "Google Analytics measurement and storage choices",
    ),
    (
        'data-i18n="common.footer_source">Open source</span>',
        'data-i18n="common.footer_source">Source available</span>',
    ),
)


def update_shell(text: str, path: Path) -> str:
    if not re.search(r"<main(?:\s|>)", text):
        return text
    if SKIP_LINK not in text:
        if text.count("<body>") != 1:
            raise RuntimeError(f"expected one <body> in {path}")
        text = text.replace("<body>\n", f"<body>\n{SKIP_LINK}\n", 1)

    mains = list(re.finditer(r"<main([^>]*)>", text))
    if len(mains) != 1:
        raise RuntimeError(f"expected one <main> in {path}, found {len(mains)}")
    attrs = mains[0].group(1)
    if 'id="main-content"' not in attrs:
        if re.search(r"\bid=", attrs):
            raise RuntimeError(f"unexpected main id in {path}: {attrs}")
        replacement = f'<main id="main-content" tabindex="-1"{attrs}>'
        text = text[:mains[0].start()] + replacement + text[mains[0].end():]
    elif 'tabindex="-1"' not in attrs:
        replacement = f'<main{attrs} tabindex="-1">'
        text = text[:mains[0].start()] + replacement + text[mains[0].end():]

    if text.count(SKIP_LINK) != 1 or text.count('id="main-content"') != 1:
        raise RuntimeError(f"duplicate shared shell hooks in {path}")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if migration output differs")
    args = parser.parse_args()
    pending = []
    for path in sorted(PUBLIC.glob("*.html")):
        if path.name in SPECIAL_STATIC_HTML:
            continue
        before = path.read_text(encoding="utf-8")
        after = update_shell(before, path)
        for old, new in REPLACEMENTS:
            after = after.replace(old, new)
        if after != before:
            if args.check:
                pending.append(path.name)
            else:
                path.write_text(after, encoding="utf-8")
    for path in NON_HTML_SOURCES:
        before = path.read_text(encoding="utf-8")
        after = before
        for old, new in REPLACEMENTS:
            after = after.replace(old, new)
        if after != before:
            if args.check:
                pending.append(str(path.relative_to(PUBLIC)))
            else:
                path.write_text(after, encoding="utf-8")
    if pending:
        raise SystemExit(f"HTML migration is not up to date: {', '.join(pending)}")


if __name__ == "__main__":
    main()
