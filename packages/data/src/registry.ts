/**
 * Stateful registry of "created instances" per ResourceKind.
 *
 * As workflow tests / smoke runs create entities, they register the response
 * here. Subsequent operations that need a `<kind>Id` can pull a real id from
 * the registry instead of inventing one (which would 404).
 */
export class ResourceRegistry {
  private readonly byKind = new Map<string, unknown[]>();

  /** Record a created instance under `kind`. */
  record(kind: string, instance: unknown): void {
    if (!this.byKind.has(kind)) this.byKind.set(kind, []);
    this.byKind.get(kind)!.push(instance);
  }

  /** Return all instances of `kind`, oldest-first. */
  all(kind: string): readonly unknown[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Pick one instance pseudo-randomly. Returns undefined if none exist. */
  pick(kind: string, rand: () => number = Math.random): unknown {
    const list = this.byKind.get(kind);
    if (!list || list.length === 0) return undefined;
    const idx = Math.floor(rand() * list.length);
    return list[idx];
  }

  /** Pluck a specific field (e.g. "id") from a random instance. */
  pickField(kind: string, field: string, rand: () => number = Math.random): unknown {
    const inst = this.pick(kind, rand);
    if (inst && typeof inst === "object" && field in (inst as object)) {
      return (inst as Record<string, unknown>)[field];
    }
    return undefined;
  }

  size(kind: string): number {
    return this.byKind.get(kind)?.length ?? 0;
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }

  clear(): void {
    this.byKind.clear();
  }
}
