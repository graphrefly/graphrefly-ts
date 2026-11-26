/**
 * Restart as a module (R-restart@2), re-ported from graphrefly reference/modules/restart.mjs and
 * the owner of reference/operators/recover.mjs (graphrefly:D817, graphrefly-ts:D194 (3) (4)).
 *
 * One owner node faces downstream for good. What may end and be restarted is an inner node at
 * `${name}/inner` over the given dependencies; a restart replaces it by a new instance of its own
 * current definition (`graph.replace`), so its id and subscribers stay and nothing upstream needs
 * to be resubscribable. The owner depends on [...deps, inner, restart state]: it holds the inner's
 * dependencies ahead of the inner, so an inner that ends does not release the last hold on them,
 * and it reads only the inner and the restart state.
 *
 *   deps ──► name/inner ──► name          name/restart ──► name
 *   deps ─────────────────► name          (the owner's hold)
 *
 * The owner forwards the inner's values. When the inner ends, the owner's policy decides: the
 * inner's COMPLETE starts the next round while rounds are left, its ERROR the next attempt after
 * the retry policy's delay while the round has attempts left; otherwise the owner ends with that
 * terminal. A request from outside is a write to the restart state `${name}/restart`: it starts a
 * new attempt and counts toward neither. A request is served once: at each activation the owner
 * takes the state's current value as served, so a request made before or while it was inactive
 * does not restart the inner it has just activated.
 *
 * Time: a retry's delay runs on the `timers` the owner is given, or the host's; the owner reads
 * no time itself (graphrefly-ts:D194 (4)). Timers are not JSON, so `restartRecipes(timers)` gives
 * a restore's registry bound to them.
 */
import type { Ctx, CtxDep, NodeFn } from "../ctx/types.js";
import { type Node, type StateNode, terminalOfNode } from "../node/node.js";
import { graphNodeIdOf } from "../node/runtime-accessors.js";
import type { NodeOptions } from "../node/types.js";
import type { Message } from "../protocol/messages.js";
import type { GraphCheckpointJson } from "./checkpoint.js";
import type { Graph } from "./graph.js";
import { moduleName } from "./module-naming.js";
import type { GraphRecipeBuild, GraphRecipeFactory } from "./restore.js";
import { hostTimers, type Timers } from "./sources.js";

/**
 * The retry policy, as graphrefly reference/operators/recover.mjs has it: `maxAttempts` counts
 * every attempt of a round, the first included; after attempt n failed the next waits
 * min(initialMs * factor^(n-1), maxMs), or there is none.
 */
export interface RestartRetry {
	readonly maxAttempts: number;
	readonly initialMs?: number;
	readonly factor?: number;
	readonly maxMs?: number;
}

type Retry = Required<Omit<RestartRetry, "maxMs">> & { readonly maxMs?: number };

/** A checked retry policy, with its defaults filled in. */
export function restartRetry(policy: RestartRetry = { maxAttempts: 1 }): Retry {
	const { maxAttempts, initialMs = 0, factor = 1, maxMs } = policy;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
		throw new RangeError("restartRetry: maxAttempts must be a positive integer");
	if (!Number.isFinite(initialMs) || initialMs < 0)
		throw new RangeError("restartRetry: initialMs must be a finite number >= 0");
	if (!Number.isFinite(factor) || factor < 1)
		throw new RangeError("restartRetry: factor must be a finite number >= 1");
	if (maxMs !== undefined && (!Number.isFinite(maxMs) || maxMs < 0))
		throw new RangeError("restartRetry: maxMs must be a finite number >= 0");
	return Object.freeze(
		maxMs === undefined
			? { maxAttempts, initialMs, factor }
			: { maxAttempts, initialMs, factor, maxMs },
	);
}

/** The delay before the attempt after failed attempt `failed`, or undefined when there is none. */
export function restartRetryDelayMs(policy: Retry, failed: number): number | undefined {
	if (!Number.isInteger(failed) || failed < 1 || failed >= policy.maxAttempts) return undefined;
	const delay = policy.initialMs * policy.factor ** (failed - 1);
	return policy.maxMs === undefined ? delay : Math.min(delay, policy.maxMs);
}

/** The owner's configuration, which its recipe carries: JSON. */
export interface RestartOwnerConfig {
	/** The graph ids of the inner's dependencies, which the owner holds too. */
	readonly deps: readonly string[];
	readonly rounds: number;
	readonly retry: Retry;
}

/**
 * The owner's private state: the round that runs, the failures counted in it, the replaces this
 * lifetime asked for, whether a retry waits for its delay, and the last request served.
 */
interface OwnerState {
	round: number;
	failures: number;
	attempt: number;
	waiting: boolean;
	seen: number;
}

const terminalMessage = (dep: CtxDep): Message | undefined =>
	dep.terminal === undefined
		? undefined
		: dep.terminal.kind === "complete"
			? ["COMPLETE"]
			: ["ERROR", dep.terminal.error];

