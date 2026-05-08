/**
 * stratify — reactive branch routing over a classifier rule set.
 *
 * Protocol-level primitive (no domain assumptions) that routes a source value
 * to independent branch subgraphs. Rules are reactive — update the `"rules"`
 * state node to rewrite classification at runtime. Rule updates affect
 * **future items only** (streaming semantics, not retroactive).
 *
 * @module
 */

import type { NodeActions } from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	RESOLVED,
	TEARDOWN,
} from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { Graph, type GraphOptions } from "../../graph/graph.js";

/** A single routing rule for {@link stratify}. */
export type StratifyRule<T> = {
	/** Branch name (used as node name under `branch/<name>`). */
	name: string;
	/** Classifier: returns `true` if the value belongs to this branch. */
	classify: (value: T) => boolean;
	/** Optional operator chain applied to the branch after classification. */
	ops?: (n: Node<T>) => Node;
};

/** Options for {@link stratify}. */
export type StratifyOptions = GraphOptions & {
	meta?: Record<string, unknown>;
};

/**
 * Route input to different branches based on classifier functions.
 *
 * Each branch gets an independent operator chain. Branch nodes are structural —
 * created at construction time and persist for the graph's lifetime. If a rule
 * name is removed from the rules array, the corresponding branch silently
 * drops items (classifier not found). To tear down a dead branch, call
 * `graph.remove("branch/<name>")`.
 *
 * @param name - Graph name.
 * @param source - Input node (registered as `"source"`).
 * @param rules - Initial routing rules.
 * @param opts - Optional graph/meta options.
 * @returns Graph with `"source"`, `"rules"`, and `"branch/<name>"` nodes.
 *
 * @category extra
 */
export function stratify<T>(
	name: string,
	source: Node<T>,
	rules: ReadonlyArray<StratifyRule<T>>,
	opts?: StratifyOptions,
): Graph {
	const g = new Graph(name, opts);

	// C3 — wrap the foreign source in a local proxy derived. The proxy is
	// owned by `g`; downstream branches subscribe to the proxy (not the
	// foreign Node) so the cross-graph ownership invariant holds. The proxy
	// also keeps `describe(g)` self-contained: the source path resolves
	// inside `g` while the dep edge preserves the causal chain back to the
	// foreign source.
	const sourceProxy = node<T>(
		[source as Node<unknown>],
		(batchData, actions) => {
			const batch0 = batchData[0];
			if (batch0 == null || batch0.length === 0) return;
			for (const v of batch0) actions.emit(v as T);
		},
		{
			describeKind: "derived",
			meta: factoryTag("proxy"),
		},
	);
	g.add(sourceProxy as Node<unknown>, { name: "source" });
	const rulesNode = node<ReadonlyArray<StratifyRule<T>>>([], {
		initial: rules,
		meta: { kind: "stratify_rules" },
	});
	g.add(rulesNode as Node<unknown>, { name: "rules" });

	for (const rule of rules) {
		_addBranch(g, sourceProxy, rulesNode, rule);
	}

	return g;
}

function _addBranch<T>(
	graph: Graph,
	source: Node<T>,
	rulesNode: Node<ReadonlyArray<StratifyRule<T>>>,
	rule: StratifyRule<T>,
): void {
	const branchName = `branch/${rule.name}`;

	// Two-dep gating: intercepts messages from BOTH source (dep 0) and rules
	// (dep 1). Classification is deferred until all dirty deps have settled,
	// eliminating the stale-rules race when both are updated in the same batch().
	//
	// Protocol: DIRTY is buffered until DATA arrives. If the classifier matches,
	// emit [DIRTY, DATA]. If not, emit [DIRTY, RESOLVED] so downstream exits
	// dirty status cleanly (spec §1.3.1). Source RESOLVED forwards as RESOLVED.
	// Rules-only changes produce no downstream emission ("future items only").
	//
	// Producer pattern with `[]` deps: the framework does NOT auto-propagate
	// DIRTY/RESOLVED/COMPLETE from source or rules. We forward source terminals
	// explicitly below, and we silently absorb rules signals — preserving the
	// "future items only" semantic (rules changes are invisible downstream).
	const _noValue: unique symbol = Symbol("noValue");
	let sourceDirty = false;
	let rulesDirty = false;
	let sourcePhase2 = false;
	let sourceValue: T | typeof _noValue = _noValue;
	let pendingDirty = false;
	// Latest rules DATA, seeded at factory time (wiring-time external read —
	// allowed per foundation-redesign §3.6). Updated by the rules subscribe
	// handler so `resolve()` never reads `rulesNode.cache` from a reactive context.
	let latestRules: ReadonlyArray<StratifyRule<T>> = rulesNode.cache ?? [];

	function resolve(actions: NodeActions): void {
		if (sourcePhase2) {
			sourcePhase2 = false;
			const value = sourceValue;
			sourceValue = _noValue;
			if (value !== _noValue) {
				const currentRule = latestRules.find((r) => r.name === rule.name);
				let matches = false;
				try {
					matches = currentRule?.classify(value) ?? false;
				} catch {
					matches = false;
				}
				if (matches) {
					pendingDirty = false;
					actions.emit(value);
				} else {
					if (pendingDirty) {
						pendingDirty = false;
						actions.down([[DIRTY], [RESOLVED]]);
					}
				}
			} else {
				if (pendingDirty) {
					pendingDirty = false;
					actions.down([[DIRTY], [RESOLVED]]);
				} else {
					actions.down([[RESOLVED]]);
				}
			}
		}
	}

	const filterNode = node<T>(
		[],
		(_data, filterActions) => {
			const srcUnsub = (source as Node).subscribe((msgs) => {
				for (const msg of msgs) {
					_handleStratifyMessage(msg, 0, filterActions);
				}
			});
			const rulesUnsub = (rulesNode as Node).subscribe((msgs) => {
				for (const msg of msgs) {
					_handleStratifyMessage(msg, 1, filterActions);
				}
			});
			return () => {
				srcUnsub();
				rulesUnsub();
			};
		},
		{
			describeKind: "derived",
			meta: { kind: "stratify_branch", branch: rule.name },
			completeWhenDepsComplete: false,
		} as NodeOptions<T>,
	);

	function _handleStratifyMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
		const t = msg[0];

		if (t === DIRTY) {
			if (depIndex === 0) {
				sourceDirty = true;
				pendingDirty = true;
			} else {
				rulesDirty = true;
			}
			return true;
		}

		if (t === DATA || t === RESOLVED) {
			if (depIndex === 0) {
				sourceDirty = false;
				sourcePhase2 = true;
				sourceValue = t === DATA ? (msg[1] as T) : _noValue;
			} else {
				if (t === DATA) {
					latestRules = msg[1] as ReadonlyArray<StratifyRule<T>>;
				}
				rulesDirty = false;
			}

			if (sourceDirty || rulesDirty) return true;

			resolve(actions);
			return true;
		}

		if (t === COMPLETE || t === ERROR || t === TEARDOWN) {
			sourceDirty = false;
			rulesDirty = false;
			sourcePhase2 = false;
			sourceValue = _noValue;
			pendingDirty = false;
			if (depIndex === 0) {
				actions.down([msg]);
			}
			return true;
		}

		if (depIndex === 1) return true;

		return false;
	}

	graph.add(filterNode as Node<unknown>, { name: branchName });

	if (rule.ops) {
		const transformed = rule.ops(filterNode);
		const transformedName = `branch/${rule.name}/out`;
		graph.add(transformed as Node<unknown>, { name: transformedName });
	}
}
