// UI / behaviour tests: `npm test`. Starts its own Vite server on :5174.
import { defineConfig, devices } from '@playwright/test';

const gpuArgs = ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    launchOptions: { args: gpuArgs },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npx vite --port 5174 --strictPort', port: 5174, reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } }, testIgnore: /mobile/ },
    { name: 'desktop-wide', use: { viewport: { width: 1920, height: 1080 } }, testMatch: /hud/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' }, testMatch: /mobile|hud/ },
  ],
});
