/**
 * PipelineGraph subclass (Wave A.1 Unit 1 — locked 2026-04-24).
 *
 * Specialized {@link Graph} that hosts workflow-DAG sugar methods:
 * `task` / `classify` / `combine` / `approval` / `approvalGate` / `catch`.
 * The legacy `pipeline` / `task` / `branch` / `join` / `subPipeline` /
 * `approval` / `loop` / `onFailure` factories from {@link ./index} continue
 * to work for migration ease; new code should prefer methods on this class.
 *
 * **Tier 2.3 rename:** the prior `gate(...)` method is now `approvalGate(...)`,
 * disambiguating it from the other gate-family primitives (`budgetGate` for
 * numeric constraints, `valve` for boolean switching, `policyGate` for ABAC
 * rules). The "gating dimension" here is **human judgment**.
 *
 * Construction: `pipelineGraph(name, opts?)` or `new PipelineGraph(name, opts)`.
 */

import { batch } from "@graphrefly/pure-ts/core";
import { wallClockNs } from "@graphrefly/pure-ts/core";
import type { NodeActions } from "@graphrefly/pure-ts/core";
import { COMPLETE, DATA, ERROR, RESOLVED } from "@graphrefly/pure-ts/core";
import { factoryTag, placeholderArgs } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import type { ReactiveLogBundle } from "@graphrefly/pure-ts/extra";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph";
import { domainMeta } from "../../base/meta/domain-meta.js";
import { type BaseAuditRecord, createAuditLog, mutate } from "../../base/mutation/index.js";

export type StepRef = string | Node<unknown>;

function meta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("orchestration", kind, extra);
}

// ── Decision audit record (Audit 2 + Wave A.2 Unit 8) ─────────────────────

export type DecisionAction =
	| "approve"
	| "reject"
	| "modify"
	| "drop"
	| "open"
	| "close"
	| "teardown";

export interface Decision<T = unknown> extends BaseAuditRecord {
	readonly action: DecisionAction;
	readonly count?: number;
	readonly items?: readonly T[];
	readonly unflushed?: number;
}

/** Recommended `keyOf` for keyed-storage adapters (Audit 2 #7). */
export const decisionKeyOf = <T>(d: Decision<T>): string => d.action;

// ── Gate ─────────────────────────────────────────────────────────────────

export interface GateOptions<_T = unknown> {
	/** Bounded default 1000 (Audit 2 cross-cutting). `Infinity` is opt-in. */
	maxPending?: number;
	startOpen?: boolean;
	/**
	 * Reactive auto-approve: gate's `latestIsOpen` mirrors this node's truthy
	 * value. False→true transition drains the pending queue.
	 *
	 * **`COMPLETE` / `ERROR` on the approver are silently ignored** — the gate
	 * stays in its current state. For permanent-open latching, use
	 * `onceOnly: true` (the first truthy approval latches; subsequent falsy
	 * values are ignored). The gate has no graceful terminal-state behavior
	 * for the approver itself.
	 */
	approver?: Node<unknown>;
	/** Latch — first truthy approval opens permanently; `close()` becomes no-op. */
	onceOnly?: boolean;
	meta?: Record<string, unknown>;
	handlerVersion?: { id: string; version: string | number };
}

export interface GateController<T> {
	/**
	 * The post-gate output node. Renamed from `node` (Tier 5.2 / EC6,
	 * 2026-04-29) to avoid shadowing `Graph.node(name)` when a gate is
	 * accessed off a `PipelineGraph` instance.
	 */
	readonly output: Node<T>;
	readonly pending: Node<readonly T[]>;
	readonly count: Node<number>;
	readonly isOpen: Node<boolean>;
	readonly droppedCount: Node<number>;
	readonly decisions: ReactiveLogBundle<Decision<T>>;
	readonly audit: ReactiveLogBundle<Decision<T>>;
	approve(count?: number): void;
	reject(count?: number): void;
	modify(fn: (value: T, index: number, pending: readonly T[]) => T, count?: number): void;
	open(): void;
	close(): void;
}

// ── catch (rename of onFailure; Wave A.2 Unit 10) ─────────────────────────

