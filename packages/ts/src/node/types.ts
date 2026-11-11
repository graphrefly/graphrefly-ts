import type { Ctx, NodeFn } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { Node } from "./node.js";
import type { NodeVersion, NodeVersioningPolicy } from "./versioning.js";

/**
 * R-node@2: a node's status, derived from what it holds and never stored. Reading it changes
 * nothing.
 */
export interface Status {
	/** empty: no retained value; stale: a pending mark it received or sent in the current wave is unsettled; ready. */
	readonly cache: "empty" | "stale" | "ready";
	/** open, or ended by COMPLETE or ERROR. */
	readonly output: "open" | "completed" | "errored";
	/** inactive; active (subscribed or held by a dependent); closing (its lifetime's cleanup is running). */
	readonly lifecycle: "inactive" | "active" | "closing";
}

/** An auto or manual policy (R-terminals, R-invalidation). */
export type TerminalPolicy = "auto" | "manual";

export interface NodeOptions<T = unknown> {
	/** Pre-populate cache; source pushes [DATA, initial] on subscribe (R-initial). `null` is valid. */
	initial?: T | null;
	/**
	 * First-run gate off when true (TS sugar, not protocol): by default the function's first run
	 * waits until every dependency has a value, or a terminal its policy gives to the function.
	 */
	partial?: boolean;
	/**
	 * Terminal policies (R-terminals): `"auto"` (the default) ends this node from its dependencies'
	 * terminals: a dependency's ERROR ends it with that ERROR without running its function, and
	 * once every dependency has ended it completes after the run that sees the last terminal.
	 * `"manual"` gives that kind of terminal to the function as input (`ctx.terminal[i]`); the
	 * node ends only when its function sends a terminal.
	 */
	terminal?: { readonly complete?: TerminalPolicy; readonly error?: TerminalPolicy };
	/**
	 * INVALIDATE policy (R-invalidation): `"auto"` (the default) invalidates this node when an input
	 * is invalidated, without running its function; `"manual"` gives it to the function as input
	 * (`ctx.invalidated[i]`), and the node keeps its values until its function clears them or sends
	 * INVALIDATE itself.
	 */
	invalidate?: TerminalPolicy;
	/**
	 * Quiet node (R-wave): consumes its input waves without being marked pending or marking its
	 * dependents pending, so nothing below it waits for it. What its function sends during a run
	 * goes out after the current wave as a new wave of its own, with the kernel's PENDING; a run
	 * that sends nothing sends nothing below (no RESOLVED). Default false.
	 */
	quiet?: boolean;
	/**
	 * R-lifetime: runs once per lifetime, just before the function's first run in it, with that
	 * run's ctx. What it sends is part of that run's output, a throw ends the node as a throw of the
	 * function does, and a function it returns is the lifetime's cleanup, run when the lifetime
	 * closes (deactivation or end), after its signal is aborted and its dependencies released.
	 */
	// biome-ignore lint/suspicious/noConfusingVoidType: a setup returns its cleanup or nothing.
	setup?: (ctx: Ctx) => (() => void) | undefined | void;
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
