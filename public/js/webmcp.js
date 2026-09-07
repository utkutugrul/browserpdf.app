'use strict';

const MAX_QUERY_LENGTH = 80;
const MAX_TOOL_RESULTS = 10;
const MAX_MANAGED_FILES = 50;
const MAX_FILE_ID = 1_000_000;
const MAX_QUEUE_ID_LENGTH = 80;
const MAX_PRIVACY_COUNT = 100000;
const DOCTOR_FEATURE_KEYS = Object.freeze([
  'encrypted', 'locked', 'permissions', 'standardMetadata', 'xmp', 'catalogAttachments',
  'pageAttachments', 'annotations', 'linksAndActions', 'documentJavaScript',
  'pageJavaScript', 'forms', 'calculationOrder', 'signatureFields',
]);

function requireObject(input, allowedKeys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Input must be an object.');
  }
  const unknown = Object.keys(input).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`Unknown input property: ${unknown[0]}`);
}

function requireEmptyObject(input) {
  requireObject(input, []);
}

function boundedString(value, name, maxLength, { minLength = 0 } = {}) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new TypeError(`${name} must be a string between ${minLength} and ${maxLength} characters.`);
  }
  return value;
}

function boundedInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function safeText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function registerTools(tools, controller) {
  const modelContext = document.modelContext;
  for (const tool of tools) {
    // WebMCP Draft CG Report, 4 September 2026:
    // https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool
    // Registrations are owned by AbortSignal; the draft defines no unregister/update API.
    Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })).catch((error) => {
      if (!controller.signal.aborted) console.warn(`WebMCP registration failed for ${tool.name}:`, error);
    });
  }
}

function catalogEntries() {
  return Array.from(document.querySelectorAll('#toolGroups .tool-card')).map((card) => ({
    name: safeText(card.getAttribute('href')?.split('/').filter(Boolean).pop(), 64),
    title: safeText(card.querySelector('.tool-card-title')?.textContent, 80),
    description: safeText(card.querySelector('p')?.textContent, 180),
    href: card.getAttribute('href'),
  }));
}

export function createHomeTools() {
  const entries = catalogEntries();
  const names = entries.map((entry) => entry.name);
  return [
    {
      name: 'find-document-tools',
      title: 'Find document tools',
      description: 'Find BrowserPDF tools that match a short document task.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
          limit: { type: 'integer', minimum: 1, maximum: MAX_TOOL_RESULTS },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireObject(input, ['query', 'limit']);
        const query = boundedString(input.query, 'query', MAX_QUERY_LENGTH, { minLength: 1 }).trim().toLocaleLowerCase();
        const limit = input.limit === undefined ? 6 : boundedInteger(input.limit, 'limit', 1, MAX_TOOL_RESULTS);
        signal?.throwIfAborted();
        const matches = entries.filter((entry) =>
          `${entry.name} ${entry.title} ${entry.description}`.toLocaleLowerCase().includes(query));
        signal?.throwIfAborted();
        return {
          tools: matches.slice(0, limit).map(({ name, title, description }) => ({ name, title, description })),
          count: matches.length,
          truncated: matches.length > limit,
        };
      },
    },
    {
      name: 'open-document-tool',
      title: 'Open a document tool',
      description: 'Open one BrowserPDF tool by its catalog name.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', enum: names, maxLength: 64 } },
        required: ['name'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireObject(input, ['name']);
        const name = boundedString(input.name, 'name', 64, { minLength: 1 });
        const entry = entries.find((candidate) => candidate.name === name);
        if (!entry) throw new RangeError('Unknown document tool.');
        signal?.throwIfAborted();
        window.location.assign(entry.href);
        return { opened: name };
      },
    },
  ];
}

export function setupHomeWebMcp() {
  if (!document.modelContext?.registerTool) return { active: false, destroy() {} };
  const controller = new AbortController();
  registerTools(createHomeTools(), controller);
  const destroy = () => controller.abort();
  window.addEventListener('pagehide', destroy, { once: true });
  return { active: true, destroy };
}

