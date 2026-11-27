import { useState } from "react";
import { useKeys } from "../app/keys.ts";
import { PR_SHORTCUTS } from "../logic/shortcuts.ts";

/** `?`, or the button, lists the PR page's keyboard shortcuts; Escape or the button again closes the list. */
export function ShortcutsHelp() {
    const [open, setOpen] = useState(false);
    useKeys({
        "?": () => setOpen((current) => !current),
        escape: () => {
            if (!open) return false;
            setOpen(false);
        },
    });
    return (
        <span className="shortcuts">
            <button
                type="button"
                className="step-btn"
                aria-expanded={open}
                aria-keyshortcuts="?"
                title="Keyboard shortcuts (?)"
                onClick={() => setOpen(!open)}
            >
                ?
            </button>
            {open && (
                <section className="shortcuts-list" aria-label="Keyboard shortcuts">
                    <h2>Keyboard shortcuts</h2>
                    <dl>
                        {PR_SHORTCUTS.map((shortcut) => (
                            <div key={shortcut.keys.join()}>
                                <dt>
                                    {shortcut.keys.map((key) => (
                                        <kbd key={key}>{key}</kbd>
                                    ))}
                                </dt>
                                <dd>{shortcut.does}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}
        </span>
    );
}