/**
 * Terminal-cause discriminator for the {@link PipelineGraph.catch} recovery
 * handler. Tier 1.6.3 status-enum migration: was `{ kind: "complete" | "error" }`
 * pre-1.0; aligned with the canonical lifecycle enum
 * (`status: "running" | "completed" | "errored" | "cancelled"`). The variant
 * structure is preserved — `errored` still carries `error: unknown` and
 * `completed` carries no payload.
 */
export type TerminalCause = { kind: "errored"; error: unknown } | { kind: "completed" };

export interface CatchOptions<_T> {
	/**
	 * Which terminal cause to recover. Default `"errored"` (Tier 1.6.3 rename
	 * of `"error"`). `"completed"` recovers COMPLETE; `"terminal"` recovers
	 * either. Aligns with the canonical lifecycle enum that
	 * {@link TerminalCause.kind} now uses.
	 */
	on?: "errored" | "completed" | "terminal";
	completeWhenDepsComplete?: boolean;
	meta?: Record<string, unknown>;
	handlerVersion?: { id: string; version: string | number };
}

// ── classify result envelope (Wave A.1 Unit 3) ───────────────────────────

export interface ClassifyResult<TTag extends string, T> {
	readonly tag: TTag | "error";
	readonly value: T;
	readonly error?: unknown;
}

// ── PipelineGraph ────────────────────────────────────────────────────────

export class PipelineGraph extends Graph {
	// -- task -----------------------------------------------------------------

