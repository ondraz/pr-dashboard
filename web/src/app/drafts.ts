import { useCallback, useSyncExternalStore } from "react";

/** The browser's `localStorage`, or a map for this page view when storage is blocked. */
interface DraftArea {
    get(key: string): string | null;
    set(key: string, text: string | null): void;
    keys(): string[];
}

function browserStorage(): DraftArea | null {
    try {
        const storage = window.localStorage;
        storage.setItem("draft-probe", "");
        storage.removeItem("draft-probe");
        return {
            get: (key) => storage.getItem(key),
            set: (key, text) => {
                try {
                    if (text === null) storage.removeItem(key);
                    else storage.setItem(key, text);
                } catch {
                    // Storage full: the text stays in the box, unsaved.
                }
            },
            keys: () => Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? ""),
        };
    } catch {
        return null;
    }
}

function memoryStorage(): DraftArea {
    const map = new Map<string, string>();
    return {
        get: (key) => map.get(key) ?? null,
        set: (key, text) => {
            if (text === null) map.delete(key);
            else map.set(key, text);
        },
        keys: () => [...map.keys()],
    };
}

/**
 * Unsent comments, kept in `localStorage` as they are typed, so a live refresh, a remount or a reload never
 * loses text. An empty draft still counts: it keeps its comment box open.
 */
class DraftStore {
    readonly #listeners = new Set<() => void>();
    readonly #keyCache = new Map<string, string[]>();
    #area: DraftArea | null = null;

    get #storage(): DraftArea {
        this.#area ??= browserStorage() ?? memoryStorage();
        return this.#area;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    read(key: string): string | null {
        return this.#storage.get(key);
    }

    write(key: string, text: string | null): void {
        this.#storage.set(key, text);
        for (const listener of this.#listeners) listener();
    }

    /** The stored keys under `prefix`, sorted, and the same array for as long as they do not change. */
    keys(prefix: string): string[] {
        const found = this.#storage
            .keys()
            .filter((key) => key.startsWith(prefix))
            .sort();
        const cached = this.#keyCache.get(prefix);
        if (cached && cached.length === found.length && cached.every((key, i) => key === found[i])) return cached;
        this.#keyCache.set(prefix, found);
        return found;
    }
}

export const drafts = new DraftStore();

/** The draft under `key`: its text (null when there is none), a setter that stores it, and a way to drop it. */
export function useDraft(key: string): [string | null, (text: string) => void, () => void] {
    const text = useSyncExternalStore(drafts.subscribe, () => drafts.read(key));
    const set = useCallback((next: string) => drafts.write(key, next), [key]);
    const clear = useCallback(() => drafts.write(key, null), [key]);
    return [text, set, clear];
}

/** The keys of every draft under `prefix`. */
export function useDraftKeys(prefix: string): string[] {
    return useSyncExternalStore(drafts.subscribe, () => drafts.keys(prefix));
}