function selectedFileMetadata(adapter) {
  return adapter.getSelectedFiles().slice(0, MAX_MANAGED_FILES).map((item, position) => ({
    id: item.id,
    name: safeText(item.name, 120),
    size: item.size,
    pageCount: item.pageCount,
    position: position + 1,
  }));
}

export function createMergeTools(adapter) {
  const files = selectedFileMetadata(adapter);
  const tools = [{
    name: 'get-selected-files',
    title: 'Get selected PDF files',
    description: 'List bounded metadata for PDF files selected on this Merge page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
    async execute(input, { signal } = {}) {
      requireEmptyObject(input);
      signal?.throwIfAborted();
      const current = selectedFileMetadata(adapter);
      return { files: current, count: adapter.getSelectedFiles().length, truncated: adapter.getSelectedFiles().length > current.length };
    },
  }];

  if (files.length > 0) {
    tools.push({
      name: 'set-file-order',
      title: 'Set PDF file order',
      description: 'Reorder the currently selected PDF files by their numeric IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          order: {
            type: 'array', minItems: 1, maxItems: MAX_MANAGED_FILES, uniqueItems: true,
            items: { type: 'integer', minimum: 0, maximum: MAX_FILE_ID },
          },
        },
        required: ['order'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireObject(input, ['order']);
        if (!Array.isArray(input.order) || input.order.length < 1 || input.order.length > MAX_MANAGED_FILES) {
          throw new TypeError(`order must contain between 1 and ${MAX_MANAGED_FILES} IDs.`);
        }
        const order = input.order.map((id) => boundedInteger(id, 'order ID', 0, MAX_FILE_ID));
        if (new Set(order).size !== order.length) throw new TypeError('order IDs must be unique.');
        signal?.throwIfAborted();
        adapter.setFileOrder(order);
        return { files: selectedFileMetadata(adapter), count: order.length };
      },
    }, {
      name: 'remove-selected-file',
      title: 'Remove a selected PDF file',
      description: 'Remove one selected PDF file from this Merge page by numeric ID.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'integer', minimum: 0, maximum: MAX_FILE_ID } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireObject(input, ['id']);
        const id = boundedInteger(input.id, 'id', 0, MAX_FILE_ID);
        signal?.throwIfAborted();
        adapter.removeSelectedFile(id);
        return { removed: id, files: selectedFileMetadata(adapter) };
      },
    });
  }

  if (files.length >= 2 && adapter.canMerge?.() !== false) {
    tools.push({
      name: 'merge-selected-files',
      title: 'Merge selected PDF files',
      description: 'Prepare one merged PDF from the selected files without starting a download.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireEmptyObject(input);
        signal?.throwIfAborted();
        return adapter.mergeSelectedFiles({ signal, autoDownload: false });
      },
    });
  }
  return tools;
}

export function setupMergeWebMcp(adapter) {
  if (!document.modelContext?.registerTool) return { active: false, refresh() {}, destroy() {} };
  let controller = null;
  let signature = '';

  function refresh() {
    const tools = createMergeTools(adapter);
    const nextSignature = tools.map((tool) => tool.name).join('|');
    if (nextSignature === signature) return;
    controller?.abort();
    controller = new AbortController();
    signature = nextSignature;
    registerTools(tools, controller);
  }

  function destroy() {
    controller?.abort();
    signature = '';
  }

  window.addEventListener('pagehide', destroy, { once: true });
  refresh();
  return { active: true, refresh, destroy };
}

const WORKFLOW_RECOMMENDATIONS = Object.freeze({
  'smaller-shareable-secure': 'compress-watermark-protect-v1',
  'reorder-and-number': 'organize-page-numbers-v1',
  'remove-standard-metadata': 'privacy-scan-cleanup-v1',
});

