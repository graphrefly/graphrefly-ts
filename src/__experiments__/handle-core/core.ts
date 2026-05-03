/**
 * Handle-based reactive core — research prototype (Phase 13.6 brainstorm).
 *
 * Validates the architecture sketched in the 2026-05-02 brainstorm:
 *
 *   The core never sees user values T. It operates entirely on `HandleId`
 *   opaque integers. Values live in a binding-side registry (a `Map`
 *   from HandleId to T, plus a `WeakMap<value, HandleId>` for identity
 *   dedup). Equals-substitution with `equals: 'identity'` becomes a
 *   handle-id compare — zero FFI when this layer is in Rust.
 *
 *   fn invocation is the ONE crossing the binding side has to make:
 *   the core asks `invokeFn(nodeId, depHandles)`; the binding side
 *   dereferences handles to T, calls user fn, registers the output as
 *   a new handle, returns it. Custom equals optionally crosses too.
 *
 * Scope: the slice of the protocol that's most invariant-dense and
 * therefore most informative to validate at this stage:
 *
 *   - State + derived nodes
 *   - Subscribe / unsubscribe (push-on-subscribe for cached state)
 *   - DIRTY / DATA / RESOLVED ordering
 *   - Equals-substitution (identity by default; custom hook)
 *   - First-run gate (fn does not fire until every dep has a handle)
 *   - Diamond resolution (one fn call per wave even with shared upstream)
 *   - Wave model (one Core.tick = drain pending until quiescent)
 *
 * Out of scope for this prototype (worth a v2 if the v1 holds up):
 *   - PAUSE / RESUME with lock IDs
 *   - INVALIDATE broadcast
 *   - Dynamic deps (autoTrack / dynamicNode)
 *   - Producers / effects with cleanup
 *   - Errors and COMPLETE auto-prop
 *   - Resubscribable lifecycle
 *
 * Two important things to note about this prototype:
 *
 *   1. The Core has no `T` in its types. Inspect signatures of the
 *      public methods — `HandleId` is everywhere user values would
 *      otherwise sit. That is the design point. In a Rust port the
 *      Core compiles without ever seeing a `serde::Serialize`.
 *
 *   2. The binding layer (`bindings.ts`) keeps the WeakMap-based
 *      value registry. That layer is what would become per-language
 *      SDK harness in a portability scheme.
 */

// ---------------------------------------------------------------------------
// Types — pure IDs, no user values anywhere
// ---------------------------------------------------------------------------

export type NodeId = number & { readonly __brand: "NodeId" };
export type HandleId = number & { readonly __brand: "HandleId" };
export type FnId = number & { readonly __brand: "FnId" };

/** No-handle sentinel — distinct from any valid HandleId (which start at 1). */
export const NO_HANDLE = 0 as HandleId;

/** Internal-subscription marker — keeps derived deps activated when consumed
 * by another derived. Distinct from external sinks so we can filter it
 * out when delivering DATA. (In a Rust port, this would be a separate
 * "consumer link" concept rather than abusing the subscribers set.) */
const NOOP_SINK: Sink = () => {};

export const DIRTY = "DIRTY" as const;
export const DATA = "DATA" as const;
export const RESOLVED = "RESOLVED" as const;
export const START = "START" as const;
export type MessageTag = typeof DIRTY | typeof DATA | typeof RESOLVED | typeof START;

/** A wire message. DATA carries a HandleId; the rest are payload-free. */
export type Message =
	| readonly [typeof START]
	| readonly [typeof DIRTY]
	| readonly [typeof RESOLVED]
	| readonly [typeof DATA, HandleId];

export type Sink = (messages: readonly Message[]) => void;

/**
 * Equals-mode tells the core how to compare handles.
 *
 *   - 'identity' (default): handle-id compare. Cheap. Correct iff
 *     the binding-side registry maintains "same value ⇒ same handle"
 *     (the WeakMap discipline in `bindings.ts`).
 *
 *   - 'custom': core asks the binding side via `customEqualsHandle`.
 *     This crosses the boundary every emit; rare opt-in for cases
 *     where structural equality matters more than identity.
 */
export type EqualsMode = { kind: "identity" } | { kind: "custom"; handle: FnId };

