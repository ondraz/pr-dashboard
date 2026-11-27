import { createContext, useContext } from "react";
import type { PullRequestDetail } from "../github/pullRequest.ts";
import type { LastOpened } from "../logic/lastOpened.ts";
import type { PrRoute } from "../logic/prRoute.ts";

export interface OpenPr {
    route: PrRoute;
    detail: PullRequestDetail;
    /** When the reader last had the PR open before this visit; null on a first visit. */
    lastOpened: LastOpened | null;
}

export const PrContext = createContext<OpenPr | null>(null);

/** The PR the page has open; its tabs render only once it has loaded. */
export function useOpenPr(): OpenPr {
    const open = useContext(PrContext);
    if (!open) throw new Error("useOpenPr needs a loaded PR");
    return open;
}
