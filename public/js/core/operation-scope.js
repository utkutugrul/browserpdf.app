'use strict';

export function createOperationScope() {
  let generation = 0;
  let active = null;
  return {
    cancel() { generation++; active?.abort(); active = null; },
    begin() {
      this.cancel(); const token = generation; const controller = new AbortController(); active = controller;
      const isCurrent = () => token === generation && active === controller && !controller.signal.aborted;
      return { signal: controller.signal, isCurrent, assertCurrent() { if (!isCurrent()) throw new DOMException('Document operation was replaced or cancelled.', 'AbortError'); }, finish() { if (active === controller) active = null; } };
    },
  };
}
