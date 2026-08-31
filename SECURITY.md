# Security Policy

BrowserPDF has no backend and never uploads your files: every tool runs client-side, so there's no server holding user data to breach. The security surface that does exist is narrower: the strict CSP, the SHA-384 verification on pdf.js/Tesseract.js/pdf-lib before they execute (see `lib-loader.js`), and the client-side code itself (an XSS bug there could still be exploited against whoever loads the page, even with no data to steal).

## Reporting a vulnerability

Email **info@browserpdf.app** rather than opening a public issue. Include steps to reproduce and, if possible, a proof of concept. We'll acknowledge within a few days and follow up once a fix is deployed.

## In scope

- XSS in any tool page
- CSP bypass
- A way to defeat the hash verification in `lib-loader.js` (loading a tampered library)
- Anything that causes file contents to leave the browser tab

## Out of scope

- Vulnerabilities in pdf.js, Tesseract.js, or pdf-lib themselves, report those upstream
- Missing security headers on third-party domains (jsDelivr, Cloudflare) we don't control
