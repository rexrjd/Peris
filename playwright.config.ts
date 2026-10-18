import { defineConfig, devices } from '@playwright/test';

const testPort = process.env.PERIS_TEST_PORT ?? '4173';
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Full Chromium uses the machine's graphics driver; the old headless shell
    // renders these WebGL armies through SwiftShader on the CPU.
    channel: process.env.PERIS_BROWSER_CHANNEL ?? 'chromium',
    baseURL: testUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: testUrl,
    reuseExistingServer: !process.env.CI && !process.env.PERIS_TEST_PORT,
    timeout: 60_000,
  },
});
