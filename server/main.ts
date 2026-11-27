import { fileURLToPath } from "node:url";
import { createApp, createHttpServer } from "./app.ts";
import { CLI_PROJECTS_DIR, DESKTOP_SESSIONS_DIR, SessionIndex } from "./sessions.ts";

const port = Number(process.env.PORT ?? 6789);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid PORT: ${process.env.PORT}`);
    process.exit(1);
}

const app = createApp({
    sessions: new SessionIndex(DESKTOP_SESSIONS_DIR, CLI_PROJECTS_DIR),
    indexHtml: fileURLToPath(new URL("../index.html", import.meta.url)),
});

createHttpServer(app).listen(port, "127.0.0.1", () => {
    console.log(`Serving the dashboard on http://localhost:${port}/`);
});
