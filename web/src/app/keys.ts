import { useEffect, useLayoutEffect, useRef } from "react";
import { currentIndex, stepIndex } from "../logic/shortcuts.ts";

// Inputs that take no typed text, so a key pressed while one has the focus is still a shortcut.
const KEYLESS_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return !KEYLESS_INPUTS.has(target.type);
    return target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * What each key does, by the character it types or, lower-cased, the name of a key that types none
 * (`escape`); a handler returning false leaves the key to the browser.
 */
export type KeyHandlers = Partial<Record<string, () => unknown>>;

/**
 * Single-key shortcuts for as long as the component is mounted. They stay out of the way of text boxes and of
 * the browser's own shortcuts, which come with a modifier.
 */
export function useKeys(handlers: KeyHandlers): void {
    const latest = useRef(handlers);
    useLayoutEffect(() => {
        latest.current = handlers;
    });
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTyping(event.target)) {
                return;
            }
            const handler = latest.current[event.key.length > 1 ? event.key.toLowerCase() : event.key];
            if (handler && handler() !== false) event.preventDefault();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);
}

/**
 * How far each of `elements` is below where scrolling it into view puts it: its top in the window less its
 * `scroll-margin-top`, so a target just scrolled to is at 0.
 */
export function topsOf(elements: readonly Element[]): number[] {
    return elements.map(
        (element) =>
            element.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0),
    );
}

/** Which of `elements` is being read: the last one scrolled to or past, else the first. */
export function currentOf<E extends Element>(elements: readonly E[]): E | null {
    const index = currentIndex(topsOf(elements), 0);
    return index === null ? null : (elements[index] ?? null);
}

/** Scrolls to the next or previous of `elements` from where the page is, and returns it; null at either end. */
export function stepTo(elements: readonly Element[], direction: 1 | -1): Element | null {
    const index = stepIndex(topsOf(elements), direction, 0);
    const target = index === null ? null : (elements[index] ?? null);
    target?.scrollIntoView({ block: "start" });
    return target;
}
