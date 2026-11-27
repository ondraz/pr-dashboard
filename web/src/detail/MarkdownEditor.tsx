import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useDashboardState } from "../app/DashboardProvider.tsx";
import { renderMarkdown } from "../github/review.ts";
import type { PrRoute } from "../logic/prRoute.ts";
import { insertBlock } from "../logic/review.ts";
import { Markdown } from "./Markdown.tsx";

function Preview({ route, text }: { route: PrRoute; text: string }) {
    const { github } = useDashboardState();
    const { data, error } = useQuery({
        queryKey: ["markdown", github?.id, route.owner, route.repo, text],
        enabled: !!github && !!text.trim(),
        staleTime: Number.POSITIVE_INFINITY,
        queryFn: () => {
            if (!github) throw new Error("Not signed in");
            return renderMarkdown(github.client, route, text);
        },
    });
    if (!text.trim()) return <p className="muted">Nothing to preview.</p>;
    if (error) return <p className="error-text">The preview failed: {error.message}</p>;
    if (data === undefined) return <p className="muted">Rendering...</p>;
    return <Markdown html={data} />;
}

export interface MarkdownEditorProps {
    route: PrRoute;
    label: string;
    value: string;
    onChange: (text: string) => void;
    placeholder?: string;
    /** A suggested change for the lines the comment is on, which the Suggest button puts in. */
    suggestion?: string | null;
    autoFocus?: boolean;
}

/** A Markdown text box with a preview GitHub renders, as on GitHub. */
export function MarkdownEditor({
    route,
    label,
    value,
    onChange,
    placeholder,
    suggestion,
    autoFocus,
}: MarkdownEditorProps) {
    const [tab, setTab] = useState<"write" | "preview">("write");
    const area = useRef<HTMLTextAreaElement>(null);
    const id = useId();
    const suggest = () => {
        if (!suggestion) return;
        const caret = area.current?.selectionStart ?? value.length;
        const next = insertBlock(value, caret, suggestion);
        onChange(next.text);
        requestAnimationFrame(() => {
            area.current?.focus();
            area.current?.setSelectionRange(next.caret, next.caret);
        });
    };
    return (
        <div className="md-editor">
            <div className="md-editor-bar">
                <div className="md-editor-tabs" role="tablist" aria-label={label}>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "write"}
                        aria-controls={`${id}-panel`}
                        onClick={() => setTab("write")}
                    >
                        Write
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "preview"}
                        aria-controls={`${id}-panel`}
                        onClick={() => setTab("preview")}
                    >
                        Preview
                    </button>
                </div>
                {suggestion && tab === "write" && (
                    <button
                        type="button"
                        className="link-btn"
                        title="Put the selected lines in a suggested change"
                        onClick={suggest}
                    >
                        Suggest a change
                    </button>
                )}
            </div>
            <div id={`${id}-panel`} role="tabpanel" className="md-editor-panel">
                {tab === "write" ? (
                    <textarea
                        ref={area}
                        aria-label={label}
                        value={value}
                        placeholder={placeholder}
                        // biome-ignore lint/a11y/noAutofocus: the box opens because the reader asked to write in it
                        autoFocus={autoFocus}
                        rows={5}
                        onChange={(event) => onChange(event.target.value)}
                    />
                ) : (
                    <div className="md-preview">
                        <Preview route={route} text={value} />
                    </div>
                )}
            </div>
        </div>
    );
}