function workflowQueueMetadata(adapter) {
  return adapter.getQueueState().slice(0, MAX_MANAGED_FILES).map((item) => ({
    id: safeText(item.id, MAX_QUEUE_ID_LENGTH),
    name: safeText(item.name, 120),
    status: item.status,
    step: item.step,
    outputName: item.outputName ? safeText(item.outputName, 140) : '',
    error: item.error ? safeText(item.error, 160) : '',
  }));
}

export function createWorkflowTools(adapter) {
  const queue = workflowQueueMetadata(adapter);
  const tools = [{
    name: 'recommend-document-workflow',
    title: 'Recommend a document workflow',
    description: 'Recommend one bounded BrowserPDF starter recipe from a document goal. This does not select files or run a workflow.',
    inputSchema: {
      type: 'object',
      properties: { goal: { type: 'string', enum: Object.keys(WORKFLOW_RECOMMENDATIONS), maxLength: 32 } },
      required: ['goal'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    async execute(input, { signal } = {}) {
      requireObject(input, ['goal']);
      const goal = boundedString(input.goal, 'goal', 32, { minLength: 1 });
      const recipeId = WORKFLOW_RECOMMENDATIONS[goal];
      if (!recipeId) throw new RangeError('Unknown workflow goal.');
      signal?.throwIfAborted();
      return adapter.recommend(recipeId);
    },
  }];

  if (queue.length) {
    tools.push({
      name: 'get-workflow-queue-status', title: 'Get workflow queue status',
      description: 'Get bounded metadata-only status for files already selected on this page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireEmptyObject(input); signal?.throwIfAborted();
        const current = workflowQueueMetadata(adapter);
        return { items: current, count: adapter.getQueueState().length, truncated: adapter.getQueueState().length > current.length };
      },
    });
  }
  if (queue.some((item) => item.status === 'queued' || item.status === 'running')) {
    tools.push({
      name: 'cancel-workflow-queue', title: 'Cancel workflow queue',
      description: 'Stop this page queue between files or workflow steps. Completed outputs remain available.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) { requireEmptyObject(input); signal?.throwIfAborted(); adapter.cancel(); return { canceled: true }; },
    });
  }
  const retryIds = queue.filter((item) => item.status === 'error' || item.status === 'canceled').map((item) => item.id);
  if (retryIds.length) {
    tools.push({
      name: 'retry-workflow-file', title: 'Retry workflow file',
      description: 'Queue one failed or canceled file again by its page-local ID.',
      inputSchema: {
        type: 'object', properties: { id: { type: 'string', enum: retryIds, minLength: 1, maxLength: MAX_QUEUE_ID_LENGTH } },
        required: ['id'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      async execute(input, { signal } = {}) {
        requireObject(input, ['id']);
        const id = boundedString(input.id, 'id', MAX_QUEUE_ID_LENGTH, { minLength: 1 });
        signal?.throwIfAborted();
        if (!retryIds.includes(id) || !adapter.retry(id)) throw new RangeError('File is not retryable.');
        return { queued: id };
      },
    });
  }
  return tools;
}

export function setupWorkflowWebMcp(adapter) {
  if (!document.modelContext?.registerTool) return { active: false, refresh() {}, destroy() {} };
  let controller = null;
  let signature = '';
  function refresh() {
    const tools = createWorkflowTools(adapter);
    const next = tools.map((tool) => `${tool.name}:${JSON.stringify(tool.inputSchema)}`).join('|');
    if (next === signature) return;
    controller?.abort();
    controller = new AbortController();
    signature = next;
    registerTools(tools, controller);
  }
  function destroy() { controller?.abort(); signature = ''; }
  window.addEventListener('pagehide', destroy, { once: true });
  refresh();
  return { active: true, refresh, destroy };
}

const PRIVACY_COUNT_KEYS = Object.freeze([
  'standardMetadata', 'xmp', 'catalogAttachments', 'pageAttachments', 'annotations',
  'linksAndActions', 'documentJavaScript', 'pageJavaScript', 'forms', 'calculationOrder',
  'signatureFields', 'invisibleTextOperations', 'sensitivePatterns',
]);

function privacySummaryMetadata(value) {
  const counts = {};
  for (const key of PRIVACY_COUNT_KEYS) {
    const count = value?.counts?.[key];
    counts[key] = Number.isInteger(count) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, count)) : 0;
  }
  const sensitiveCategories = {};
  for (const [key, count] of Object.entries(value?.sensitiveCategories || {}).slice(0, 10)) {
    sensitiveCategories[safeText(key, 32)] = Number.isInteger(count) ? Math.max(0, Math.min(100, count)) : 0;
  }
  return {
    version: Number.isInteger(value?.version) ? value.version : 1,
    pageCount: Number.isInteger(value?.pageCount) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, value.pageCount)) : 0,
    encrypted: Boolean(value?.encrypted), locked: Boolean(value?.locked), counts,
    sensitiveCategories, truncated: Boolean(value?.truncated),
    warningCount: Number.isInteger(value?.warningCount) ? Math.max(0, Math.min(20, value.warningCount)) : 0,
  };
}

