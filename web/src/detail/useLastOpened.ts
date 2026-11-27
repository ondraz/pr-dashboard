import { useEffect, useState } from "react";
import { readStored, writeStored } from "../app/storage.ts";
import { type LastOpened, lastOpenedKey, parseLastOpened, recordOpened } from "../logic/lastOpened.ts";
import type { PrRoute } from "../logic/prRoute.ts";

const STORE_KEY = "pr_last_opened";

const readOne = (key: string): LastOpened | null => parseLastOpened(readStored(STORE_KEY))[key] ?? null;

/**
 * When the reader last had this PR open before this visit, which stays put for the visit; null on a first
 * visit. Every load of the PR the reader can see moves the stored time on, so the next visit marks only
 * what came after it.
 */
export function useLastOpened(route: PrRoute, head: string | undefined, loadedAt: number): LastOpened | null {
    const key = lastOpenedKey(route);
    const [visit, setVisit] = useState(() => ({ key, since: readOne(key) }));
    let current = visit;
    if (visit.key !== key) {
        current = { key, since: readOne(key) };
        setVisit(current);
    }

    useEffect(() => {
        if (!head || !loadedAt) return;
        const record = () => {
            if (document.visibilityState === "hidden") return;
            const entry = { at: new Date(loadedAt).toISOString(), head };
            const next = recordOpened(parseLastOpened(readStored(STORE_KEY)), key, entry, Date.now());
            writeStored(STORE_KEY, JSON.stringify(next));
        };
        record();
        document.addEventListener("visibilitychange", record);
        return () => document.removeEventListener("visibilitychange", record);
    }, [key, head, loadedAt]);

    return current.since;
}
