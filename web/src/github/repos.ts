export interface PrRef {
    repoFullName: string;
    number: number;
}

export function splitRepo(repoFullName: string): { owner: string; repo: string } {
    const [owner = "", repo = ""] = repoFullName.split("/");
    return { owner, repo };
}

/** `owner/name` from a search hit's `repository_url`. */
export function repoOfSearchHit(hit: { repository_url: string }): string {
    return hit.repository_url.replace(/^.*\/repos\//, "");
}
