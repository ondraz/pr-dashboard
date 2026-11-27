import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Beside the 6789 a running dashboard takes, so the tests never meet it.
const port = Number(process.env.E2E_PORT ?? 6790);
const fixtures = fileURLToPath(new URL("server/fixtures/", import.meta.url));

export default defineConfig({
    testDir: "e2e",
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    // The built app, served as `make serve` serves it; the sessions come from the fictional fixtures, and the
    // sign-in and GitHub's API are answered inside the browser by each test.
    webServer: {
        command: "node server/main.ts",
        url: `http://localhost:${port}/`,
        reuseExistingServer: false,
        env: {
            ...process.env,
            PORT: String(port),
            PR_DASHBOARD_AUTH_FILE: join(tmpdir(), "pr-dashboard-e2e", "auth.json"),
            PR_DASHBOARD_DESKTOP_SESSIONS: join(fixtures, "desktop"),
            PR_DASHBOARD_CLI_PROJECTS: join(fixtures, "projects"),
        },
    },
});
