// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./Markdown.tsx";

describe("sanitizeHtml", () => {
    it("drops scripts, handlers and inline styles", () => {
        const clean = sanitizeHtml(
            '<p style="color:red" onclick="steal()">Hi<script>steal()</script><img src="x" onerror="steal()"></p>',
        );
        expect(clean).toBe('<p>Hi<img src="x"></p>');
    });

    it("opens outside links in a new tab and leaves anchors on the page", () => {
        const clean = sanitizeHtml('<a href="https://github.com/acme">acme</a> <a href="#note">note</a>');
        expect(clean).toBe(
            '<a href="https://github.com/acme" target="_blank" rel="noopener noreferrer">acme</a> <a href="#note">note</a>',
        );
    });

    it("drops javascript: links", () => {
        expect(sanitizeHtml('<a href="javascript:steal()">x</a>')).toBe("<a>x</a>");
    });
});
