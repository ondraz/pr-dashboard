import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useKeys } from "../app/keys.ts";
import { useListView } from "../list/listView.ts";
import { listOrder, neighbours } from "../logic/listOrder.ts";
import { prRouteOf } from "../logic/prRoute.ts";

function Step({ url, label, shortcut }: { url: string | null; label: string; shortcut: string }) {
    const route = url ? prRouteOf(url) : null;
    const text = label === "Previous" ? "‹ Previous" : "Next ›";
    if (!route) {
        return (
            <span className="step-btn" aria-disabled="true">
                {text}
            </span>
        );
    }
    return (
        <Link
            className="step-btn"
            to="/$owner/$repo/pull/$number"
            params={route}
            title={`${label} pull request in the list (${shortcut})`}
            aria-keyshortcuts={shortcut}
        >
            {text}
        </Link>
    );
}

/** The PRs either side of this one in the list as it is filtered and grouped, and `[` / `]` to open them. */
export function PrSteps({ url }: { url: string }) {
    const { data } = useDashboardState();
    const { tab, status, age, grouping } = useListView();
    const navigate = useNavigate();
    const { previous, next } = useMemo(
        () =>
            data
                ? neighbours(listOrder(data, { tab, filters: { status, age }, grouping }), url)
                : { previous: null, next: null },
        [data, tab, status, age, grouping, url],
    );

    const go = (target: string | null) => {
        const route = target ? prRouteOf(target) : null;
        if (route) void navigate({ to: "/$owner/$repo/pull/$number", params: route });
    };
    useKeys({ "[": () => go(previous), "]": () => go(next) });

    return (
        <nav className="pr-steps" aria-label="Neighbouring pull requests">
            <Step url={previous} label="Previous" shortcut="[" />
            <Step url={next} label="Next" shortcut="]" />
        </nav>
    );
}
