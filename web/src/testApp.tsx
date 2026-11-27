import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { AuthApi } from "./app/auth.ts";
import { defaultServices, type Services, ServicesContext } from "./app/services.tsx";
import { routeTree } from "./router.tsx";

/** No local server to sign in with: only a pasted token works. */
export const noAppAuth: AuthApi = {
    token: async () => ({ status: "signed-out", configured: false }),
    start: () => Promise.reject(new Error("No GitHub App")),
    poll: () => Promise.reject(new Error("No GitHub App")),
    signOut: async () => {},
};

/** The whole app at `path`, with the router, in a fresh query cache. */
export function renderApp(path: string, services: Partial<Services> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
    const result = render(
        <QueryClientProvider client={queryClient}>
            <ServicesContext value={{ ...defaultServices, auth: noAppAuth, ...services }}>
                <RouterProvider router={router} />
            </ServicesContext>
        </QueryClientProvider>,
    );
    return { ...result, router, queryClient };
}
