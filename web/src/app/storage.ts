import { useCallback, useState } from "react";

// Storage can be unavailable (blocked, private mode, full); the page then just forgets.
type StorageArea = "local" | "session";

function area(which: StorageArea): Storage | null {
    try {
        return which === "local" ? window.localStorage : window.sessionStorage;
    } catch {
        return null;
    }
}

export function readStored(key: string, which: StorageArea = "local"): string | null {
    try {
        return area(which)?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

export function writeStored(key: string, value: string | null, which: StorageArea = "local"): void {
    try {
        const storage = area(which);
        if (value === null) storage?.removeItem(key);
        else storage?.setItem(key, value);
    } catch {
        // Kept for this page view only.
    }
}

/** One of `choices`, remembered in `localStorage` under `key`; anything else stored reads as `fallback`. */
export function usePersistedChoice<T extends string>(
    key: string,
    choices: readonly T[],
    fallback: T,
): [T, (value: T) => void] {
    const [value, setValue] = useState<T>(() => {
        const stored = readStored(key);
        return choices.find((choice) => choice === stored) ?? fallback;
    });
    const update = useCallback(
        (next: T) => {
            writeStored(key, next);
            setValue(next);
        },
        [key],
    );
    return [value, update];
}