const nodeTerminalMessage = (node: Node<unknown>): Message | undefined => {
	const output = node.status.output;
	return output === "open"
		? undefined
		: output === "completed"
			? ["COMPLETE"]
			: ["ERROR", terminalOfNode(node)];
};

/** The owner's function and setup, for the owner node `id` of `graph`. */
export function restartOwner(
	graph: Graph,
	id: string,
	config: RestartOwnerConfig,
	timers: Timers = hostTimers,
): Required<GraphRecipeBuild> {
	const n = config.deps.length;
	const { rounds, retry } = config;
	let declared: readonly Node<unknown>[] | undefined;
	// The owner's declared dependencies: [...deps, inner, restart state]. It never rewires.
	const owned = () => {
		declared ??= graph.definition(id).deps;
		return declared;
	};
	const innerNode = () => owned()[n] as Node<unknown>;
	// No attempt when a fresh inner would end at once on its dependencies' snapshots: under its
	// auto policies, when every dependency has ended or one has ended with ERROR.
	const wouldEndAtOnce = () => {
		const outputs = owned()
			.slice(0, n)
			.map((d) => d.status.output);
		return (n > 0 && outputs.every((o) => o !== "open")) || outputs.includes("errored");
	};
	// A new instance of the inner's own current definition, its dependencies included.
	const renew = () => {
		const d = graph.definition(innerNode());
		graph.replace(innerNode(), d.deps, d.fn as NodeFn, {
			...(d.setup !== undefined ? { setup: d.setup } : {}),
			...(d.recipe !== undefined ? { recipe: d.recipe } : {}),
		});
	};
	// Starts attempt st.attempt after `delay`, unless the owner's lifetime has closed or another
	// attempt has started by then. `end` is the terminal the owner ends with when no attempt can be
	// made. While the timer runs st.waiting records the retry, so a checkpoint saves it.
	const schedule = (ctx: Ctx, st: OwnerState, delay: number, end: Message | undefined) => {
		const { signal } = ctx;
		const { attempt } = st;
		const replace = () => {
			if (signal.aborted || st.attempt !== attempt) return;
			st.waiting = false;
			// An upstream may have ended while the retry waited; the ended inner no longer hears it.
			if (wouldEndAtOnce()) {
				if (end) ctx.down([end]);
				return;
			}
			renew();
		};
		if (delay > 0) {
			st.waiting = true;
			const timer = timers.set(replace, delay);
			signal.addEventListener("abort", () => timers.clear(timer), { once: true });
		} else replace();
	};
	const fn: NodeFn = (ctx) => {
		const inner = ctx.deps[n] as CtxDep;
		const request = ctx.deps[n + 1] as CtxDep;
		const requested = (request.value as number | undefined) ?? 0;
		const st = ctx.state.get<OwnerState>() as OwnerState;
		// An INVALIDATE of the restart state is no request: the request numbers start again from it.
		if (request.invalidated) st.seen = 0;
		// The inner's INVALIDATE retracts the output, and it alone while the inner runs; once the
		// inner has ended, a dependency's does. The restart state's never does.
		const ended = inner.terminal !== undefined || innerNode().status.output !== "open";
		if (inner.invalidated || (ended && ctx.deps.slice(0, n).some((d) => d.invalidated)))
			ctx.down([["INVALIDATE"]]);
		for (const w of inner.waves) if (w.length > 0) ctx.down(w.map((v) => ["DATA", v] as Message));
		const end = terminalMessage(inner);
		let delay = 0;
		const restartable = !wouldEndAtOnce();
		let again = restartable && requested !== st.seen;
		st.seen = requested;
		if (restartable && !again && end?.[0] === "COMPLETE" && st.round < rounds) {
			st.round += 1;
			st.failures = 0;
			again = true;
		}
		if (restartable && !again && end?.[0] === "ERROR") {
			const wait = restartRetryDelayMs(retry, st.failures + 1);
			if (wait !== undefined) {
				st.failures += 1;
				delay = wait;
				again = true;
			}
		}
		if (!again) {
			if (end) ctx.down([end]);
			return;
		}
		st.attempt += 1;
		schedule(ctx, st, delay, end);
	};
	const setup = (ctx: Ctx) => {
		// At each activation, restored ones included, a request already in the restart state is old.
		const request = ctx.deps[n + 1] as CtxDep;
		const st: OwnerState = {
			...(ctx.state.get<OwnerState>() ?? { round: 1, failures: 0, attempt: 0, waiting: false }),
			seen: (request.value as number | undefined) ?? 0,
		};
		ctx.state.set(st);
		// A restored owner that recorded a waiting retry starts that retry's delay again in full,
		// for the same attempt and without counting another failure.
		if (st.waiting)
			schedule(
				ctx,
				st,
				restartRetryDelayMs(retry, st.failures) ?? 0,
				nodeTerminalMessage(innerNode()),
			);
		// Unless the owner itself has ended for good, its next activation starts a fresh inner.
		return () => {
			const self = graph.find(id);
			if (self?.status.output === "open" && innerNode().status.output !== "open") renew();
		};
	};
	return { fn, setup };
}

