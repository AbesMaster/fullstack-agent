import { defineConfig } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure",
    // A normal browser identity: headless browsers are deliberately excluded from analytics as bots.
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } },
  webServer: {
    command: `rm -rf .data/e2e && mkdir -p e2e-artifacts && ADMIN_PASSWORD=e2e-owner-password-long npx tsx scripts/create-admin.mts e2e-owner@example.test "E2E Owner" owner > e2e-artifacts/admin.txt && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { APP_URL: `http://localhost:${PORT}`, APP_ENV: "development", PGLITE_DIR: ".data/e2e", DATA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=", SESSION_SECRET: "e2e-session-secret-at-least-32-characters" },
  },
});
