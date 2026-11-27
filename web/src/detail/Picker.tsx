import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import type { GitHubClient } from "../github/client.ts";
import type { PickOption } from "../github/manage.ts";
import { useOpenPr } from "./PrContext.tsx";

/** `value`, once it has stayed the same for `ms`, so typing in a filter asks GitHub once rather than per key. */
function useSettled<T>(value: T, ms: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
}

export interface PickerProps {
    /** Names what is picked, e.g. "reviewers"; also the query's key. */
    kind: string;
    /** What the PR has now, checked and listed first. */
    current: readonly PickOption[];
    load: (client: GitHubClient, query: string) => Promise<PickOption[]>;
    /** Options never offered, such as the PR's author as its reviewer. */
    exclude?: readonly string[];
    busy: boolean;
    onToggle: (option: PickOption, on: boolean) => void;
    onClose: () => void;
}

/** GitHub's sidebar menu: a filter, and a checkbox per option that adds it to the PR or takes it off at once. */
export function Picker({ kind, current, load, exclude = [], busy, onToggle, onClose }: PickerProps) {
    const { route } = useOpenPr();
    const { github } = useDashboardState();
    const [filter, setFilter] = useState("");
    const query = useSettled(filter, 250);
    const { data, error, isFetching } = useQuery({
        queryKey: ["pick", kind, github?.id, route.owner, route.repo, query],
        enabled: !!github,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return load(github.client, query);
        },
    });
    const words = filter.trim().toLowerCase();
    const picked = new Set(current.map((option) => option.name));
    const shown = [
        ...current.filter((option) => option.name.toLowerCase().includes(words)),
        ...(data ?? []).filter((option) => !picked.has(option.name) && !exclude.includes(option.name)),
    ];
    return (
        <fieldset className="picker" aria-label={`Pick ${kind}`}>
            <div className="picker-head">
                <input
                    aria-label={`Filter ${kind}`}
                    placeholder="Filter"
                    value={filter}
                    // biome-ignore lint/a11y/noAutofocus: the menu opens because the reader asked to pick from it
                    autoFocus
                    onChange={(event) => setFilter(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onClose();
                    }}
                />
                <button type="button" className="link-btn" onClick={onClose}>
                    Done
                </button>
            </div>
            {error && <p className="error-text">{error.message}</p>}
            <ul className="picker-options">
                {shown.map((option) => (
                    <li key={option.id}>
                        <label>
                            <input
                                type="checkbox"
                                checked={picked.has(option.name)}
                                disabled={busy}
                                onChange={(event) => onToggle(option, event.target.checked)}
                            />
                            {option.avatarUrl && (
                                <img className="avatar" src={option.avatarUrl} alt="" width={20} height={20} />
                            )}
                            {option.name}
                        </label>
                    </li>
                ))}
                {!shown.length && <li className="muted">{isFetching || !data ? "Loading..." : "Nothing found"}</li>}
            </ul>
        </fieldset>
    );
}
