import { usePersistedChoice } from "../app/storage.ts";
import type { AgeFilter, StatusFilter } from "../logic/filters.ts";
import { TABS, type Tab } from "../logic/tabs.ts";

export type Grouping = "repo" | "feature";

/** The list's tab, filters and grouping, remembered across reloads; a PR page reads them for `[` and `]`. */
export function useListView() {
    const [tab, setTab] = usePersistedChoice<Tab>("tab", TABS, "mine");
    const [status, setStatus] = usePersistedChoice<StatusFilter>("status_filter", ["all", "open", "draft"], "all");
    const [age, setAge] = usePersistedChoice<AgeFilter>("age_filter", ["recent", "all"], "recent");
    const [grouping, setGrouping] = usePersistedChoice<Grouping>("grouping", ["repo", "feature"], "repo");
    return { tab, setTab, status, setStatus, age, setAge, grouping, setGrouping };
}
