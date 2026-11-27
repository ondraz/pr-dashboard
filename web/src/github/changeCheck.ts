import type { ChangeFingerprint } from "../logic/fingerprint.ts";
import { tabSearches } from "../logic/tabs.ts";
import { type GitHubClient, graphql } from "./client.ts";
import { changeProbeQuery } from "./documents.ts";

/**
 * GitHub has no push API a page can subscribe to, so live mode reads this one-point query every
 * few seconds and refreshes only when the fingerprint moves. `fingerprint` keeps what it learned
 * about mergeability between reads, so pass the same one each time.
 */
export async function readChangeFingerprint(
    client: GitHubClient,
    login: string,
    fingerprint: ChangeFingerprint,
): Promise<string> {
    const { data } = await graphql(client, changeProbeQuery, tabSearches(login));
    return fingerprint.read(data);
}
