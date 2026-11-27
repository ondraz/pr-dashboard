import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { useWriteAccess } from "../app/writeAccess.tsx";
import { type GitHubClient, WriteRefused } from "../github/client.ts";
import type { ReviewSubject } from "../github/review.ts";
import { useOpenPr } from "./PrContext.tsx";
import { prQueryKey } from "./usePullRequest.ts";

/**
 * A change to the open PR. Once GitHub has taken it, the PR (or the part of it `reread` names) is read again
 * before the mutation counts as done, so a comment box closes on the page that shows the comment; a refusal
 * hides the write actions in its repository.
 */
export function usePrWrite<TArgs>(
    write: (client: GitHubClient, args: TArgs) => Promise<unknown>,
    { reread }: { reread?: string } = {},
) {
    const { route } = useOpenPr();
    const { github } = useDashboardState();
    const queryClient = useQueryClient();
    const access = useWriteAccess(route);
    return useMutation({
        mutationFn: async (args: TArgs) => {
            if (!github) throw new Error("Not signed in");
            await write(github.client, args);
        },
        onSettled: () => {
            const key = prQueryKey(github?.id, route);
            return queryClient.invalidateQueries({ queryKey: reread ? [...key, reread] : key, exact: true });
        },
        onError: (error) => {
            if (error instanceof WriteRefused) access.refuse(error.message);
        },
    });
}

/** What every review action needs to know about the open PR. */
export function useReviewSubject(): ReviewSubject {
    const { route, detail } = useOpenPr();
    const { pr } = detail;
    return {
        route,
        pullRequestId: pr.id,
        headOid: pr.headRefOid,
        pendingReviewId: pr.pendingReview?.nodes?.[0]?.id ?? null,
    };
}
