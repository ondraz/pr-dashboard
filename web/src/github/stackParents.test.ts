import { describe, expect, it } from "vitest";
import type { PullDetail } from "../logic/stacks.ts";
import { pull } from "../logic/testPulls.ts";
import { fetchStackParents } from "./stackParents.ts";

function finder(prs: PullDetail[]) {
    const asked: string[] = [];
    const find = async (_repo: string, label: string) => {
        asked.push(label);
        return prs.find((pr) => pr.head?.label === label) ?? null;
    };
    return { asked, find };
}

describe("fetchStackParents", () => {
    it("follows the bases down to the default branch", async () => {
        const colleague = [
            pull(2, "b", "a", { user: { login: "bob" } }),
            pull(1, "a", "main", { user: { login: "bob" } }),
        ];
        const { asked, find } = finder(colleague);
        const parents = await fetchStackParents("acme/widgets", [pull(3, "c", "b")], find);
        expect(parents.map((pr) => pr.number)).toEqual([2, 1]);
        expect(asked).toEqual(["acme:b", "acme:a"]);
    });

    it("asks nothing for a base the viewer's own PRs already cover, or the default branch", async () => {
        const { asked, find } = finder([]);
        expect(await fetchStackParents("acme/widgets", [pull(1, "a", "main"), pull(2, "b", "a")], find)).toEqual([]);
        expect(asked).toEqual([]);
    });

    it("asks once for a base several PRs share", async () => {
        const { asked, find } = finder([pull(1, "a", "main")]);
        await fetchStackParents("acme/widgets", [pull(2, "b", "a"), pull(3, "c", "a")], find);
        expect(asked).toEqual(["acme:a"]);
    });

    it("gives up after five colleague PRs", async () => {
        const chain = Array.from({ length: 8 }, (_, i) => pull(i + 1, `h${i + 1}`, `h${i}`));
        const { find } = finder(chain);
        const parents = await fetchStackParents("acme/widgets", [pull(9, "h9", "h8")], find);
        expect(parents.map((pr) => pr.number)).toEqual([8, 7, 6, 5, 4]);
    });

    it("stops at a base with no open PR", async () => {
        const { find } = finder([]);
        expect(await fetchStackParents("acme/widgets", [pull(2, "b", "release-1")], find)).toEqual([]);
    });
});
