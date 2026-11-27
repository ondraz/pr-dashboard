import { useEffect } from "react";
import { LIVE_PROBE_MS, type LiveCheck } from "../logic/liveCheck.ts";

/** Runs `liveCheck` every 15 seconds while the tab is visible; null stops it. */
export function useLiveTicks(liveCheck: LiveCheck | null): void {
    useEffect(() => {
        if (!liveCheck) return;
        const check = () => {
            if (document.visibilityState === "visible") void liveCheck.check();
        };
        const timer = setInterval(check, LIVE_PROBE_MS);
        // Back on the tab, check at once rather than at the next tick.
        document.addEventListener("visibilitychange", check);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", check);
        };
    }, [liveCheck]);
}
