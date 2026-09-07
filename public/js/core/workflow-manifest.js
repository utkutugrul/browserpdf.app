'use strict';

export const WORKFLOW_MANIFEST_VERSION = 1;
export const PDF_MIME = 'application/pdf';

const strictObject = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});

export const WORKFLOW_STEPS = Object.freeze([
  {
    id: 'compress-raster-v1', title: 'Compress', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({ quality: { type: 'number', minimum: 0.45, maximum: 0.9 } }),
    defaults: { quality: 0.72 },
    loss: 'Lossy: pages are rasterized. Searchable text, links, forms, annotations, and vector detail are flattened.',
    privacy: 'Page pixels stay in this browser tab; no document data is uploaded.',
  },
  {
    id: 'watermark-text-v1', title: 'Watermark', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({ text: { type: 'string', minLength: 1, maxLength: 40 }, opacity: { type: 'number', minimum: 0.05, maximum: 0.8 } }, ['text']),
    defaults: { text: 'CONFIDENTIAL', opacity: 0.22 },
    loss: 'Non-destructive visually, but adds permanent visible text to every page.',
    privacy: 'The watermark and document stay in this browser tab.',
  },
  {
    id: 'protect-password-v1', title: 'Protect', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({ password: { type: 'string', minLength: 4, maxLength: 128 } }, ['password']),
    defaults: { password: '' },
    loss: 'Password encryption changes the file. Losing the password can make the output inaccessible.',
    privacy: 'The password is used only in memory and is never persisted in the workflow store.',
  },
  {
    id: 'organize-pages-v1', title: 'Organize pages', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({ order: { type: 'string', enum: ['keep', 'reverse'] } }),
    defaults: { order: 'reverse' },
    loss: 'Reordering changes reading order. This starter supports keeping or reversing all pages; it does not delete pages.',
    privacy: 'Document pages stay in this browser tab.',
  },
  {
    id: 'page-numbers-v1', title: 'Page numbers', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({ start: { type: 'integer', minimum: 1, maximum: 100000 }, position: { type: 'string', enum: ['bottom-center', 'bottom-right'] } }),
    defaults: { start: 1, position: 'bottom-center' },
    loss: 'Adds permanent visible numbering to every page.',
    privacy: 'Document pages stay in this browser tab.',
  },
  {
    id: 'privacy-metadata-scan-v1', title: 'Privacy metadata scan', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({}), defaults: {},
    loss: 'Read-only. Scans only standard PDF document-info fields; it does not inspect hidden content, attachments, JavaScript, or image pixels.',
    privacy: 'Findings remain in this browser tab and in the local workflow record until expiry.',
  },
  {
    id: 'metadata-cleanup-v1', title: 'Metadata cleanup', accepts: [PDF_MIME], produces: [PDF_MIME],
    parameterSchema: strictObject({}), defaults: {},
    loss: 'Clears standard title, author, subject, keywords, creator, producer, and document dates only. It is not a full forensic sanitizer.',
    privacy: 'The cleaned document stays in this browser tab.',
  },
]);

export const STARTER_RECIPES = Object.freeze([
  {
    id: 'compress-watermark-protect-v1', title: 'Compress, watermark & protect',
    description: 'Raster-compress each PDF, add a visible watermark, then require a password to open the result.',
    stepIds: ['compress-raster-v1', 'watermark-text-v1', 'protect-password-v1'],
  },
  {
    id: 'organize-page-numbers-v1', title: 'Organize & number pages',
    description: 'Reverse or retain the complete page order, then stamp page numbers.',
    stepIds: ['organize-pages-v1', 'page-numbers-v1'],
  },
  {
    id: 'privacy-scan-cleanup-v1', title: 'Scan & clean standard metadata',
    description: 'Report standard document-info metadata, then clear those fields from a new PDF.',
    stepIds: ['privacy-metadata-scan-v1', 'metadata-cleanup-v1'],
  },
]);

export const WORKFLOW_MANIFEST = Object.freeze({
  schemaVersion: WORKFLOW_MANIFEST_VERSION,
  mimeTypes: [PDF_MIME],
  steps: WORKFLOW_STEPS,
  recipes: STARTER_RECIPES,
});

export function getWorkflowStep(stepId) {
  return WORKFLOW_STEPS.find((step) => step.id === stepId) || null;
}

export function getStarterRecipe(recipeId) {
  return STARTER_RECIPES.find((recipe) => recipe.id === recipeId) || null;
}

export function materializeRecipe(recipeId) {
  const recipe = getStarterRecipe(recipeId);
  if (!recipe) throw new RangeError('Unknown workflow recipe.');
  return recipe.stepIds.map((id) => {
    const definition = getWorkflowStep(id);
    return { id, parameters: { ...definition.defaults } };
  });
}
