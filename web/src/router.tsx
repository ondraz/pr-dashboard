import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { AuthProvider } from "./app/AuthProvider.tsx";
import { DashboardProvider } from "./app/DashboardProvider.tsx";
import { ListEntryProvider } from "./app/listReturn.tsx";
import { CommitsTab } from "./detail/CommitsTab.tsx";
import { ConversationTab } from "./detail/ConversationTab.tsx";
import { ElsewhereTab } from "./detail/ElsewhereTab.tsx";
import { PrPage } from "./detail/PrPage.tsx";
import { CollapseProvider } from "./list/collapse.tsx";
import { ListPage } from "./list/ListPage.tsx";
import { parsePrNumber } from "./logic/prRoute.ts";

const rootRoute = createRootRoute({
    component: () => (
        <AuthProvider>
            <CollapseProvider>
                <DashboardProvider>
                    <ListEntryProvider>
                        <Outlet />
                    </ListEntryProvider>
                </DashboardProvider>
            </CollapseProvider>
        </AuthProvider>
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

// The same paths as on GitHub, so swapping github.com for this server in a link opens it here.
const prRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$owner/$repo/pull/$number",
    params: {
        parse: ({ owner, repo, number }) => {
            const parsed = parsePrNumber(number);
            return parsed === null ? false : { owner, repo, number: parsed };
        },
        stringify: ({ owner, repo, number }) => ({ owner, repo, number: String(number) }),
    },
    component: PrPage,
});

const conversationRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "/",
    component: ConversationTab,
});

const commitsRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "commits",
    component: CommitsTab,
});

const commitRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "commits/$sha",
    component: () => <ElsewhereTab view="commit" />,
});

const filesRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "files",
    component: () => <ElsewhereTab view="files" />,
});

const checksRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "checks",
    component: () => <ElsewhereTab view="checks" />,
});

export const routeTree = rootRoute.addChildren([
    indexRoute,
    prRoute.addChildren([conversationRoute, commitsRoute, commitRoute, filesRoute, checksRoute]),
]);

// Going back to the list puts it where it was scrolled to.
export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
