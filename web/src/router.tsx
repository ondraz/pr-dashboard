import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
        <main>
            <p>The React app is not wired up yet; the dashboard is still served from index.html.</p>
        </main>
    ),
});

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
