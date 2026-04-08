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
 *
 * When the backing node has V0 versioning (GRAPHREFLY-SPEC §7), `v0` carries
 * the node's identity (`id`) and version counter for diff-friendly observation
 * and cross-snapshot dedup (roadmap §6.0b).
 */
export type Versioned<T> = {
	readonly version: number;
	readonly value: T;
	/** V0 identity from the backing node, when versioning is enabled. */
	readonly v0?: { readonly id: string; readonly version: number };
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
 * When `v0` is provided, it is included in the snapshot for V0-aware consumers.
 *
 * **Note:** `v0` is captured before the backing node's DATA emission (which
 * advances the node's version counter). The embedded `v0.version` is therefore
 * one behind the node's post-emission `node.v.version`. This is intentional —
 * `v0` records the node's version at snapshot construction time.
 */
export function bumpVersion<T>(
	current: Versioned<T>,
	nextValue: T,
	v0?: { id: string; version: number },
): Versioned<T> {
	if (v0 != null) {
		return { version: current.version + 1, value: nextValue, v0 };
	}
	return { version: current.version + 1, value: nextValue };
}