/** A restartable's handle: the owner, its inner and its restart state. */
export interface Restartable<T> {
	readonly node: Node<T>;
	readonly inner: Node<T>;
	readonly restartState: StateNode<number>;
	/** A request from outside: a write to the restart state, and nothing kept besides. */
	restart(): void;
}

export interface RestartableOptions<T> {
	readonly deps: readonly Node<unknown>[];
	/** The inner's function. */
	readonly fn: NodeFn;
	readonly setup?: NodeOptions<T>["setup"];
	/**
	 * A recipe that builds the inner. With one, the inner and the owner carry their recipes and a
	 * checkpoint can restore them; a restart replaces the inner with its own current definition,
	 * recipe and setup included.
	 */
	readonly recipe?: unknown;
	/** How many times the inner may complete in all, the first round included. Default 1. */
	readonly rounds?: number;
	/** Within a round, an ERROR of attempt n is retried after the policy's delay. Default none. */
	readonly retry?: RestartRetry;
	readonly timers?: Timers;
	readonly name?: string;
}

/** The recipe ref of the owner. */
export const RESTART_OWNER_REF = "restart.owner";

const ownerPolicies = Object.freeze({
	complete: "manual",
	error: "manual",
	invalidate: "manual",
} as const);

/** An owner and its inner over `deps` (R-restart@2). */
export function restartable<T>(graph: Graph, opts: RestartableOptions<T>): Restartable<T> {
	const name = moduleName(graph, opts.name, "restartable");
	const rounds = opts.rounds ?? 1;
	if (!Number.isInteger(rounds) || rounds < 1)
		throw new RangeError(`restartable ${name}: rounds is a positive integer`);
	const retry = restartRetry(opts.retry);
	const deps = [...opts.deps];
	// No value until the first request, so activation sees none.
	const restartState = graph.state<number>(undefined as never, { name: `${name}/restart` });
	const inner = graph.node<T>(deps, opts.fn, {
		name: `${name}/inner`,
		...(opts.setup !== undefined ? { setup: opts.setup } : {}),
		...(opts.recipe !== undefined ? { recipe: opts.recipe } : {}),
	});
	const config: RestartOwnerConfig = { deps: deps.map((d) => graphNodeIdOf(d)), rounds, retry };
	const built = restartOwner(graph, name, config, opts.timers);
	const node = graph.node<T>(
		[...deps, inner as Node<unknown>, restartState as Node<unknown>],
		built.fn,
		{
			name,
			...ownerPolicies,
			setup: built.setup,
			...(opts.recipe !== undefined
				? { recipe: { ref: RESTART_OWNER_REF, config: config as unknown as GraphCheckpointJson } }
				: {}),
		},
	);
	return restartableOf(graph, node);
}

/** The handle of an owner, a restored one included: its inner and restart state are its last deps. */
export function restartableOf<T>(graph: Graph, node: Node<T>): Restartable<T> {
	const deps = graph.definition(node).deps;
	const inner = deps.at(-2) as unknown as Node<T>;
	const restartState = deps.at(-1) as unknown as StateNode<number>;
	return {
		node,
		inner,
		restartState,
		// The request number is the state's value, so it goes on after a restore.
		restart() {
			restartState.set((count) => (count ?? 0) + 1);
		},
	};
}

function ownerConfig(config: GraphCheckpointJson | undefined): RestartOwnerConfig {
	const c = config as Record<string, GraphCheckpointJson> | null | undefined;
	if (c === null || c === undefined || typeof c !== "object" || Array.isArray(c))
		throw new Error(`restoreGraph: '${RESTART_OWNER_REF}' recipe requires an object config`);
	const deps = c.deps;
	if (!Array.isArray(deps) || !deps.every((d) => typeof d === "string"))
		throw new Error(`restoreGraph: '${RESTART_OWNER_REF}' config.deps must be an array of ids`);
	const rounds = c.rounds;
	if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1)
		throw new Error(`restoreGraph: '${RESTART_OWNER_REF}' config.rounds is a positive integer`);
	return {
		deps: deps as string[],
		rounds,
		retry: restartRetry(c.retry as unknown as RestartRetry),
	};
}

/** The registry of a restore, bound to the timers the restored owners run on. */
export function restartRecipes(
	timers: Timers = hostTimers,
): Readonly<Record<string, GraphRecipeFactory<RestartOwnerConfig>>> {
	return Object.freeze({
		[RESTART_OWNER_REF]: {
			ref: RESTART_OWNER_REF,
			validateConfig: ownerConfig,
			build: (config, ctx) => restartOwner(ctx.graph, ctx.id, config, timers),
		},
	});
}