/**
 * What the binding side returns when the core invokes a fn.
 *
 *   - `{ kind: 'data', handle }` — fn produced a value, registered as
 *     `handle`. Core treats as outgoing DATA (subject to equals dedup).
 *   - `{ kind: 'noop' }` — fn ran but produced no emission this wave.
 *     Core sends RESOLVED to subscribers.
 *
 * `tracked` (optional) — for dynamic nodes only. The set of dep indices
 * the fn actually read this run; deps outside this set don't gate
 * future fires. Static nodes ignore this field. See `registerDynamic()`.
 */
export type FnResult =
	| { kind: "data"; handle: HandleId; tracked?: ReadonlySet<number> }
	| { kind: "noop"; tracked?: ReadonlySet<number> };

/**
 * The boundary the binding side implements. Core calls this and only
 * this when it needs to invoke user code.
 *
 *   - `invokeFn(nodeId, fnId, depHandles)` — fire fn. Binding
 *     dereferences handles, calls user fn, returns result.
 *   - `customEquals(equalsHandle, a, b)` — only called when a node
 *     declares `equals: { kind: 'custom' }`.
 *   - `releaseHandle(id)` — core informs binding that handle is no
 *     longer referenced by any node cache. Binding decrements refcount;
 *     value GC'd when no other holders remain. Safe to be a no-op
 *     during prototyping; matters for memory pressure under load.
 */
export interface BindingBoundary {
	invokeFn(nodeId: NodeId, fnId: FnId, depHandles: readonly HandleId[]): FnResult;
	customEquals(equalsHandle: FnId, a: HandleId, b: HandleId): boolean;
	releaseHandle(handle: HandleId): void;
}

// ---------------------------------------------------------------------------
// Internal node record — Core's view of the world
// ---------------------------------------------------------------------------

interface NodeRecord {
	readonly id: NodeId;
	readonly deps: readonly NodeId[];
	/** ROM (state) keeps cache across deactivation; RAM (derived/dynamic) clears it. */
	readonly kind: "state" | "derived" | "dynamic";
	readonly fnId: FnId | null; // null for state nodes (no fn)
	readonly equals: EqualsMode;

	// Mutable state
	cache: HandleId; // NO_HANDLE iff sentinel
	/** Per-dep handle of last DATA seen. Parallels `deps` array. */
	depHandles: HandleId[];
	hasFiredOnce: boolean;
	subscribers: Set<Sink>;
	/** For dynamic nodes: which dep indices fn actually tracks. Mutated
	 * by fn fire results. For static derived, all indices are tracked.
	 */
	tracked: Set<number>;

