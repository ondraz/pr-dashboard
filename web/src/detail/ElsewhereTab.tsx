import { useParams } from "@tanstack/react-router";
import { External } from "../list/PrRows.tsx";
import { useOpenPr } from "./PrContext.tsx";

const WHAT = {
    checks: { name: "The checks", path: "/checks" },
    commit: { name: "A single commit's diff", path: "/commits/" },
} as const;

/** A GitHub path the app does not show yet, reached by swapping the host in a GitHub link. */
export function ElsewhereTab({ view }: { view: keyof typeof WHAT }) {
    const { detail } = useOpenPr();
    const { sha } = useParams({ strict: false });
    const what = WHAT[view];
    const href = `${detail.pr.url}${what.path}${view === "commit" ? (sha ?? "") : ""}`;
    return (
        <div className="empty">
            {what.name} is not shown here yet. <External href={href}>Open it on GitHub</External>.
        </div>
    );
}
