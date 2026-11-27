/** How the list refreshes; the stored value is kept as the old page wrote it. */
export type RefreshMode = "live" | "60000" | "300000" | "1800000" | "3600000" | "0";

export const REFRESH_MODES: readonly { mode: RefreshMode; label: string; title?: string }[] = [
    {
        mode: "live",
        label: "live",
        title: "Checks GitHub every 15 seconds and refreshes as soon as something changed",
    },
    { mode: "60000", label: "1m" },
    { mode: "300000", label: "5m" },
    { mode: "1800000", label: "30m" },
    { mode: "3600000", label: "1h" },
    { mode: "0", label: "on access" },
];

/** The fixed auto-refresh interval, or 0 for live mode and "on access". */
export function refreshInterval(mode: RefreshMode): number {
    return mode === "live" ? 0 : Number(mode);
}
