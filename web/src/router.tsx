import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { CollapseProvider } from "./list/collapse.tsx";
import { ListPage } from "./list/ListPage.tsx";

const rootRoute = createRootRoute({
    component: () => (
        <CollapseProvider>
            <Outlet />
        </CollapseProvider>
    ),
    notFoundComponent: () => (
        <div className="container">
            <div className="empty">
                Nothing here. <Link to="/">Back to the list</Link>
            </div>
        </div>
    ),
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: ListPage,
});

export const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
