import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// user-event's setup() redefines `HTMLElement.prototype.focus`/`blur` as
// getter-only accessors (document/patchFocus), while @zag-js/focus-visible
// (used by Chakra's Switch/Checkbox) replaces them by plain assignment, which
// throws "Cannot set property focus ... which has only a getter". Preserve
// user-event's getters but restore a no-op setter after every setup() so the
// zag assignment is a silent no-op instead of a crash.
const allowFocusAssignment = () => {
  if (typeof HTMLElement === 'undefined') return;
  for (const method of ['focus', 'blur'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, method);
    if (descriptor && typeof descriptor.get === 'function') {
      Object.defineProperty(HTMLElement.prototype, method, {
        configurable: true,
        get: descriptor.get,
        set: () => {},
      });
    }
  }
};

const originalUserEventSetup = userEvent.setup;
Object.defineProperty(userEvent, 'setup', {
  configurable: true,
  value: (...args: Parameters<typeof originalUserEventSetup>) => {
    const instance = originalUserEventSetup(...args);
    allowFocusAssignment();
    return instance;
  },
});

afterEach(() => {
  cleanup();
});
