import { useNavigate, useRouter } from "@tanstack/react-router";
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef } from "react";

const ListEntryContext = createContext<RefObject<number | null> | null>(null);

/** Remembers which entry of this tab's history last showed the list. */
export function ListEntryProvider({ children }: { children: ReactNode }) {
    const entry = useRef<number | null>(null);
    const router = useRouter();
    // A push at or below the list's entry drops it from history, so the way back is a fresh list.
    useEffect(
        () =>
            router.history.subscribe(({ location, action }) => {
                if (action.type === "PUSH" && entry.current !== null && location.state.__TSR_index <= entry.current) {
                    entry.current = null;
                }
            }),
        [router],
    );
    return <ListEntryContext value={entry}>{children}</ListEntryContext>;
}

function useListEntry(): RefObject<number | null> {
    const entry = useContext(ListEntryContext);
    if (!entry) throw new Error("useListEntry needs a ListEntryProvider");
    return entry;
}

/** Called by the list page, so a PR page can step back to it. */
export function useRememberListEntry(): void {
    const entry = useListEntry();
    const router = useRouter();
    useEffect(() => {
        entry.current = router.history.location.state.__TSR_index;
    }, [entry, router]);
}

/**
 * Back to the list: through history when the list is behind this page, whatever tabs and PRs were
 * opened since, so it comes back scrolled where it was; otherwise to a fresh list.
 */
export function useBackToList(): () => void {
    const entry = useListEntry();
    const router = useRouter();
    const navigate = useNavigate();
    return useCallback(() => {
        const steps = entry.current === null ? 0 : router.history.location.state.__TSR_index - entry.current;
        if (steps > 0) router.history.go(-steps);
        else void navigate({ to: "/" });
    }, [entry, router, navigate]);
}
