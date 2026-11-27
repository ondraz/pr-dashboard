import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/**/*.test.ts", "web/**/*.test.tsx"],
        setupFiles: ["web/src/testSetup.ts"],
        // Longer than Testing Library's five-second wait, so a wait that runs out fails with its own message.
        testTimeout: 15_000,
    },
});
