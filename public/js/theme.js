'use strict';

// The saved theme is applied by a tiny inline script in each page's <head>
// (hash-allowed in CSP) so the first paint is already correct; this file
// only wires the header toggle and can load deferred, off the critical path.

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const current =
    document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pdf2md-theme', next);
});
