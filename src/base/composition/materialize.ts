/**
 * Phase 13.C — `selector` + `materialize` composers (DS-13.C / G2 lock C).
 *
 * Two paired primitives for dynamic-mount routing:
 *
 * - {@link selector} — projects an input value to a routing key, deduped.
 *   Equivalent to `map + distinctUntilChanged`, but the dedup is the
 *   semantic point: the key changes ONLY when the routed-to slot should
 *   change. Fires `materialize` re-mounts efficiently.
 *
 * - {@link materialize} — given a reactive `key` and a reactive map of
 *   `key → factory` thunks, mounts the matching factory's Graph under
 *   `parent` at a stable slot name. When `key` changes, unmounts the old
 *   slot and mounts the new factory's output. When `factories` mutates but
 *   `key` stays the same, the current slot continues to run on the OLD
 *   factory ("current sessions complete on old factory; new sessions use
 *   new factory" — full hot-swap correctness deferred to G10, parked).
 *
 * Reusable beyond the agent layer:
 * - `harnessLoop` strategy routing — the strategy node IS a `selector`.
 * - `pipelineGraph` dynamic stage selection.
 * - `refineLoop` strategy swap.
 * - Phase 13.I `spawnable()` mounts agent slots via `materialize`.
 */

import { COMPLETE, DATA, ERROR, RESOLVED } from "@graphrefly/pure-ts/core";
import { factoryTag } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import type { Graph } from "@graphrefly/pure-ts/graph";

/** Options for operator nodes: NodeOptions without `describeKind` (set internally). */
export type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function operatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", ...opts } as NodeOptions<T>;
}

// ---------------------------------------------------------------------------
// selector
// ---------------------------------------------------------------------------

/** Options for {@link selector}. */
export type SelectorOpts<TKey> = ExtraOpts & {
	/**
	 * Equality comparator for the projected key. Defaults to {@link Object.is}.
	 * Used to suppress re-emits when the input changes but the projected key
	 * does not — this is the load-bearing behavior that lets downstream
	 * `materialize` skip unnecessary unmount/remount cycles.
	 */
	equals?: (a: TKey, b: TKey) => boolean;
};

/**
 * Projects each upstream value to a routing key, deduped on the key. The
 * output node emits a key only when the projected key actually changes —
 * pairs cleanly with {@link materialize}, which re-mounts only on key
 * change.
 *
 * **Differs from `map`:** `map(input, fn)` fires on every upstream wave
 * regardless of output value. `selector(input, fn)` fires only when the
 * projected key CHANGES (under `equals`), so downstream re-mount logic is
 * stable.
 *
 * @param input - Upstream node carrying the value to project.
 * @param fn - Synchronous projection function.
 * @param opts - Optional {@link SelectorOpts}.
 * @returns `Node<TKey>` carrying the latest projected key (deduped).
 *
 * @example
 * ```ts
 * import { selector, materialize, state } from "@graphrefly/graphrefly-ts";
 *
 * type Request = { kind: "research" | "summarize" | "code"; payload: unknown };
 * const requestNode = state<Request>({ kind: "research", payload: {} });
 *
 * const presetId = selector(requestNode, (req) => req.kind);
 * // presetId is `Node<"research" | "summarize" | "code">`, deduped.
 * // Downstream materialize re-mounts ONLY when the kind axis changes.
 * ```
 *
 * @category extra
 */
