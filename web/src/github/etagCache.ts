/** Responses kept for conditional requests, dropping the least recently used beyond `capacity`. */
export class EtagCache<T> {
    readonly #entries = new Map<string, { etag: string; value: T }>();
    readonly #capacity: number;

    constructor(capacity = 1000) {
        this.#capacity = capacity;
    }

    get(key: string): { etag: string; value: T } | undefined {
        const entry = this.#entries.get(key);
        if (entry) {
            this.#entries.delete(key);
            this.#entries.set(key, entry);
        }
        return entry;
    }

    set(key: string, etag: string, value: T): void {
        this.#entries.delete(key);
        this.#entries.set(key, { etag, value });
        for (const oldest of this.#entries.keys()) {
            if (this.#entries.size <= this.#capacity) break;
            this.#entries.delete(oldest);
        }
    }

    get size(): number {
        return this.#entries.size;
    }
}
