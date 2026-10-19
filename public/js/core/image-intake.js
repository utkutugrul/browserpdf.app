// Serial native-codec lane. Cancelled work keeps its reservation until it drains.
import { IMAGE_INTAKE_LIMITS } from './image-limits.js';
export { IMAGE_INTAKE_LIMITS } from './image-limits.js';
const abort = () => new DOMException('Image intake was cancelled or replaced.', 'AbortError');

export function createImageWorkLane() {
  let tail = Promise.resolve();
  return {
    run(work, { signal } = {}) { const result = tail.catch(() => {}).then(() => { signal?.throwIfAborted(); return work(); }); tail = result.catch(() => {}); return result; },
    drained: () => tail,
  };
}

export function createImageIntake({ normalize, usage, accept, onChange = () => {}, onError = () => {} }) {
  let epoch = 0, queue = [], active = null, disposed = false, draining = Promise.resolve();
  const pending = () => queue.length + (active ? 1 : 0);
  const rawReserved = () => queue.reduce((n, entry) => n + entry.file.size, active?.file.size || 0);
  function state() { return { pending: pending(), rawReserved: rawReserved(), activeName: active?.file.name || null }; }
  function cancel() { epoch++; for (const entry of queue) entry.controller.abort(); queue = []; active?.controller.abort(); onChange(state()); }
  async function pump() {
    if (active || disposed) return;
    while (queue.length && !disposed) {
      const entry = queue.shift(); active = entry; onChange(state());
      try {
        const normalized = await normalize(entry.file, { trim: false, signal: entry.controller.signal });
        if (disposed || entry.epoch !== epoch || entry.controller.signal.aborted) throw abort();
        if (!(normalized?.bytes instanceof Uint8Array) || !normalized.bytes.length || normalized.bytes.length > IMAGE_INTAKE_LIMITS.fileBytes) throw new RangeError('The normalized image exceeds 16 MiB. The previous image task was retained.');
        const current = usage();
        if (current.normalizedBytes + normalized.bytes.length > IMAGE_INTAKE_LIMITS.normalizedBytes) throw new RangeError('Normalized images exceed the 48 MiB task limit. Start a smaller image task.');
        // Accept owns transactional session validation and merges into its latest state.
        await accept(entry.file, normalized, { signal: entry.controller.signal, isCurrent: () => !disposed && entry.epoch === epoch && !entry.controller.signal.aborted });
      } catch (error) { if (!disposed && entry.epoch === epoch && error.name !== 'AbortError') onError(error, entry.file); }
      finally { active = null; onChange(state()); }
    }
  }
  function enqueue(files) {
    if (disposed) return;
    const errors = [];
    for (const file of files) {
      const current = usage();
      let error;
      if (!['image/jpeg', 'image/png'].includes(file.type)) error = 'Choose PNG or JPEG images. Other image types were not added.';
      else if (!Number.isSafeInteger(file.size) || !file.size || file.size > IMAGE_INTAKE_LIMITS.fileBytes) error = 'Choose non-empty PNG or JPEG images smaller than 16 MiB.';
      else if (pending() >= IMAGE_INTAKE_LIMITS.pending) error = 'At most 16 images may be waiting for normalization. Wait for the queue, then add more.';
      else if (current.entries + pending() >= IMAGE_INTAKE_LIMITS.entries || current.originals + pending() >= IMAGE_INTAKE_LIMITS.entries) error = 'This task retains at most 48 original images, including removed images and pending inputs. Start a new task to release its originals.';
      else if (current.rawBytes + rawReserved() + file.size > IMAGE_INTAKE_LIMITS.rawBytes) error = 'Original images and pending inputs exceed 48 MiB. Start a smaller task.';
      if (error) { errors.push({ file, error }); continue; }
      queue.push({ file, epoch, controller: new AbortController() });
    }
    onChange(state()); for (const { file, error } of errors) onError(new RangeError(error), file);
    draining = draining.catch(() => {}).then(pump); return draining;
  }
  return { enqueue, cancel, state, drained: () => draining, dispose() { cancel(); disposed = true; } };
}