	/**
	 * Register a workflow task (`node` + auto-add). String deps resolve via
	 * `this.resolve(path)`; Node deps via {@link Graph.nameOf} O(1) lookup.
	 *
	 * `run` receives `(data: readonly unknown[], ctx)` — the snapshot of latest
	 * values per dep (same shape as the old `DerivedFn` sugar).
	 */
	task<T>(
		name: string,
		run: (data: readonly unknown[], ctx: { prevData: readonly unknown[] }) => T | undefined | null,
		opts: { deps?: ReadonlyArray<StepRef>; meta?: Record<string, unknown> } = {},
	): Node<T> {
		const deps = (opts.deps ?? []).map((d) => this._resolveStep(d));
		const step = node<T>(
			deps,
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const result = run(data, ctx);
				if (result !== undefined && result !== null) actions.emit(result);
			},
			{
				name,
				describeKind: "derived",
				meta: meta("task", opts.meta),
			} as NodeOptions<T>,
		);
		this.add(step, { name });
		return step;
	}

	// -- classify (n-way; replaces binary `branch`) --------------------------

	classify<TTag extends string, T>(
		name: string,
		source: StepRef,
		tagger: (value: T) => TTag,
		opts: { meta?: Record<string, unknown> } = {},
	): Node<ClassifyResult<TTag, T>> {
		const src = this._resolveStep(source);
		const step = node<ClassifyResult<TTag, T>>(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const value = data[0];
				try {
					actions.emit({ tag: tagger(value as T), value: value as T });
				} catch (error) {
					actions.emit({ tag: "error" as const, value: value as T, error });
				}
			},
			{
				name,
				describeKind: "derived",
				meta: meta("classify", opts.meta),
			} as NodeOptions<ClassifyResult<TTag, T>>,
		);
		this.add(step, { name });
		return step;
	}

	// -- combine (keyed-record fan-in; replaces positional `join`) -----------

	combine<R extends Record<string, StepRef>>(
		name: string,
		deps: R,
		opts: { meta?: Record<string, unknown> } = {},
	): Node<{ [K in keyof R]: unknown }> {
		const keys = Object.keys(deps) as Array<keyof R & string>;
		const nodes = keys.map((k) => this._resolveStep(deps[k] as StepRef));
		const step = node<{ [K in keyof R]: unknown }>(
			nodes,
			(batchData, actions, ctx) => {
				const values = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const out = {} as { [K in keyof R]: unknown };
				for (let i = 0; i < keys.length; i++) {
					(out as Record<string, unknown>)[keys[i] as string] = values[i];
				}
				actions.emit(out);
			},
			{
				name,
				describeKind: "derived",
				meta: meta("combine", opts.meta),
			} as NodeOptions<{ [K in keyof R]: unknown }>,
		);
		this.add(step, { name });
		return step;
	}

	// -- approvalGate ---------------------------------------------------------

	approvalGate<T>(name: string, source: StepRef, opts: GateOptions<T> = {}): GateController<T> {
		const maxPending = opts.maxPending ?? 1000;
		if (maxPending < 1 && maxPending !== Number.POSITIVE_INFINITY) {
			throw new RangeError("approvalGate: maxPending must be >= 1");
		}
		const startOpen = opts.startOpen ?? false;

		// C3 — wrap a foreign Node source in a local proxy derived. The proxy
		// is owned by THIS graph; downstream wiring uses the proxy (not the
		// foreign Node) so the cross-graph ownership invariant holds. Causal
		// chain is preserved via the dep edge — `describe()` still surfaces
		// the foreign Node's path through the proxy.
		let src: Node<unknown>;
		if (typeof source === "string") {
			src = this._resolveStep(source);
		} else if (this.nameOf(source) !== undefined) {
			src = source;
		} else {
			const proxy = node<unknown>(
				[source],
				(batchData, actions) => {
					const batch0 = batchData[0];
					if (batch0 == null || batch0.length === 0) return;
					for (const v of batch0) actions.emit(v);
				},
				{
					describeKind: "derived",
					meta: factoryTag("proxy"),
				},
			);
			this.add(proxy, { name: `${name}/source` });
			src = proxy;
		}

		// State subgraph
		const internal = new Graph(`${name}-state`);
		const pendingNode = internal.state<readonly T[]>("pending", [], {
			equals: () => false,
		});
		const isOpenNode = internal.state<boolean>("isOpen", startOpen);
		const countNode = internal.derived<number>("count", ["pending"], (batchData, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			return [(data[0] as readonly T[]).length];
		});
		const droppedCountNode = internal.state<number>("droppedCount", 0);
		const decisions = createAuditLog<Decision<T>>({
			name: "decisions",
			retainedLimit: 1024,
			graph: internal,
		});
		this.mount(`${name}-state`, internal);

		let queue: T[] = [];
		let torn = false;
		let latched = false;
		// Closure-mirror per COMPOSITION-GUIDE §28 factory-time seed pattern.
		// `output` samples `latestIsOpen` inside its fn body when deciding
		// emit-vs-enqueue; reading a closure variable is NOT a P3 violation
		// (§28). An in-session Phase 9 plan would have relocated the value to
		// `internal.derived("latestIsOpen", ...)` + `.cache` reads (which IS
		// a P3 violation); plan was reverted at the design level after
		// re-reading §28 — pattern preserved here. See `archive/docs/SESSION-
		// graph-narrow-waist.md` § "Status of existing modifications".
		let latestIsOpen = startOpen;
		const isOpenUnsub = isOpenNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) latestIsOpen = m[1] as boolean;
			}
		});
		this.addDisposer(isOpenUnsub);

		function syncPending(): void {
			pendingNode.emit([...queue]);
		}

		function recordDecision(
			action: DecisionAction,
			items?: readonly T[],
			unflushed?: number,
		): void {
			decisions.append({
				action,
				t_ns: wallClockNs(),
				...(items !== undefined ? { items, count: items.length } : {}),
				...(unflushed !== undefined ? { unflushed } : {}),
				...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
			} as Decision<T>);
		}

		function enqueue(value: T): void {
			queue.push(value);
			if (queue.length > maxPending) {
				const dropped = queue.shift() as T;
				droppedCountNode.emit((droppedCountNode.cache as number) + 1);
				recordDecision("drop", [dropped]);
			}
			syncPending();
		}

		function dequeue(n: number): T[] {
			const items = queue.splice(0, n);
			syncPending();
			return items;
		}

		const output = node<T>(
			[src],
			(batchData, actions, ctx) => {
				const terminal = ctx.terminalDeps[0];
				if (terminal !== undefined) {
					torn = true;
					const unflushed = queue.length;
					queue = [];
					syncPending();
					recordDecision("teardown", undefined, unflushed);
					actions.down(terminal === true ? [[COMPLETE]] : [[ERROR, terminal]]);
					return;
				}
				const batch0 = batchData[0];
				if (batch0 == null || batch0.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0 as T[]) {
					if (latestIsOpen) {
						actions.emit(v);
					} else {
						enqueue(v);
						actions.down([[RESOLVED]]);
					}
				}
			},
			{
				name,
				describeKind: "derived",
				meta: meta("approval_gate", opts.meta),
			},
		);
		this.add(output, { name });

		// Reactive approver mode: mirror latestIsOpen to the approver's value.
		// **m1:** approver `COMPLETE` / `ERROR` are silently ignored — gate stays
		// in current state. For latching behavior, use `onceOnly: true`.
		if (opts.approver != null) {
			const initialApproved = Boolean(opts.approver.cache);
			if (initialApproved) {
				isOpenNode.emit(true);
				latestIsOpen = true;
				if (opts.onceOnly) latched = true;
			}
			const approverSub = opts.approver.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] !== DATA) continue;
					const truthy = Boolean(m[1]);
					if (truthy && !latestIsOpen) {
						// false → true transition
						if (opts.onceOnly) {
							if (latched) continue;
							latched = true;
						}
						batch(() => {
							isOpenNode.emit(true);
							const items = dequeue(queue.length);
							// M11: include items count in approver-driven open decisions
							// so audit consumers see how many items were flushed.
							recordDecision("open", items);
							for (const item of items) {
								if (torn) break;
								output.emit(item);
							}
						});
					} else if (!truthy && latestIsOpen) {
						if (opts.onceOnly && latched) continue;
						batch(() => {
							isOpenNode.emit(false);
							recordDecision("close");
						});
					}
				}
			});
			this.addDisposer(approverSub);
		}

		const guardTorn = (method: string): void => {
			if (torn) throw new Error(`approvalGate: ${method}() called after the gate was torn down`);
		};

		const approveImpl = (count = 1): void => {
			guardTorn("approve");
			const items = dequeue(count);
			for (const item of items) {
				if (torn) break;
				output.emit(item);
			}
		};
		const rejectImpl = (count = 1): void => {
			guardTorn("reject");
			dequeue(count);
		};
		const modifyImpl = (
			fn: (value: T, index: number, pending: readonly T[]) => T,
			count = 1,
		): void => {
			guardTorn("modify");
			const snapshot = [...queue] as readonly T[];
			const items = dequeue(count);
			for (let i = 0; i < items.length; i++) {
				if (torn) break;
				output.emit(fn(items[i], i, snapshot));
			}
		};
		const openImpl = (): void => {
			guardTorn("open");
			isOpenNode.emit(true);
			const items = dequeue(queue.length);
			for (const item of items) {
				if (torn) break;
				output.emit(item);
			}
		};
		const closeImpl = (): void => {
			guardTorn("close");
			if (opts.onceOnly && latched) return;
			isOpenNode.emit(false);
		};

		const approve = mutate(approveImpl, {
			frame: "transactional",
			log: decisions,
			freeze: false,
			onSuccessRecord: (args, _r, m) =>
				({
					action: "approve",
					count: (args[0] as number | undefined) ?? 1,
					t_ns: m.t_ns,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
			onFailureRecord: (_a, _e, m) =>
				({
					action: "drop",
					t_ns: m.t_ns,
					errorType: m.errorType,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
		});
		const reject = mutate(rejectImpl, {
			frame: "transactional",
			log: decisions,
			freeze: false,
			onSuccessRecord: (args, _r, m) =>
				({
					action: "reject",
					count: (args[0] as number | undefined) ?? 1,
					t_ns: m.t_ns,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
			onFailureRecord: (_a, _e, m) =>
				({
					action: "drop",
					t_ns: m.t_ns,
					errorType: m.errorType,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
		});
		const modify = mutate(modifyImpl, {
			frame: "transactional",
			log: decisions,
			freeze: false,
			onSuccessRecord: (args, _r, m) =>
				({
					action: "modify",
					count: (args[1] as number | undefined) ?? 1,
					t_ns: m.t_ns,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
			onFailureRecord: (_a, _e, m) =>
				({
					action: "drop",
					t_ns: m.t_ns,
					errorType: m.errorType,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
		});
		const open = mutate(openImpl, {
			frame: "transactional",
			log: decisions,
			freeze: false,
			onSuccessRecord: (_a, _r, m) =>
				({
					action: "open",
					t_ns: m.t_ns,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
			onFailureRecord: (_a, _e, m) =>
				({
					action: "drop",
					t_ns: m.t_ns,
					errorType: m.errorType,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
		});
		const close = mutate(closeImpl, {
			frame: "transactional",
			log: decisions,
			freeze: false,
			onSuccessRecord: (_a, _r, m) =>
				({
					action: "close",
					t_ns: m.t_ns,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
			onFailureRecord: (_a, _e, m) =>
				({
					action: "drop",
					t_ns: m.t_ns,
					errorType: m.errorType,
					...(opts.handlerVersion != null ? { handlerVersion: opts.handlerVersion } : {}),
				}) as Decision<T>,
		});

		this.addDisposer(countNode.subscribe(() => undefined));

		const controller: GateController<T> = {
			output,
			pending: pendingNode,
			count: countNode,
			isOpen: isOpenNode,
			droppedCount: droppedCountNode,
			decisions,
			audit: decisions,
			approve,
			reject,
			modify,
			open,
			close,
		};
		return controller;
	}

	// -- approval (thin alias over approvalGate({ approver, maxPending: 1 })) -

	/**
	 * Reactive approval step: passes items through when `approver` is truthy;
	 * holds at most one pending item (maxPending: 1) when falsy. A thin alias
	 * over `approvalGate({ approver, maxPending: 1 })` — use `approvalGate()`
	 * directly for finer control (maxPending, onceOnly, manual approve/reject).
	 */
	approval<T>(
		name: string,
		source: StepRef,
		approver: Node<unknown>,
		opts: Omit<GateOptions<T>, "approver" | "maxPending"> = {},
	): GateController<T> {
		return this.approvalGate<T>(name, source, { ...opts, approver, maxPending: 1 });
	}

	// -- catch (renamed onFailure; dep-channel intercept) -------------------

	catch<T>(
		name: string,
		source: StepRef,
		recover: (cause: TerminalCause, actions: NodeActions) => T,
		opts: CatchOptions<T> = {},
	): Node<T> {
		const src = this._resolveStep(source);
		const mode = opts.on ?? "errored";
		const step = node<T>(
			[src],
			(batchData, actions, ctx) => {
				const terminal = ctx.terminalDeps[0];
				if (terminal !== undefined) {
					const cause: TerminalCause =
						terminal === true ? { kind: "completed" } : { kind: "errored", error: terminal };
					if (mode === "terminal" || mode === cause.kind) {
						actions.emit(recover(cause, actions));
						return;
					}
					actions.down(cause.kind === "completed" ? [[COMPLETE]] : [[ERROR, cause.error]]);
					return;
				}
				const batch0 = batchData[0];
				if (batch0 == null || batch0.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0 as T[]) actions.emit(v);
			},
			{
				name,
				describeKind: "derived",
				completeWhenDepsComplete:
					opts.completeWhenDepsComplete ?? !(mode === "completed" || mode === "terminal"),
				errorWhenDepsError: !(mode === "errored" || mode === "terminal"),
				meta: meta("catch", opts.meta),
			} as NodeOptions<T>,
		);
		this.add(step, { name });
		return step;
	}

	// -- internals ----------------------------------------------------------

	private _resolveStep(dep: StepRef): Node<unknown> {
		if (typeof dep === "string") return this.resolve(dep);
		const existing = this.nameOf(dep);
		if (existing === undefined) {
			throw new Error(
				`PipelineGraph "${this.name}": Node dep is not registered. Pass a string path or call graph.add(node) first.`,
			);
		}
		return dep;
	}
}

/** Factory wrapper — `pipelineGraph(name, opts?)`. Equivalent to `new PipelineGraph(name, opts)`. */
export function pipelineGraph(name: string, opts?: GraphOptions): PipelineGraph {
	const g = new PipelineGraph(name, opts);
	// Tier 1.5.3 Phase 2.5 (DG1=B): tag the Graph with its constructing
	// factory so `describe()` exposes provenance. `factoryArgs` is the
	// constructor opts (sans the `factory`/`factoryArgs` keys themselves to
	// avoid recursive nesting). QA F13: route through `placeholderArgs` for
	// consistency with sibling factories — `GraphOptions[key: string]: unknown`
	// is open-ended, so user-extension keys may carry non-JSON content.
	const { factory: _f, factoryArgs: _fa, ...tagArgs } = (opts ?? {}) as Record<string, unknown>;
	g.tagFactory("pipelineGraph", placeholderArgs(tagArgs));
	return g;
}
