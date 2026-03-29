/**
 * Shared internals for roadmap §3.2 data structures (option B — versioned snapshots).
 *
 * @remarks
 * Not re-exported from the package barrel; consumers use concrete factories
 * (`reactiveMap`, …). Keeps `equals` / snapshot wiring consistent across
 * collections without exposing a second public protocol.
 *
 * @packageDocumentation
 * @internal
 */

/**
 * Immutable value paired with a monotonic version for {@link NodeOptions.equals}.
 * Downstream nodes can treat unchanged versions as `RESOLVED`-eligible via `equals`.
 */
export type Versioned<T> = {
	readonly version: number;
	readonly value: T;
};

/**
 * `NodeOptions.equals` helper: compares only `version` on {@link Versioned} snapshots.
 */
export function snapshotEqualsVersion(a: unknown, b: unknown): boolean {
	if (typeof a !== "object" || a == null || typeof b !== "object" || b == null) {
		return Object.is(a, b);
	}
	if (!("version" in a) || !("version" in b)) return Object.is(a, b);
	return (a as Versioned<unknown>).version === (b as Versioned<unknown>).version;
}

/**
 * Returns the next snapshot with an incremented version (pure).
 */
export function bumpVersion<T>(current: Versioned<T>, nextValue: T): Versioned<T> {
	return { version: current.version + 1, value: nextValue };
}
