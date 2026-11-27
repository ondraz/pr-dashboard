import { fileURLToPath } from "node:url";
import { createApp, createHttpServer } from "./app.ts";
import { createDevServer } from "./dev.ts";
import { CLI_PROJECTS_DIR, DESKTOP_SESSIONS_DIR, SessionIndex } from "./sessions.ts";

const port = Number(process.env.PORT ?? 6789);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid PORT: ${process.env.PORT}`);
    process.exit(1);
}

const dev = process.argv.includes("--dev");
const sessions = new SessionIndex(DESKTOP_SESSIONS_DIR, CLI_PROJECTS_DIR);

const server = dev
    ? await createDevServer(createApp({ sessions, webRoot: null }))
    : createHttpServer(createApp({ sessions, webRoot: fileURLToPath(new URL("../web/dist", import.meta.url)) }));

server.listen(port, "127.0.0.1", () => {
    console.log(`Serving the dashboard${dev ? " with Vite" : ""} on http://localhost:${port}/`);
});
