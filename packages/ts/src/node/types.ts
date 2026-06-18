import type { NodeFn } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { LockId } from "../protocol/messages.js";
import type { Node } from "./node.js";
import type { NodeVersion, NodeVersioningPolicy } from "./versioning.js";

export type Status =
	| "sentinel"
	| "pending"
	| "dirty"
	| "settled"
	| "resolved"
	| "completed"
	| "errored";

export interface NodeOptions<T = unknown> {
	/** Pre-populate cache; source pushes [DATA, initial] on subscribe (R-initial). `null` is valid. */
	initial?: T | null;
	/** First-run gate off when true; fn body must guard SENTINEL per dep (R-first-run-gate). */
	partial?: boolean;
	/** A dep terminal also settles the first-run gate (Reduce-class, R-first-run-gate). */
	terminalAsRealInput?: boolean;
	/** Auto-emit COMPLETE when ALL deps complete (R-deps-terminal). Default true. */
	completeWhenDepsComplete?: boolean;
	/** Auto-emit ERROR when any dep errors (R-deps-terminal). Default true. */
	errorWhenDepsError?: boolean;
	/** Allow re-activation after terminal; late subscribe resets the lifecycle (R-terminal). Default false. */
	resubscribable?: boolean;
	/** Clear cached value on TEARDOWN. Default false. */
	resetOnTeardown?: boolean;
	/** PAUSE/RESUME behavior (R-pause-modes). Default true. */
	pausable?: boolean | "resumeAll";
	/**
	 * Pull-mode node (R-pull / D269): a quiet-until-demanded source, identified by this
	 * author-supplied `pullId` (a unique LockId — a `Symbol` recommended; NOT the node name, NOT a
	 * bare string if callers may also use strings as pause locks). QUIET by default: it ABSORBS
	 * an upstream DIRTY WITHOUT relaying it downstream
	 * (the wedge fix) and does NOT push-on-subscribe its cached value (START only). A DEMAND =
	 * cone-routed `PULL({pullId, params?})`: a downstream consumer issues
	 * `ctx.up([["PULL", { pullId, params }]])` (broadcast up the declared cone) or
	 * `ctx.up(msgs, towardDep)` (directed) WITHOUT holding this node's reference; the PULL travels
	 * up to the pullId-holder, which fires EXACTLY ONE delivery (DIRTY-before-DATA when it emits)
	 * then RE-QUIETS (1:1). Delivery content =
	 * the orthogonal `pausable` mode: `true` → coalesced LATEST (one DATA); `'resumeAll'` → buffered
	 * BACKLOG. `pullId` + `pausable:false` is REJECTED at construction. A SELF-triggered demand (a
	 * consumer demanding a dep it ALSO reads) must defer via {@link import("../ctx/types.js").Ctx.upNext}
	 * (R-rewire-deferred / D37). Author the pullId as a shared module const used at both this node and
	 * the demander's fn.
	 */
	pullId?: LockId;
	/** Buffer the last N outgoing DATA for late subscribers (R-replay-buffer). */
	replayBuffer?: number;
	/**
	 * D109 node runtime versioning policy. Default is nodev0 (`{level:0,counter}`); `false`
	 * disables runtime version metadata for this node.
	 */
	versioning?: NodeVersioningPolicy;
	/** Mark this as a dynamicNode — fn gets ctx.track(i) for read-selection (R-dynamic-node / D35). */
	dynamic?: boolean;
	/** Dispatch pool for the fn (R-sync-core). Default sync. */
	pool?: "sync" | "async";
	/** Dispatcher to register/invoke against. Default = process-global (D26). */
	dispatcher?: Dispatcher;
	/** Optional debug name (graph layer owns real naming/inspection). */
	name?: string;
	/**
	 * Real operator/source factory name for a STANDALONE graph-less node (D43-reserved; D51).
	 * The graph index (`_entries`) carries the factory for g.*-registered nodes, so this is only
	 * read for a node NOT in any graph index — a runtime *Map inner (bare `fromAny`/`initNode`
	 * node) auto-discovered by `describe` (R-describe / R-edges-derived / D51). Off the canonical
	 * wave path (R-node-thin intact — a pure annotation, never touched by the wave machinery).
	 */
	factory?: string;
}

export interface NodeCheckpointState {
	readonly cache: unknown;
	readonly hasData: boolean;
	readonly terminal: true | unknown | undefined;
	readonly activated: boolean;
	readonly hasCalledFnOnce: boolean;
	readonly ctxState: { readonly value: unknown; readonly persist: boolean };
	readonly version: NodeVersion | undefined;
	readonly handle: Handle | null;
}

export interface NodeRestoreState {
	readonly cache: unknown;
	readonly hasData: boolean;
	readonly status: Status;
	readonly terminal: true | unknown | undefined;
	readonly hasCalledFnOnce: boolean;
	readonly ctxState: { readonly value: unknown; readonly persist: boolean };
	readonly version: NodeVersion | false;
}

/** A queued deferred self-rewire op (R-rewire-deferred / D47), drained at the wave boundary. */
export type RewireOp =
	| { kind: "add"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "remove"; dep: Node<unknown>; fn: NodeFn }
	| { kind: "set"; deps: Node<unknown>[]; fn: NodeFn };

/** Internal routing state for one up-going control wave. */
export type UpRouteState = {
	demandFired: Map<LockId, Set<Node<unknown>>>;
};
