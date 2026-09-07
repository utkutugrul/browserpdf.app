'use strict';

export class LocalBatchQueue {
  constructor({ process, concurrency = 1, onChange = () => {} }) {
    if (concurrency !== 1) throw new RangeError('PDF workflows are limited to concurrency 1.');
    this.process = process;
    this.concurrency = concurrency;
    this.onChange = onChange;
    this.items = [];
    this.usedNames = new Set();
    this.running = false;
    this.runGeneration = 0;
  }

  add(entries) {
    for (const entry of entries) {
      const outputName = entry.outputName || allocateOutputName(entry.name, entry.recipeId || 'workflow-v1', this.usedNames);
      this.items.push({ ...entry, outputName, status: 'queued', step: 0, error: '', output: null, report: null });
    }
    this.onChange(this.snapshot());
  }

  restore(entries) {
    for (const entry of entries) {
      const outputName = entry.outputName || allocateOutputName(entry.name, entry.recipeId || 'workflow-v1', this.usedNames);
      this.usedNames.add(outputName.toLocaleLowerCase('en-US'));
      this.items.push({ step: 0, error: '', output: null, report: null, ...entry, outputName });
    }
    this.onChange(this.snapshot());
  }

  snapshot() {
    return this.items.map(({ bytes, output, ...item }) => ({
      ...item, size: bytes?.length || item.size || 0, outputSize: output?.length || 0,
    }));
  }

  cancel() {
    this.runGeneration++;
    for (const item of this.items) if (item.status === 'queued') item.status = 'canceled';
    this.onChange(this.snapshot());
  }

  retry(id) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || !['error', 'canceled'].includes(item.status)) return false;
    item.status = 'queued'; item.error = ''; item.step = 0; item.output = null;
    this.onChange(this.snapshot());
    return true;
  }

  async run(context = {}) {
    if (this.running) return;
    this.running = true;
    const generation = ++this.runGeneration;
    const isCancelled = () => generation !== this.runGeneration;
    try {
      while (!isCancelled()) {
        const item = this.items.find((candidate) => candidate.status === 'queued');
        if (!item) break;
        item.status = 'running';
        this.onChange(this.snapshot());
        try {
          const result = await this.process(item, {
            ...context,
            isCancelled,
            onStep: (step) => { item.step = step; this.onChange(this.snapshot()); },
          });
          if (isCancelled()) {
            item.status = 'canceled';
          } else {
            item.output = result.bytes;
            item.outputName = item.outputName || result.name;
            item.report = result.report || null;
            item.status = 'success';
          }
        } catch (error) {
          item.status = isCancelled() || error?.name === 'AbortError' ? 'canceled' : 'error';
          item.error = error?.message || 'Workflow failed.';
        }
        this.onChange(this.snapshot());
      }
    } finally {
      this.running = false;
      this.onChange(this.snapshot());
    }
  }
}

export function deterministicOutputName(inputName, recipeId) {
  const base = String(inputName || 'document').replace(/\.pdf$/i, '') || 'document';
  const suffix = recipeId.replace(/-v\d+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${base}-${suffix}.pdf`;
}

export function allocateOutputName(inputName, recipeId, usedNames) {
  const proposed = deterministicOutputName(inputName, recipeId);
  const lower = proposed.toLocaleLowerCase('en-US');
  if (!usedNames.has(lower)) {
    usedNames.add(lower);
    return proposed;
  }
  const stem = proposed.replace(/\.pdf$/i, '');
  let counter = 2;
  while (usedNames.has(`${stem}-${counter}.pdf`.toLocaleLowerCase('en-US'))) counter++;
  const allocated = `${stem}-${counter}.pdf`;
  usedNames.add(allocated.toLocaleLowerCase('en-US'));
  return allocated;
}
