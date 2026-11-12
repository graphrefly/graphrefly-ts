import type { Ctx, NodeFn } from "../ctx/types.js";
import type { Dispatcher, Handle } from "../dispatcher/index.js";
import type { Node } from "./node.js";

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
	 * COMPLETE policy (R-terminals). `"auto"` (the default): once every dependency has ended, the
	 * node completes after the run that sees the last terminal; a node with no dependencies never
	 * completes automatically. `"manual"`: a dependency's COMPLETE is the function's input
	 * (`ctx.terminal[i]`) and the node ends only when its function sends a terminal.
	 */
	complete?: TerminalPolicy;
	/**
	 * ERROR policy (R-terminals). `"auto"` (the default): a dependency's ERROR ends the node with
	 * that ERROR without running its function. `"manual"`: it is the function's input
	 * (`ctx.terminal[i]`) and the node ends only when its function sends a terminal.
	 */
	error?: TerminalPolicy;
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
	 * R-node: an opaque description of how this instance was built, such as a checkpoint's
	 * `{ ref, config }` (R-checkpoint); the kernel stores it and never reads it. A computed node
	 * without one is local-only in a checkpoint.
	 */
	recipe?: unknown;
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
	 * node) auto-discovered by `describe` (R-graph-surface / R-edges-derived / D51). Off the canonical
	 * wave path (R-node-thin intact — a pure annotation, never touched by the wave machinery).
	 */
	factory?: string;
}

/**
 * R-checkpoint: what a node received from one dependency, the values of that dependency's last
 * array and its terminal.
 */
export interface NodeReceived {
	readonly values: readonly unknown[];
	readonly terminal: true | unknown | undefined;
}

/**
 * R-checkpoint / R-subscription: a restored computed node's construction seed beyond its values,
 * terminal and private state. Its first activation compares what it had received with what its
 * dependencies hold then.
 */
export interface NodeSeed {
	readonly received: readonly NodeReceived[];
}

export interface NodeCheckpointState {
	/** The values of the node's last array (R-subscription). */
	readonly values: readonly unknown[];
	readonly cache: unknown;
	readonly hasData: boolean;
	readonly terminal: true | unknown | undefined;
	readonly activated: boolean;
	/** The current lifetime's private state; `undefined` (SENTINEL) when there is none. */
	readonly privateState: unknown;
	/** A restored node's seed, until its first activation. */
	readonly seed: NodeSeed | undefined;
	readonly handle: Handle | null;
}

export interface NodeRestoreState {
	readonly values: readonly unknown[];
	readonly terminal: true | unknown | undefined;
	readonly privateState: unknown;
	readonly seed: NodeSeed | undefined;
}

/** R-node: what replace gives a new instance besides its dependencies and function. */
export interface ReplaceOptions {
	// biome-ignore lint/suspicious/noConfusingVoidType: a setup returns its cleanup or nothing.
	readonly setup?: (ctx: Ctx) => (() => void) | undefined | void;
	/** An opaque description of how the instance was built; the kernel stores it and never reads it. */
	readonly recipe?: unknown;
}

/**
 * R-node@2: a node's current definition, its declared dependencies, its current instance's
 * function, setup and recipe, and its policies; reading it changes nothing.
 */
export interface NodeDefinition {
	readonly deps: readonly Node<unknown>[];
	readonly fn: NodeFn | null;
	// biome-ignore lint/suspicious/noConfusingVoidType: a setup returns its cleanup or nothing.
	readonly setup: ((ctx: Ctx) => (() => void) | undefined | void) | undefined;
	readonly recipe: unknown;
	readonly complete: TerminalPolicy;
	readonly error: TerminalPolicy;
	readonly invalidate: TerminalPolicy;
	readonly quiet: boolean;
}
