import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// The in-browser mock relay. Started from main.tsx only when no real relay URL
// is configured (see config.ts / USING_MOCK).
export const worker = setupWorker(...handlers);