export function selector<TIn, TKey>(
	input: Node<TIn>,
	fn: (input: TIn) => TKey,
	opts?: SelectorOpts<TKey>,
): Node<TKey> {
	const equals = opts?.equals ?? Object.is;
	// Lock 6.D (Phase 13.6.B): clear prev/hasPrev on deactivation so a
	// resubscribable selector doesn't dedupe the next cycle's first
	// projected key against a stale prev from the prior cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<TKey>(
		[input as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.prev;
						delete store.hasPrev;
					},
				};
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
			}
			// A11 (QA fix 2026-05-01): pre-pass — compute every projected
			// key + dedup decision FIRST, surface any user `equals` throw
			// as ERROR before any DATA goes out. The previous in-loop
			// emission interleaved partial DATA with ERROR mid-batch; that
			// left subscribers inconsistent (some had read the early DATA,
			// some treated ERROR as "discard everything since RESOLVED")
			// and left `ctx.store.prev` mutated to the last successful key,
			// which made selector "stuck" until the next throw-free batch.
			const toEmit: TKey[] = [];
			let prev: TKey | undefined = ctx.store.hasPrev ? (ctx.store.prev as TKey) : undefined;
			let hasPrev = ctx.store.hasPrev;
			for (const v of batch0 as TIn[]) {
				const key = fn(v);
				if (hasPrev) {
					let same: boolean;
					try {
						same = equals(prev as TKey, key);
					} catch (err) {
						// Pre-pass throw — abandon the whole batch (no DATA emits)
						// and surface ERROR. ctx.store stays at its pre-batch
						// state so the next batch starts from a known-good prev.
						a.down([[ERROR, err]]);
						return;
					}
					if (same) continue;
				}
				prev = key;
				hasPrev = true;
				toEmit.push(key);
			}
			if (toEmit.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
			}
			ctx.store.prev = prev as TKey;
			ctx.store.hasPrev = true;
			for (const k of toEmit) a.emit(k);
			return cleanup;
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("selector"), ...(opts?.meta ?? {}) },
		},
	);
}

// ---------------------------------------------------------------------------
// materialize
// ---------------------------------------------------------------------------

/**
 * Factory thunk for a {@link materialize} slot. Called once per mount cycle
 * to mint a fresh `TGraph` instance. The instance is mounted under
 * `parent.mount(slotName, ...)` and unmounted via `parent.remove(slotName)`
 * when `key` next changes.
 *
 * Each invocation MUST return a fresh, never-before-mounted Graph instance —
 * `Graph.mount` rejects re-mounting an instance that is already mounted
 * elsewhere in the tree. Caching factory output is unsafe.
 */
export type GraphFactory<TGraph extends Graph> = () => TGraph;

/** Options for {@link materialize}. */
export type MaterializeOpts = ExtraOpts & {
	/**
	 * Local mount name on the parent graph. Default `"materialized"`.
	 *
	 * Two materialize calls on the SAME parent must use distinct `slotName`
	 * values, otherwise the second mount throws "mount already exists".
	 * For a hub mounting many slots (e.g. {@link spawnable}'s preset
	 * registry), use `slotName: \`preset-\${id}\`` or similar.
	 */
	slotName?: string;
};

