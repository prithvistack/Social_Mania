import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = join(tmpdir(), "quiet-tube-cache");

type Entry<T> = { value: T; storedAt: number };

/**
 * A single-user cache. Values live in module memory (fast) and are mirrored to
 * /tmp (survives a warm lambda being reused for a new request, which is the
 * common case on Vercel). Neither is durable — a cold start just refetches.
 */
export class Store<T> {
  private memory = new Map<string, Entry<T>>();
  private inFlight = new Map<string, Promise<T>>();

  private namespace: string;
  private ttlSeconds: number;

  // Written out rather than using parameter properties, which Node's
  // type-stripping test runner cannot parse.
  constructor(namespace: string, ttlSeconds: number) {
    this.namespace = namespace;
    this.ttlSeconds = ttlSeconds;
  }

  private file(key: string) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(DIR, `${this.namespace}-${safe}.json`);
  }

  private async read(key: string): Promise<Entry<T> | null> {
    const hit = this.memory.get(key);
    if (hit) return hit;
    try {
      const raw = await readFile(this.file(key), "utf8");
      const entry = JSON.parse(raw) as Entry<T>;
      this.memory.set(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async write(key: string, value: T) {
    const entry: Entry<T> = { value, storedAt: Date.now() };
    this.memory.set(key, entry);
    try {
      await mkdir(DIR, { recursive: true });
      await writeFile(this.file(key), JSON.stringify(entry), "utf8");
    } catch {
      // A read-only or full filesystem is fine — memory still holds the value.
    }
  }

  private isFresh(entry: Entry<T>) {
    return Date.now() - entry.storedAt < this.ttlSeconds * 1000;
  }

  async peek(key: string): Promise<{ value: T; storedAt: number; fresh: boolean } | null> {
    const entry = await this.read(key);
    if (!entry) return null;
    return { ...entry, fresh: this.isFresh(entry) };
  }

  /**
   * Returns the cached value when it is still fresh, otherwise refetches.
   * Concurrent callers share one refetch, and if the refetch throws while we
   * hold a stale value, the stale value wins — a hiccup at the YouTube API
   * should never blank out the feed.
   */
  async resolve(
    key: string,
    load: () => Promise<T>,
    opts: { force?: boolean } = {},
  ): Promise<{ value: T; storedAt: number; fresh: boolean }> {
    const entry = await this.read(key);
    if (entry && this.isFresh(entry) && !opts.force) {
      return { ...entry, fresh: true };
    }

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = load()
        .then(async (value) => {
          await this.write(key, value);
          return value;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }

    try {
      const value = await pending;
      return { value, storedAt: Date.now(), fresh: true };
    } catch (err) {
      if (entry) return { ...entry, fresh: false };
      throw err;
    }
  }

  /**
   * Removes the entry from both tiers. The mirror file has to actually go —
   * writing a null placeholder instead would leave `peek` handing callers an
   * entry whose value is null.
   */
  async invalidate(key: string) {
    this.memory.delete(key);
    try {
      await rm(this.file(key), { force: true });
    } catch {
      // Nothing to do — the in-memory delete above is the part that matters.
    }
  }
}
