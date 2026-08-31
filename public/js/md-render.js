'use strict';

// XSS-safe markdown renderer shared by every tool that displays Markdown.
// Every piece of untrusted text reaches the DOM only via textContent /
// createTextNode, never innerHTML, so text containing literal "<script>"
// or "<img onerror=...>" renders as inert glyphs, not markup.

export function appendInline(parent, text) {
  const tokenRe = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    let el;
    if (token.startsWith('***')) {
      el = document.createElement('strong');
      const em = document.createElement('em');
      em.textContent = token.slice(3, -3);
      el.appendChild(em);
    } else if (token.startsWith('**')) {
      el = document.createElement('strong');
      el.textContent = token.slice(2, -2);
    } else if (token.startsWith('`')) {
      el = document.createElement('code');
      el.textContent = token.slice(1, -1);
    } else {
      el = document.createElement('em');
      el.textContent = token.slice(1, -1);
    }
    parent.appendChild(el);
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

export function renderMarkdownPreview(markdown, container) {
  container.textContent = '';
  const lines = markdown.split('\n');
  let i = 0;
  let listEl = null;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      listEl = null;
      i++;
      continue;
    }

    if (/^-{3,}\s*$/.test(line.trim())) {
      container.appendChild(document.createElement('hr'));
      listEl = null;
      i++;
      continue;
    }

    if (/^\*\(Page scanned via OCR\)\*$/.test(line.trim())) {
      const p = document.createElement('p');
      p.className = 'ocr-note';
      p.textContent = 'Page scanned via OCR';
      container.appendChild(p);
      listEl = null;
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const h = document.createElement(`h${headingMatch[1].length}`);
      appendInline(h, headingMatch[2]);
      container.appendChild(h);
      listEl = null;
      i++;
      continue;
    }

    const bulletMatch = line.match(/^-\s+(.*)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (bulletMatch || orderedMatch) {
      const tag = orderedMatch ? 'ol' : 'ul';
      if (!listEl || listEl.tagName.toLowerCase() !== tag) {
        listEl = document.createElement(tag);
        container.appendChild(listEl);
      }
      const li = document.createElement('li');
      appendInline(li, (bulletMatch || orderedMatch)[1]);
      listEl.appendChild(li);
      i++;
      continue;
    }

    listEl = null;
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^-{3,}\s*$/.test(lines[i].trim()) &&
      !/^-\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    appendInline(p, paraLines.join(' '));
    container.appendChild(p);
  }
}