export function createPrivacyScanTools(adapter) {
  if (!adapter.getSelectedFile()) return [];
  return [{
    name: 'scan-selected-document-privacy',
    title: 'Scan the selected document for detectable privacy risks',
    description: 'Run the bounded, inert BrowserPDF privacy inspection on the PDF already selected on this page. Returns summary counts only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
    async execute(input, { signal } = {}) {
      requireEmptyObject(input);
      signal?.throwIfAborted();
      const summary = await adapter.scanSelected({ signal });
      signal?.throwIfAborted();
      return privacySummaryMetadata(summary);
    },
  }];
}

export function setupPrivacyScanWebMcp(adapter) {
  if (!document.modelContext?.registerTool) return { active: false, refresh() {}, destroy() {} };
  let controller = null;
  let signature = '';
  function refresh() {
    const tools = createPrivacyScanTools(adapter);
    const next = tools.map((tool) => tool.name).join('|');
    if (next === signature) return;
    controller?.abort();
    controller = new AbortController();
    signature = next;
    registerTools(tools, controller);
  }
  function destroy() { controller?.abort(); signature = ''; }
  window.addEventListener('pagehide', destroy, { once: true });
  refresh();
  return { active: true, refresh, destroy };
}

function doctorSummaryMetadata(value) {
  const features = {};
  for (const key of DOCTOR_FEATURE_KEYS) {
    const entry = value?.features?.[key];
    features[key] = typeof entry === 'boolean'
      ? entry
      : Number.isInteger(entry) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, entry)) : 0;
  }
  const readiness = {};
  for (const key of ['structureTreePresent', 'markInfoMarked', 'languagePresent', 'titlePresent', 'graphTruncated']) {
    readiness[key] = Boolean(value?.readiness?.[key]);
  }
  for (const key of ['figureCount', 'figuresWithAlt', 'figuresMissingAlt']) {
    const entry = value?.readiness?.[key];
    readiness[key] = Number.isInteger(entry) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, entry)) : 0;
  }
  return {
    version: Number.isInteger(value?.version) ? value.version : 1,
    mode: value?.mode === 'deep' ? 'deep' : 'quick',
    pageCount: Number.isInteger(value?.pageCount) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, value.pageCount)) : 0,
    parses: {
      pdfLibStrict: Boolean(value?.parses?.pdfLibStrict),
      pdfLibTolerant: Boolean(value?.parses?.pdfLibTolerant),
      pdfjsStrict: Boolean(value?.parses?.pdfjsStrict),
    },
    pageTreeConsistent: Boolean(value?.pageTreeConsistent),
    pageBoxIssues: Number.isInteger(value?.pageBoxIssues) ? Math.max(0, Math.min(100, value.pageBoxIssues)) : 0,
    features,
    readiness,
    deep: {
      performed: Boolean(value?.deep?.performed),
      pagesChecked: Number.isInteger(value?.deep?.pagesChecked) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, value.deep.pagesChecked)) : 0,
      operatorErrors: Number.isInteger(value?.deep?.operatorErrors) ? Math.max(0, Math.min(100, value.deep.operatorErrors)) : 0,
      textErrors: Number.isInteger(value?.deep?.textErrors) ? Math.max(0, Math.min(100, value.deep.textErrors)) : 0,
      renderErrors: Number.isInteger(value?.deep?.renderErrors) ? Math.max(0, Math.min(100, value.deep.renderErrors)) : 0,
    },
    inspectionErrors: {
      count: Number.isInteger(value?.inspectionErrors?.count) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, value.inspectionErrors.count)) : 0,
      categories: Array.isArray(value?.inspectionErrors?.categories)
        ? value.inspectionErrors.categories.slice(0, 30).map((category) => safeText(category, 48)) : [],
      truncated: Boolean(value?.inspectionErrors?.truncated),
    },
    warningCount: Number.isInteger(value?.warningCount) ? Math.max(0, Math.min(20, value.warningCount)) : 0,
  };
}

