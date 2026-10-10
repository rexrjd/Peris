import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// A fresh disposable authority, separate from the user's persistent local realm.
process.env.FRONTIER_E2E = '1';
export default defineConfig({
    testDir: './tests/e2e', testMatch: 'frontier.spec.ts', workers: 1,
    outputDir: '.frontier-test-results',
    timeout: 180_000, expect: { timeout: 15_000 },
    reporter: [['list'], ['html', { outputFolder: '.frontier-playwright-report', open: 'never' }]],
    use: { baseURL: 'http://127.0.0.1:4174', channel: process.env.PERIS_BROWSER_CHANNEL ?? 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
        { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: 'node scripts/dev-frontier.mjs',
        url: 'http://127.0.0.1:4174/api/frontier/health', timeout: 60_000, reuseExistingServer: false,
        env: {
            FRONTIER_DATA_DIR: path.resolve('artifacts/frontier-e2e', String(process.pid)),
            FRONTIER_PORT: '8788', FRONTIER_UI_PORT: '4174',
            FRONTIER_UI_ORIGINS: 'http://127.0.0.1:4174',
        },
    },
});
