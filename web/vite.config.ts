import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// We deliberately accept BOTH the `NEXT_PUBLIC_` prefix (the name fixed by the
// relay interface contract / README) and Vite's native `VITE_` prefix, so the
// documented env var `NEXT_PUBLIC_RELAY_URL` is exposed to client code.
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 5173,
    host: true,
  },
});
