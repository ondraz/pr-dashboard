import type { PullDetail } from "./stacks.ts";

/** A fictional open PR in `acme/widgets` on branch `head`, based on `base`. */
export function pull(number: number, head: string, base: string, extra: Partial<PullDetail> = {}): PullDetail {
    return {
        number,
        title: `Change ${number}`,
        html_url: `https://github.com/acme/widgets/pull/${number}`,
        body: "",
        draft: false,
        mergeable: true,
        updated_at: "2026-11-20T10:00:00Z",
        user: { login: "alice" },
        requested_reviewers: [],
        auto_merge: null,
        head: { label: `acme:${head}`, ref: head, repo: { full_name: "acme/widgets", default_branch: "main" } },
        base: { label: `acme:${base}`, ref: base, repo: { full_name: "acme/widgets", default_branch: "main" } },
        ...extra,
    };
}
