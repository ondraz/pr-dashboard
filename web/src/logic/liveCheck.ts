export const LIVE_PROBE_MS = 15_000;

export interface LiveCheckOptions {
    /** Reads the change fingerprint. */
    probe: () => Promise<string>;
    /** True while a refresh runs; a check then does nothing. */
    busy: () => boolean;
    /** Called when the fingerprint moved away from the baseline. */
    onChange: () => void;
}

/**
 * Live mode's change check: a cheap probe whose result is compared with the one read as the last
 * refresh started. Without a baseline (live mode was just turned on) the first probe becomes it.
 */
export class LiveCheck {
    #baseline: string | null = null;
    #inFlight = false;
    readonly #options: LiveCheckOptions;

    constructor(options: LiveCheckOptions) {
        this.#options = options;
    }

    setBaseline(fingerprint: string | null): void {
        this.#baseline = fingerprint;
    }

    async check(): Promise<void> {
        if (this.#inFlight || this.#options.busy()) return;
        this.#inFlight = true;
        try {
            const fingerprint = await this.#options.probe();
            if (this.#baseline === null) this.#baseline = fingerprint;
            else if (fingerprint !== this.#baseline && !this.#options.busy()) this.#options.onChange();
        } catch (error) {
            console.warn("Live change check failed:", error);
        } finally {
            this.#inFlight = false;
        }
    }
}
