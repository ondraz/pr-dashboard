import { External } from "../list/PrRows.tsx";
import { useOpenPr } from "./PrContext.tsx";

/** The checks, which the app does not show yet, reached by swapping the host in a GitHub link. */
export function ElsewhereTab() {
    const { detail } = useOpenPr();
    return (
        <div className="empty">
            The checks are not shown here yet. <External href={`${detail.pr.url}/checks`}>Open them on GitHub</External>
            .
        </div>
    );
}
