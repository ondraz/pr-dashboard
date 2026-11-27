/**
 * The inline `style` attributes `@git-diff-view` writes into the HTML of a changed line, to mark the
 * changed words. The page's CSP allows exactly these, by hash, and no other inline style.
 */
export const DIFF_INLINE_STYLES: readonly string[] = (() => {
    const colours = ["--diff-add-content-highlight--", "--diff-del-content-highlight--"];
    const radii = ["0.2em", "0"];
    const styles = [""];
    for (const colour of colours) {
        styles.push(`background-color: var(${colour});border-radius: 0.2em;`);
        for (const start of radii) {
            for (const end of radii) {
                styles.push(
                    `background-color: var(${colour});border-top-left-radius: ${start};border-bottom-left-radius: ${start};` +
                        `border-top-right-radius: ${end};border-bottom-right-radius: ${end}`,
                );
            }
        }
    }
    return styles;
})();
