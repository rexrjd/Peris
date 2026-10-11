import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Own port and server: never reuse a friend's running development checkout.
export default defineConfig({ ...base,
 use: { ...base.use, baseURL: 'http://127.0.0.1:4175' },
 webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 60_000 },
});
