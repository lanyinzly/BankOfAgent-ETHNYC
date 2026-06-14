import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './landing.css';
import { USING_MOCK } from './config';

// Start the in-browser mock relay BEFORE the first render so no request can race
// the service worker. In live mode (NEXT_PUBLIC_RELAY_URL set) this is skipped
// entirely and requests go straight to the real relay.
async function enableMocking(): Promise<void> {
  if (!USING_MOCK) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
});