function doctorOutputMetadata(value, action) {
  return {
    action,
    ready: Boolean(value?.ready),
    name: safeText(value?.name, 140),
    size: Number.isInteger(value?.size) ? Math.max(0, Math.min(1_000_000_000, value.size)) : 0,
    pageCount: Number.isInteger(value?.pageCount) ? Math.max(0, Math.min(MAX_PRIVACY_COUNT, value.pageCount)) : 0,
    verified: Boolean(value?.verified),
    lossItemCount: Number.isInteger(value?.lossItemCount) ? Math.max(0, Math.min(30, value.lossItemCount)) : 0,
  };
}

export function createDocumentDoctorTools(adapter) {
  if (!adapter.getSelectedFile()) return [];
  const state = adapter.getState?.() || {};
  const tools = [{
    name: 'diagnose-document',
    title: 'Diagnose selected PDF structure',
    description: 'Run a bounded quick or deep parser and rendering-readiness diagnosis on the PDF selected on this page.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['quick', 'deep'], maxLength: 5 } },
      required: ['mode'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
    async execute(input, { signal } = {}) {
      requireObject(input, ['mode']);
      const mode = boundedString(input.mode, 'mode', 5, { minLength: 4 });
      if (!['quick', 'deep'].includes(mode)) throw new RangeError('mode must be quick or deep.');
      signal?.throwIfAborted();
      return doctorSummaryMetadata(await adapter.diagnose({ mode, signal }));
    },
  }];
  if (state.canNormalize) tools.push({
    name: 'normalize-document-structure',
    title: 'Normalize selected PDF structure',
    description: 'Prepare a newly serialized PDF in page memory after strict reopen and render verification. Does not download it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
    async execute(input, { signal } = {}) {
      requireEmptyObject(input); signal?.throwIfAborted();
      return doctorOutputMetadata(await adapter.normalize({ signal }), 'normalize-structure');
    },
  });
  if (state.canRebuild) tools.push({
    name: 'rebuild-document-page-content',
    title: 'Rebuild selected PDF page content',
    description: 'Prepare a lossy image-only PDF in page memory after strict reopen and render verification. Does not download it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
    async execute(input, { signal } = {}) {
      requireEmptyObject(input); signal?.throwIfAborted();
      return doctorOutputMetadata(await adapter.rebuild({ signal }), 'rebuild-page-content');
    },
  });
  return tools;
}

export function setupDocumentDoctorWebMcp(adapter) {
  if (!document.modelContext?.registerTool) return { active: false, refresh() {}, destroy() {} };
  let controller = null;
  let signature = '';
  function refresh() {
    const tools = createDocumentDoctorTools(adapter);
    const next = tools.map((tool) => `${tool.name}:${JSON.stringify(tool.inputSchema)}`).join('|');
    if (next === signature) return;
    controller?.abort();
    controller = new AbortController();
    signature = next;
    registerTools(tools, controller);
  }
  function destroy() { controller?.abort(); signature = ''; }
  window.addEventListener('pagehide', destroy, { once: true });
  refresh();
  return { active: true, refresh, destroy };
}
