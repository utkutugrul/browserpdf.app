// Lightweight admission policy; image codecs and work queues load on intent.
export const IMAGE_INTAKE_LIMITS = Object.freeze({ entries: 48, pending: 16, fileBytes: 16 * 1024 * 1024, rawBytes: 48 * 1024 * 1024, normalizedBytes: 48 * 1024 * 1024, pixels: 16_000_000, edge: 4096, normalizationLivePixels: 48_000_000 });
