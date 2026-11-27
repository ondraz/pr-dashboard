import { External } from "../list/PrRows.tsx";
import type { Annotation as AnnotationData } from "../logic/checks.ts";

const LEVEL_LABEL = { failure: "Failure", warning: "Warning", notice: "Notice" } as const;

const linesOf = ({ startLine, endLine }: AnnotationData) =>
    startLine === endLine ? `${endLine}` : `${startLine}-${endLine}`;

/** A check's annotation; `withPath` names the file and lines, which a diff already shows. */
export function Annotation({ annotation, withPath = false }: { annotation: AnnotationData; withPath?: boolean }) {
    const level = LEVEL_LABEL[annotation.level];
    return (
        <div
            className={`annotation level-${annotation.level}`}
            role="note"
            aria-label={`${level}: ${annotation.check}`}
        >
            <div className="annotation-head">
                <strong>{level}</strong>
                <span className="annotation-check">{annotation.check}</span>
                {withPath ? (
                    <External className="annotation-where" href={annotation.blobUrl}>
                        {annotation.path}:{linesOf(annotation)}
                    </External>
                ) : (
                    annotation.startLine !== annotation.endLine && (
                        <span className="annotation-where">lines {linesOf(annotation)}</span>
                    )
                )}
            </div>
            {annotation.title && <div className="annotation-title">{annotation.title}</div>}
            <pre className="annotation-message">{annotation.message}</pre>
            {annotation.rawDetails && (
                <details className="annotation-details">
                    <summary>Details</summary>
                    <pre>{annotation.rawDetails}</pre>
                </details>
            )}
        </div>
    );
}