/**
 * Reactive dynamic mount: mounts the Graph instance for `key` under
 * `parent.mount(slotName, ...)`, and re-mounts when `key` changes.
 *
 * **Lifecycle.** First DATA on `key` triggers a mount: look up
 * `factories.get(key)`, call the factory thunk, mount the result under
 * `parent`. Each subsequent `key` change unmounts the previous slot and
 * mounts the new one. When this materialize node terminates (subscriber
 * teardown, `COMPLETE` from `key`, `Graph.destroy`), the active slot is
 * unmounted via `parent.remove(slotName)`.
 *
 * **Hot-swap policy (G10 deferred).** When `factories` mutates but `key`
 * stays the same, the currently-mounted slot is NOT re-instantiated —
 * "current sessions complete on old factory; new sessions use new
 * factory." Atomic disconnect/reconnect of an in-flight slot to a new
 * factory is parked under G10 (see `optimizations.md` "G10 atomic
 * registry hot-swap").
 *
 * **Output.** The returned `Node<TGraph>` emits the currently-mounted
 * Graph reference whenever a mount occurs. Consumers can subscribe to
 * watch slot changes, or read `.cache` for the active mount. SENTINEL
 * (no DATA) when no slot is currently mounted (e.g. `key` has no matching
 * factory).
 *
 * **Spec compliance.**
 * - No polling: mount transitions are reactive on `key` / `factories`.
 * - No raw async: factory invocation is synchronous; if a factory needs
 *   async setup, it returns a Graph that handles its own setup internally.
 * - Mount/unmount happens as side-effects inside the reactive `subscribe`
 *   handler — sanctioned per spec §5.9 (Graph topology mutations are
 *   imperative writes at the system boundary, not in-flight reactive
 *   triggers).
 *
 * @param key - Reactive routing key. Re-mounts on each key change (deduped
 *   by reference; pair with {@link selector} for projection-based dedup).
 * @param factories - Reactive map of `key → factory thunk`. Factory map
 *   mutations don't disturb the active slot until the next key change.
 * @param parent - Graph to mount slots under. The `slotName` (default
 *   `"materialized"`) must be free on `parent` at construction time.
 * @param opts - Optional {@link MaterializeOpts}.
 * @returns `Node<TGraph>` carrying the active mount.
 *
 * @example
 * ```ts
 * import { materialize, selector, state, Graph } from "@graphrefly/graphrefly-ts";
 *
 * const parent = new Graph("parent");
 * const factories = state<ReadonlyMap<string, () => Graph>>(new Map([
 *   ["researcher", () => new ResearchAgentGraph()],
 *   ["coder",      () => new CoderAgentGraph()],
 * ]));
 * const key = selector(requestNode, (r) => r.kind);
 * const slot = materialize(key, factories, parent, { slotName: "agent" });
 * // `slot.cache` is the active agent graph; `parent.node("agent::out")`
 * // resolves into whichever agent is currently mounted.
 * ```
 *
 * @category extra
 */
export function materialize<TKey, TGraph extends Graph>(
	key: Node<TKey>,
	factories: Node<ReadonlyMap<TKey, GraphFactory<TGraph>>>,
	parent: Graph,
	opts?: MaterializeOpts,
): Node<TGraph> {
	const slotName = opts?.slotName ?? "materialized";
	return node<TGraph>(
		(_data, a) => {
			let currentKey: TKey | undefined;
			let hasCurrentKey = false;
			let currentGraph: TGraph | undefined;
			let latestFactories: ReadonlyMap<TKey, GraphFactory<TGraph>> | undefined;
			let terminated = false;

			function unmountCurrent(): void {
				if (currentGraph === undefined) return;
				try {
					parent.remove(slotName);
				} catch {
					// Slot already gone (parent destroyed, or external `remove`).
				}
				currentGraph = undefined;
			}

			// Closure mirror for the factories map. Subscribed FIRST so
			// `latestFactories` is populated by the time the first `key` DATA
			// arrives. Same §28 factory-time-seed pattern used elsewhere.
			const facUnsub = factories.subscribe((msgs) => {
				if (terminated) return;
				for (const m of msgs) {
					if (m[0] === DATA) {
						latestFactories = m[1] as ReadonlyMap<TKey, GraphFactory<TGraph>>;
					}
				}
			});

			// Primary trigger: key DATA drives mount transitions.
			const keyUnsub = key.subscribe((msgs) => {
				if (terminated) return;
				for (const m of msgs) {
					if (m[0] === DATA) {
						const newKey = m[1] as TKey;
						const keyChanged = !hasCurrentKey || newKey !== currentKey;
						if (keyChanged) {
							unmountCurrent();
							if (latestFactories !== undefined) {
								const factory = latestFactories.get(newKey);
								if (factory !== undefined) {
									currentGraph = factory();
									parent.mount(slotName, currentGraph);
								}
							}
							currentKey = newKey;
							hasCurrentKey = true;
						}
						if (currentGraph !== undefined) {
							a.emit(currentGraph);
						} else {
							a.down([[RESOLVED]]);
						}
					} else if (m[0] === COMPLETE) {
						terminated = true;
						a.down([[COMPLETE]]);
					} else if (m[0] === ERROR) {
						terminated = true;
						a.down([m]);
					}
				}
			});

			return () => {
				terminated = true;
				keyUnsub();
				facUnsub();
				unmountCurrent();
			};
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("materialize"), slotName, ...(opts?.meta ?? {}) },
		},
	);
}