	// Wave-scoped state — cleared at wave end
	dirty: boolean;
	involvedThisWave: boolean;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export class Core {
	private nextNodeId = 1;
	private readonly nodes = new Map<NodeId, NodeRecord>();
	/** child -> set of parent node ids it depends on. */
	private readonly children = new Map<NodeId, Set<NodeId>>();

	/** Nodes whose fn we owe a fire to — drained by `tick()`. */
	private readonly pendingFires = new Set<NodeId>();
	/** Nodes whose subscribers we owe a wave-close (DATA or RESOLVED) to. */
	private readonly pendingNotify = new Map<NodeId, Message[]>();
	private inTick = false;

	constructor(private readonly binding: BindingBoundary) {}

	// -------------------------------------------------------------------
	// Registration
	// -------------------------------------------------------------------

	registerState(initial: HandleId): NodeId {
		const id = this.allocId();
		const rec: NodeRecord = {
			id,
			deps: [],
			kind: "state",
			fnId: null,
			equals: { kind: "identity" },
			cache: initial,
			depHandles: [],
			hasFiredOnce: initial !== NO_HANDLE,
			subscribers: new Set(),
			tracked: new Set(),
			dirty: false,
			involvedThisWave: false,
		};
		this.nodes.set(id, rec);
		this.children.set(id, new Set());
		return id;
	}

	registerDerived(
		deps: readonly NodeId[],
		fnId: FnId,
		equals: EqualsMode = { kind: "identity" },
	): NodeId {
		return this.registerComputed(deps, fnId, equals, "derived");
	}

	/**
	 * Dynamic node: declares a SUPERSET of possible deps at construction
	 * (Rule L2.11 / P.22). The fn declares which subset it actually
	 * tracked this run by returning `tracked: Set<number>` in FnResult.
	 * Untracked dep updates still arrive at the Core (DATA on the wire)
	 * but do NOT cause this node's fn to fire — equals absorption at
	 * the consumer prevents wasted work.
	 *
	 * Boundary cost: same as static derived (one invokeFn per fire).
	 * The "selective deps" pattern means fewer fires per wave even
	 * though the dep declaration is broader.
	 */
	registerDynamic(
		deps: readonly NodeId[],
		fnId: FnId,
		equals: EqualsMode = { kind: "identity" },
	): NodeId {
		return this.registerComputed(deps, fnId, equals, "dynamic");
	}

	private registerComputed(
		deps: readonly NodeId[],
		fnId: FnId,
		equals: EqualsMode,
		kind: "derived" | "dynamic",
	): NodeId {
		const id = this.allocId();
		// Static derived tracks all deps; dynamic starts empty and grows by fn return.
		const trackedInit: Set<number> =
			kind === "derived" ? new Set(deps.map((_, i) => i)) : new Set();
		const rec: NodeRecord = {
			id,
			deps: deps.slice(),
			kind,
			fnId,
			equals,
			cache: NO_HANDLE,
			depHandles: deps.map(() => NO_HANDLE),
			hasFiredOnce: false,
			subscribers: new Set(),
			tracked: trackedInit,
			dirty: false,
			involvedThisWave: false,
		};
		this.nodes.set(id, rec);
		this.children.set(id, new Set());
		for (const dep of deps) {
			const set = this.children.get(dep);
			if (!set) throw new Error(`unknown dep ${dep}`);
			set.add(id);
		}
		return id;
	}

	// -------------------------------------------------------------------
	// Subscription
	// -------------------------------------------------------------------

	subscribe(nodeId: NodeId, sink: Sink): () => void {
		const rec = this.requireNode(nodeId);
		rec.subscribers.add(sink);
		// Push-on-subscribe (Spec §2.2):
		// State nodes (and derived that have already fired) push their
		// cached handle to the new subscriber.
		const startMsg: Message = [START];
		if (rec.cache !== NO_HANDLE) {
			sink([startMsg, [DATA, rec.cache]]);
		} else {
			sink([startMsg]);
		}
		// Derived activation: if first subscriber, eagerly subscribe to deps
		// so they push their cached handles, which will fill our depHandles
		// and may release the first-run gate.
		if (rec.kind !== "state" && rec.subscribers.size === 1) {
			this.activateDerived(rec);
		}
		return () => {
			rec.subscribers.delete(sink);
			// Deactivation cleanup is out of scope for v1
			// (would clear cache for RAM nodes, release handle, etc.)
		};
	}

	private activateDerived(rec: NodeRecord): void {
		// Recursive activation: for each dep, if it's a derived with no
		// cache yet (hasn't fired), activate it first. State nodes need
		// no activation — their cache is set at construction.
		// This mirrors push-on-subscribe transitively up the dep chain:
		// when D first subscribes, the recursive walk activates B and C
		// (which activate A, etc.), populating caches on the way down.
		this.runWave(() => {
			for (let i = 0; i < rec.deps.length; i++) {
				const depRec = this.requireNode(rec.deps[i]);
				if (depRec.kind !== "state" && depRec.cache === NO_HANDLE && !depRec.hasFiredOnce) {
					// Subscribe a no-op sink to keep the dep activated; this
					// also triggers its recursive activation. (In a Rust
					// port, "internal subscription" is a Core-level concept
					// distinct from external sinks; we model it by adding
					// to the subscribers set with a marker sink.)
					depRec.subscribers.add(NOOP_SINK);
					if (depRec.subscribers.size === 1) {
						this.activateDerived(depRec);
					}
				}
				// Now dep should have a cache (state always; derived after
				// activation walked above). Push-on-subscribe.
				if (depRec.cache !== NO_HANDLE) {
					this.deliverDataToConsumer(rec, i, depRec.cache);
				}
			}
		});
	}

	// -------------------------------------------------------------------
	// Emission entry point — for state nodes
	// -------------------------------------------------------------------

	emit(nodeId: NodeId, newHandle: HandleId): void {
		const rec = this.requireNode(nodeId);
		if (rec.kind !== "state") {
			throw new Error("emit() is for state nodes only; derived emits via fn");
		}
		this.runWave(() => this.commitEmission(rec, newHandle));
	}

	// -------------------------------------------------------------------
	// The wave engine — DIRTY first, then DATA / RESOLVED
	// -------------------------------------------------------------------

	private runWave(thunk: () => void): void {
		if (this.inTick) {
			// Re-entrant emission (e.g. from inside fn) — just queue work.
			thunk();
			return;
		}
		this.inTick = true;
		try {
			thunk();
			// Drain: keep firing pending fns until quiescent.
			let guard = 0;
			while (this.pendingFires.size > 0) {
				if (++guard > 10_000) {
					throw new Error("wave drain exceeded 10k iterations (cycle?)");
				}
				const next = this.pickNextFire();
				if (next === null) break;
				this.fireFn(next);
			}
			// Phase 2: deliver wave-close to subscribers.
			this.flushNotifications();
		} finally {
			// Wave cleanup
			for (const rec of this.nodes.values()) {
				rec.dirty = false;
				rec.involvedThisWave = false;
			}
			this.inTick = false;
		}
	}

	/**
	 * Pick a node whose deps are all settled (no pending fires upstream).
	 * Topological-ish order ensures diamond resolution: D fires once,
	 * after both B and C settle.
	 */
	private pickNextFire(): NodeId | null {
		for (const id of this.pendingFires) {
			const rec = this.requireNode(id);
			let allDepsSettled = true;
			for (const depId of rec.deps) {
				if (this.pendingFires.has(depId)) {
					allDepsSettled = false;
					break;
				}
			}
			if (allDepsSettled) return id;
		}
		// Cycle? Pick any (will throw or stabilize).
		const it = this.pendingFires.values().next();
		return it.done ? null : it.value;
	}

	private fireFn(nodeId: NodeId): void {
		this.pendingFires.delete(nodeId);
		const rec = this.requireNode(nodeId);
		if (rec.fnId === null) return;
		// First-run gate: every dep must have a handle before we fire.
		for (const h of rec.depHandles) {
			if (h === NO_HANDLE) {
				// Gate not yet open; defer (will be re-added when remaining
				// deps deliver). This branch is the canonical first-run
				// gate enforcement point.
				return;
			}
		}
		const result = this.binding.invokeFn(rec.id, rec.fnId, rec.depHandles);
		rec.hasFiredOnce = true;
		// For dynamic nodes, fn declares which dep indices it actually
		// read this run. Subsequent updates on untracked deps will not
		// re-add this node to pendingFires. (Static derived ignores
		// `result.tracked` — its `rec.tracked` was filled at construction.)
		if (rec.kind === "dynamic" && result.tracked) {
			rec.tracked = new Set(result.tracked);
		}
		if (result.kind === "noop") {
			// fn produced no value this wave — emit RESOLVED if dirty.
			if (rec.dirty) {
				this.queueNotify(rec, [RESOLVED]);
			}
		} else {
			this.commitEmission(rec, result.handle);
		}
	}

	// -------------------------------------------------------------------
	// Emission commit — the only place equals-substitution lives
	// -------------------------------------------------------------------

	private commitEmission(rec: NodeRecord, newHandle: HandleId): void {
		if (newHandle === NO_HANDLE) {
			throw new Error("NO_HANDLE is not a valid DATA payload");
		}
		const oldHandle = rec.cache;
		// Equals-substitution: outgoing DATA whose handle equals the cache
		// is rewritten to RESOLVED on the wire. Never bypassable via choice
		// of API (rule 1.3) — there is no other path that updates cache.
		const isData = !this.handlesEqual(rec.equals, oldHandle, newHandle);

		// Always send DIRTY first if this is the first-tier-3 of the wave.
		if (!rec.dirty) {
			rec.dirty = true;
			this.queueNotify(rec, [DIRTY]);
		}

		if (isData) {
			rec.cache = newHandle;
			// Release the prior cache handle (refcount decrement).
			if (oldHandle !== NO_HANDLE) {
				this.binding.releaseHandle(oldHandle);
			}
			this.queueNotify(rec, [DATA, newHandle]);
			// Propagate to children
			for (const childId of this.children.get(rec.id) ?? []) {
				const child = this.requireNode(childId);
				const idx = child.deps.indexOf(rec.id);
				this.deliverDataToConsumer(child, idx, newHandle);
			}
		} else {
			// RESOLVED: handle unchanged. Do NOT release; old still in use.
			this.queueNotify(rec, [RESOLVED]);
			// Children whose fn fires on RESOLVED would still get it; but
			// for `equals: identity` derived gates we propagate via
			// involvedThisWave only — no fn fire if their value unchanged.
			for (const childId of this.children.get(rec.id) ?? []) {
				const child = this.requireNode(childId);
				if (!child.involvedThisWave) {
					child.involvedThisWave = true;
					this.queueNotify(child, [DIRTY]);
					this.queueNotify(child, [RESOLVED]);
					child.dirty = true;
				}
			}
		}
	}

	private handlesEqual(mode: EqualsMode, a: HandleId, b: HandleId): boolean {
		if (a === b) return true; // identity-on-handles always sufficient
		// NO_HANDLE on either side means one of them is sentinel; treat as
		// not-equal without crossing the boundary. Custom equals never sees
		// a sentinel — handles passed to it always reference real values.
		if (a === NO_HANDLE || b === NO_HANDLE) return false;
		if (mode.kind === "identity") return false;
		return this.binding.customEquals(mode.handle, a, b);
	}

	private deliverDataToConsumer(consumer: NodeRecord, depIdx: number, handle: HandleId): void {
		consumer.depHandles[depIdx] = handle;
		consumer.involvedThisWave = true;
		// Static derived: any dep update fires fn (subject to first-run gate).
		// Dynamic: only updates on tracked deps fire fn. Untracked dep updates
		// still flow through cache (so a future fire sees the latest), but
		// don't re-schedule fn this wave. This is the L2.11 selective-deps
		// invariant: rule "fn fires but equals absorption prevents downstream
		// propagation" simplifies to "fn doesn't fire at all" under handles.
		if (consumer.kind === "derived") {
			this.pendingFires.add(consumer.id);
		} else if (consumer.kind === "dynamic") {
			// First fire ever → must run regardless of tracked set
			// (fn hasn't yet had a chance to declare its tracked deps).
			if (!consumer.hasFiredOnce || consumer.tracked.has(depIdx)) {
				this.pendingFires.add(consumer.id);
			}
		}
	}

	// -------------------------------------------------------------------
	// Subscriber notification — buffered to wave end
	// -------------------------------------------------------------------

	private queueNotify(rec: NodeRecord, msg: Message): void {
		if (rec.subscribers.size === 0) return;
		let buf = this.pendingNotify.get(rec.id);
		if (!buf) {
			buf = [];
			this.pendingNotify.set(rec.id, buf);
		}
		buf.push(msg);
	}

	private flushNotifications(): void {
		// Stable iteration: we want children to receive parent's wave-close
		// before they fire. But by the time we reach `flushNotifications`,
		// all fns have already fired in the drain loop, so order doesn't
		// affect observable fn behavior — only the order subscribers see
		// distinct nodes' messages.
		for (const [nodeId, msgs] of this.pendingNotify) {
			const rec = this.requireNode(nodeId);
			for (const sink of rec.subscribers) {
				sink(msgs);
			}
		}
		this.pendingNotify.clear();
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	private allocId(): NodeId {
		return this.nextNodeId++ as NodeId;
	}

	private requireNode(id: NodeId): NodeRecord {
		const rec = this.nodes.get(id);
		if (!rec) throw new Error(`unknown node ${id}`);
		return rec;
	}

	// -------------------------------------------------------------------
	// Inspection (for tests + Phase 13.6 audit data — pure-Rust analog
	// would be `describe()` over the same fields)
	// -------------------------------------------------------------------

	cacheOf(id: NodeId): HandleId {
		return this.requireNode(id).cache;
	}
	hasFiredOnce(id: NodeId): boolean {
		return this.requireNode(id).hasFiredOnce;
	}
}
