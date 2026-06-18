import type { Dispatcher } from "../dispatcher/index.js";
import type { Node, NodeOptions } from "../node/node.js";
import type { NodeVersioningPolicy } from "../node/versioning.js";
import type { EnvironmentDrivers } from "./environment.js";

/** Map a tuple of Nodes to the tuple of their value types (typed value-level fn args). */
export type DepValues<D extends readonly Node<unknown>[]> = {
	[K in keyof D]: D[K] extends Node<infer V> ? V : never;
};

/** Value-level derived fn: receives dep values, returns the next value (undefined = no emit). */
export type DerivedFn<D extends readonly Node<unknown>[], T> = (
	...values: DepValues<D>
) => T | undefined;

/** Value-level effect fn: receives dep values, optionally returns a deactivation cleanup. */
export type EffectFn<D extends readonly Node<unknown>[]> = (
	...values: DepValues<D>
	// biome-ignore lint/suspicious/noConfusingVoidType: effect returns void OR a cleanup fn — the void arm keeps `(v) => { sideEffect(v) }` ergonomic (React EffectCallback idiom); dropping it would force an explicit `return undefined`.
) => void | (() => void);

/** Sugar options — node options minus graph-owned dispatcher plus naming/meta. */
export interface SugarOpts<T = unknown> extends Omit<NodeOptions<T>, "dispatcher"> {
	name?: string;
	meta?: Record<string, unknown>;
	/**
	 * D95: explicit restorable factory metadata. Static JSON-compatible config may live here;
	 * reactive options must remain graph deps. Without this, function-backed nodes are local-only.
	 */
	restore?: { ref: string; config?: unknown; configVersion?: unknown };
}

export interface GraphOptions {
	name?: string;
	/** Bind to a dispatcher (default = process-global, D26). */
	dispatcher?: Dispatcher;
	/** D109 default node runtime versioning policy for graph-owned nodes. Default is nodev0. */
	versioning?: NodeVersioningPolicy;
	/** Graph-owned environment drivers for source/adapter boundaries (D130/D131). */
	environment?: EnvironmentDrivers;
	/**
	 * Turn on the dispatcher profile recorder (D39 / F-PERF default off). NOTE: this
	 * switches recording on for the WHOLE bound dispatcher (the default is process-global,
	 * D26) — every graph sharing it then pays the recorder cost. For isolated profiling
	 * use a dedicated dispatcher: `graph({ dispatcher: new Dispatcher(), profile: true })`.
	 */
	profile?: boolean;
}
