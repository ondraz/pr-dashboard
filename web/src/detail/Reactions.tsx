import { useState } from "react";
import { useWriteAccess } from "../app/writeAccess.tsx";
import type { ReactionContent, ReactionGroupFieldsFragment } from "../github/gql/graphql.ts";
import { setReaction } from "../github/review.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePrWrite } from "./useWrite.ts";

const REACTIONS: readonly { content: ReactionContent; emoji: string; name: string }[] = [
    { content: "THUMBS_UP", emoji: "👍", name: "+1" },
    { content: "THUMBS_DOWN", emoji: "👎", name: "-1" },
    { content: "LAUGH", emoji: "😄", name: "laugh" },
    { content: "HOORAY", emoji: "🎉", name: "hooray" },
    { content: "CONFUSED", emoji: "😕", name: "confused" },
    { content: "HEART", emoji: "❤️", name: "heart" },
    { content: "ROCKET", emoji: "🚀", name: "rocket" },
    { content: "EYES", emoji: "👀", name: "eyes" },
];

/** The reactions on a comment, a review or the PR's description, which the reader can add to and take back. */
export function Reactions({
    subjectId,
    groups,
    canReact,
}: {
    subjectId: string;
    groups: readonly ReactionGroupFieldsFragment[] | null | undefined;
    canReact: boolean;
}) {
    const { route } = useOpenPr();
    const { canWrite } = useWriteAccess(route);
    const [picking, setPicking] = useState(false);
    const react = usePrWrite((client, args: { content: ReactionContent; on: boolean }) =>
        setReaction(client, subjectId, args.content, args.on),
    );
    const writable = canWrite && canReact;
    const byContent = new Map((groups ?? []).map((group) => [group.content, group]));
    const shown = REACTIONS.filter((reaction) => (byContent.get(reaction.content)?.reactors.totalCount ?? 0) > 0);
    if (!shown.length && !writable) return null;
    const toggle = (content: ReactionContent) => {
        setPicking(false);
        react.mutate({ content, on: !byContent.get(content)?.viewerHasReacted });
    };

    return (
        <div className="reactions">
            {shown.map((reaction) => {
                const group = byContent.get(reaction.content);
                const count = group?.reactors.totalCount ?? 0;
                const label = `${reaction.name}: ${count}`;
                return writable ? (
                    <button
                        key={reaction.content}
                        type="button"
                        className="reaction"
                        aria-pressed={!!group?.viewerHasReacted}
                        aria-label={label}
                        disabled={react.isPending}
                        onClick={() => toggle(reaction.content)}
                    >
                        {reaction.emoji} {count}
                    </button>
                ) : (
                    <span key={reaction.content} className="reaction" title={label}>
                        {reaction.emoji} {count}
                    </span>
                );
            })}
            {writable && (
                <span className="reaction-picker">
                    <button
                        type="button"
                        className="reaction add-reaction"
                        aria-expanded={picking}
                        aria-label="Add a reaction"
                        onClick={() => setPicking(!picking)}
                    >
                        ☺+
                    </button>
                    {picking && (
                        <span className="reaction-menu" role="menu">
                            {REACTIONS.map((reaction) => (
                                <button
                                    key={reaction.content}
                                    type="button"
                                    role="menuitemcheckbox"
                                    aria-checked={!!byContent.get(reaction.content)?.viewerHasReacted}
                                    aria-label={reaction.name}
                                    onClick={() => toggle(reaction.content)}
                                >
                                    {reaction.emoji}
                                </button>
                            ))}
                        </span>
                    )}
                </span>
            )}
            {react.error && <span className="error-text">{react.error.message}</span>}
        </div>
    );
}
