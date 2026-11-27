import { createContext, type ReactNode, useContext } from "react";
import { REFRESH_MODES, type RefreshMode } from "../logic/refresh.ts";
import { useAuth } from "./AuthProvider.tsx";
import { usePersistedChoice } from "./storage.ts";
import { type Dashboard, useDashboard } from "./useDashboard.ts";

export interface DashboardState extends Dashboard {
    mode: RefreshMode;
    setMode: (mode: RefreshMode) => void;
}

const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboardState(): DashboardState {
    const state = useContext(DashboardContext);
    if (!state) throw new Error("useDashboardState needs a DashboardProvider");
    return state;
}

/**
 * The list's data lives above the routes, so it stays loaded and keeps refreshing while a PR is
 * open, and going back shows the list as it was left.
 */
export function DashboardProvider({ children }: { children: ReactNode }) {
    const { credentials } = useAuth();
    const [mode, setMode] = usePersistedChoice<RefreshMode>(
        "refresh_interval",
        REFRESH_MODES.map((choice) => choice.mode),
        "live",
    );
    const dashboard = useDashboard(credentials, mode);
    return <DashboardContext value={{ ...dashboard, mode, setMode }}>{children}</DashboardContext>;
}
