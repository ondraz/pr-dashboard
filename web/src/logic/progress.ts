export type Phase = [key: string, label: string, total: number];

/**
 * The refresh phases overlap, so the status line shows every phase still running at once,
 * e.g. "Loading… repositories 3/8 · reviews 12/40". `onChange` gets the line after each step,
 * and nothing once every phase is done.
 */
export class RefreshProgress {
    readonly #phases: Map<string, { label: string; total: number; done: number }>;
    readonly #onChange: (message: string) => void;

    constructor(phases: readonly Phase[], onChange: (message: string) => void) {
        this.#phases = new Map(phases.map(([key, label, total]) => [key, { label, total, done: 0 }]));
        this.#onChange = onChange;
        this.#report();
    }

    set(key: string, done: number): void {
        const phase = this.#phases.get(key);
        if (!phase) return;
        phase.done = done;
        this.#report();
    }

    advance(key: string): void {
        const phase = this.#phases.get(key);
        if (phase) this.set(key, phase.done + 1);
    }

    message(): string | null {
        const open = [...this.#phases.values()].filter((phase) => phase.done < phase.total);
        if (!open.length) return null;
        return `Loading… ${open.map((phase) => `${phase.label} ${phase.done}/${phase.total}`).join(" · ")}`;
    }

    #report(): void {
        const message = this.message();
        if (message) this.#onChange(message);
    }
}
