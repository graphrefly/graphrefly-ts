import type { NodeFn } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
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
	/**
	 * Quiet node (R-wave): consumes its input waves without being marked pending or marking its
	 * dependents pending, so nothing below it waits for it. What its function sends during a run
	 * goes out after the current wave as a new wave of its own, with the kernel's PENDING; a run
	 * that sends nothing sends nothing below (no RESOLVED). Default false.
	 */
	quiet?: boolean;
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
