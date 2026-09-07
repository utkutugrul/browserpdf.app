'use strict';

import { t, onReady } from './i18n.js';
import { setupHomeWebMcp } from './webmcp.js';

const POPULAR_SLUGS = [
  'merge',
  'compress',
  'pdf-to-word',
  'split',
  'fill-sign',
  'jpg-to-pdf',
];

const input = document.getElementById('toolFilter');
const catalog = document.getElementById('toolCatalog');
const popularSection = document.getElementById('popularTools');
const popularGrid = document.getElementById('popularGrid');
const groups = Array.from(document.querySelectorAll('#toolGroups > section'));
const noResults = document.getElementById('noResults');
const clearBtn = document.getElementById('clearFilterBtn');
const resultCount = document.getElementById('toolResultCount');

function catalogCards() {
  return Array.from(document.querySelectorAll('#toolGroups .tool-card'));
}

function renderPopularTools() {
  if (!popularGrid) return;
  popularGrid.textContent = '';
  const cards = catalogCards();
  POPULAR_SLUGS.forEach((slug) => {
    const card = cards.find((candidate) => candidate.getAttribute('href') === slug);
    if (!card) return;
    const clone = card.cloneNode(true);
    clone.dataset.popularClone = 'true';
    popularGrid.appendChild(clone);
  });
}

function setCount(count, mode) {
  if (!resultCount) return;
  resultCount.textContent = mode === 'popular'
    ? t('hub.popular_count', '{n} popular tools', { n: count })
    : t('hub.result_count', '{n} tools found', { n: count });
}

function resetCatalogCards() {
  groups.forEach((group) => {
    group.hidden = false;
    group.querySelectorAll('.tool-card').forEach((card) => { card.hidden = false; });
  });
}

function filterTools() {
  if (!input) return;
  const locale = document.documentElement.lang || 'en';
  const query = input.value.trim().toLocaleLowerCase(locale);

  if (!query) {
    resetCatalogCards();
    if (popularSection) popularSection.hidden = false;
    if (noResults) noResults.hidden = true;
    setCount(catalog?.open ? catalogCards().length : POPULAR_SLUGS.length, catalog?.open ? 'results' : 'popular');
    return;
  }

  if (catalog) catalog.open = true;
  if (popularSection) popularSection.hidden = true;
  let totalVisible = 0;
  groups.forEach((group) => {
    let visibleInGroup = 0;
    group.querySelectorAll('.tool-card').forEach((card) => {
      const searchableText = [card.textContent, card.getAttribute('href')]
        .join(' ')
        .toLocaleLowerCase(locale);
      const matches = searchableText.includes(query);
      card.hidden = !matches;
      if (matches) visibleInGroup += 1;
    });
    group.hidden = visibleInGroup === 0;
    totalVisible += visibleInGroup;
  });
  if (noResults) noResults.hidden = totalVisible !== 0;
  setCount(totalVisible, 'results');
}

function clearSearch() {
  if (!input) return;
  input.value = '';
  if (catalog) catalog.open = false;
  filterTools();
  input.focus();
}

if (input) {
  renderPopularTools();
  input.addEventListener('input', filterTools);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      clearSearch();
    }
  });
  clearBtn?.addEventListener('click', clearSearch);
  catalog?.addEventListener('toggle', filterTools);
  onReady(() => {
    renderPopularTools();
    filterTools();
    setupHomeWebMcp();
  });
  filterTools();
}
