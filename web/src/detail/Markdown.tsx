import DOMPurify from "dompurify";
import { useMemo } from "react";

// GitHub already sanitises `bodyHTML`; this second pass keeps anything it let through from running
// next to a token that can write. Links leave the app rather than replace it.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") ?? "")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

/**
 * `style` attributes are dropped, as the page's CSP would block them anyway, and so are forms, which
 * would post to this server as the page itself.
 */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, { FORBID_TAGS: ["form"], FORBID_ATTR: ["style", "form", "formaction"] });
}

/** HTML GitHub rendered from Markdown (a `bodyHTML`), sanitised again. */
export function Markdown({ html }: { html: string }) {
    const clean = useMemo(() => sanitizeHtml(html), [html]);
    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify just above
    return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}
