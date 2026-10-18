'use strict';

// Small document objects are independent of exported PDF bytes. Re-exporting an
// unchanged scene never appends the same object to an already edited document.
export function createEditHistory(initial = []) {
  let value = structuredClone(initial);
  let previous = [];
  let next = [];
  let revision = 0;
  const clone = (state) => structuredClone(state);
  function validate(state) {
    if (!Array.isArray(state) || state.length > 500 || new TextEncoder().encode(JSON.stringify(state)).length > 2 * 1024 * 1024) throw new RangeError('This edit session is limited to 500 objects and 2 MB of edit data.');
  }
  return {
    get value() { return clone(value); },
    get revision() { return revision; },
    get canUndo() { return previous.length > 0; },
    get canRedo() { return next.length > 0; },
    replace(state) { validate(state); previous.push(value); if (previous.length > 30) previous.shift(); value = clone(state); next = []; revision++; },
    undo() { if (!previous.length) return false; next.push(value); value = previous.pop(); revision++; return true; },
    redo() { if (!next.length) return false; previous.push(value); value = next.pop(); revision++; return true; },
    reset(state = []) { validate(state); value = clone(state); previous = []; next = []; revision++; },
  };
}
