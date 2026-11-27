import { createRootRoute, createRoute, createRouter, Link, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { AuthProvider } from "./app/AuthProvider.tsx";
import { DashboardProvider } from "./app/DashboardProvider.tsx";
import { ListEntryProvider } from "./app/listReturn.tsx";
import { WriteAccessProvider } from "./app/writeAccess.tsx";
import { CommitsTab } from "./detail/CommitsTab.tsx";
import { ConversationTab } from "./detail/ConversationTab.tsx";
import { ElsewhereTab } from "./detail/ElsewhereTab.tsx";
import { PrPage } from "./detail/PrPage.tsx";
import { CollapseProvider } from "./list/collapse.tsx";
import { ListPage } from "./list/ListPage.tsx";
import { parseCommitSha, parseDiffRange } from "./logic/diff.ts";
import { parsePrNumber } from "./logic/prRoute.ts";

const rootRoute = createRootRoute({
    component: () => (
        <AuthProvider>
            <CollapseProvider>
                <DashboardProvider>
                    <WriteAccessProvider>
                        <ListEntryProvider>
                            <Outlet />
                        </ListEntryProvider>
                    </WriteAccessProvider>
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

// The diff view brings a syntax highlighter for every language, so it loads only once a diff opens.
const DiffTab = lazyRouteComponent(() => import("./detail/FilesTab.tsx"), "FilesTab");

const commitRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "commits/$sha",
    params: {
        parse: ({ sha }) => (parseCommitSha(sha) ? { sha } : false),
        stringify: ({ sha }) => ({ sha }),
    },
    component: DiffTab,
});

const filesRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "files",
    component: DiffTab,
});

// GitHub's own form for one commit's changes, `files/<sha>`, and for a range of commits, `files/<from>..<to>`.
const filesRangeRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "files/$range",
    params: {
        parse: ({ range }) => (parseDiffRange(range) ? { range } : false),
        stringify: ({ range }) => ({ range }),
    },
    component: DiffTab,
});

const checksRoute = createRoute({
    getParentRoute: () => prRoute,
    path: "checks",
    component: ElsewhereTab,
});

export const routeTree = rootRoute.addChildren([
    indexRoute,
    prRoute.addChildren([conversationRoute, commitsRoute, commitRoute, filesRoute, filesRangeRoute, checksRoute]),
]);

// Going back to the list puts it where it was scrolled to.
export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
