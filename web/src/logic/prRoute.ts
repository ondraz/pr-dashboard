/** A PR as the app's routes name it: `/owner/repo/pull/123`, as on GitHub. */
export interface PrRoute {
    owner: string;
    repo: string;
    number: number;
}

const GITHUB_PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)$/;

/** The route of a PR's GitHub URL, or null for any other URL. */
export function prRouteOf(htmlUrl: string): PrRoute | null {
    const match = GITHUB_PR_URL.exec(htmlUrl);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function githubPrUrl(pr: PrRoute): string {
    return `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

/** Route params arrive as strings; a PR number is a positive integer and nothing else. */
export function parsePrNumber(raw: string): number | null {
    return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}
