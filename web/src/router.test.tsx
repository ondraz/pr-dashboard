// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routeTree } from "./router.tsx";

function renderAt(path: string) {
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
    render(
        <QueryClientProvider client={new QueryClient()}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
});

describe("routes", () => {
    it("shows the list at the root", async () => {
        renderAt("/");
        expect(await screen.findByText("Enter a GitHub token to load your open PRs.")).toBeTruthy();
    });

    it("answers any other path with a way back to the list", async () => {
        renderAt("/acme/widgets/nowhere");
        expect((await screen.findByRole("link", { name: "Back to the list" })).getAttribute("href")).toBe("/");
    });
});
