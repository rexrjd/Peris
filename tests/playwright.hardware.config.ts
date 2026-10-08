import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

const shared={...base};delete shared.webServer;

// Exercise these graphics paths against the built app with the same hardware
// WebGL backend used for the recorded browser captures on this workstation.
export default defineConfig(shared, {
    testDir: fileURLToPath(new URL('./e2e',import.meta.url)),
    outputDir: fileURLToPath(new URL('../artifacts/test-runs/hardware-production',import.meta.url)),
    reporter: [['list'], ['html',{outputFolder:fileURLToPath(new URL('../artifacts/test-runs/hardware-report',import.meta.url)),open:'never'}]],
    use: {
        launchOptions: {args:['--use-angle=gl','--enable-webgl','--ignore-gpu-blocklist']},
    },
    webServer: {
        command:'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url:'http://127.0.0.1:4173',
        reuseExistingServer:false,
        timeout:60000,
    },
});
