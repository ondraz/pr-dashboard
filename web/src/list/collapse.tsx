import {
    createContext,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";
import { readStored, writeStored } from "../app/storage.ts";

// Only the collapsed keys are stored, so anything new - a repo the viewer just opened a PR in, a
// stack that grew a member - starts expanded.
const STORAGE_KEY = "collapsed_groups";

interface CollapseState {
    collapsed: ReadonlySet<string>;
    setCollapsed: (key: string, collapsed: boolean) => void;
}

const CollapseContext = createContext<CollapseState | null>(null);

function readCollapsed(): Set<string> {
    try {
        const stored: unknown = JSON.parse(readStored(STORAGE_KEY) ?? "[]");
        return new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : []);
    } catch {
        return new Set();
    }
}

export function CollapseProvider({ children }: { children: ReactNode }) {
    const [collapsed, setState] = useState(readCollapsed);
    const setCollapsed = useCallback((key: string, value: boolean) => {
        setState((current) => {
            if (current.has(key) === value) return current;
            const next = new Set(current);
            if (value) next.add(key);
            else next.delete(key);
            writeStored(STORAGE_KEY, JSON.stringify([...next]));
            return next;
        });
    }, []);
    const state = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);
    return <CollapseContext value={state}>{children}</CollapseContext>;
}

function useCollapseState(): CollapseState {
    const state = useContext(CollapseContext);
    if (!state) throw new Error("useCollapse needs a CollapseProvider");
    return state;
}

export function useSetCollapsed(): CollapseState["setCollapsed"] {
    return useCollapseState().setCollapsed;
}

/** Whether the section under `key` is collapsed, and the props that make its header the toggle. */
export function useCollapse(key: string) {
    const { collapsed, setCollapsed } = useCollapseState();
    const isCollapsed = collapsed.has(key);
    const toggle = () => setCollapsed(key, !isCollapsed);
    return {
        collapsed: isCollapsed,
        headerProps: {
            role: "button",
            tabIndex: 0,
            "aria-expanded": !isCollapsed,
            onClick: (event: MouseEvent) => {
                // Links in a header keep working.
                if (event.target instanceof Element && event.target.closest("a")) return;
                toggle();
            },
            onKeyDown: (event: KeyboardEvent) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggle();
            },
        },
    };
}
