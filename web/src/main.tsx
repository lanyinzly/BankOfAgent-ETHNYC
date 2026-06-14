import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './landing.css';

// The mock relay now runs in-memory (see lib/relayClient + mocks/mockRelay), so we
// no longer use a service worker. Proactively unregister any stale MSW worker left
// by earlier deploys so it can't intercept real gateway / ENS calls.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations?.()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
