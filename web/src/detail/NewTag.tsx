import { useDashboardState } from "../app/DashboardProvider.tsx";
import { isNewSince } from "../logic/lastOpened.ts";
import { useOpenPr } from "./PrContext.tsx";

/** Whether something made at a time by someone came after the reader last had the PR open. */
export function useIsNew(): (at: string | null | undefined, author: string | null | undefined) => boolean {
    const { lastOpened } = useOpenPr();
    const { github } = useDashboardState();
    return (at, author) => isNewSince(at, lastOpened, author, github?.login);
}

export function NewTag({ at, author }: { at: string | null | undefined; author: string | null | undefined }) {
    const isNew = useIsNew();
    if (!isNew(at, author)) return null;
    return (
        <span className="new-tag" title="Since you last opened this pull request">
            New
        </span>
    );
}
