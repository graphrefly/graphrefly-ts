/** Offline entry for the independent Graph arm; each lane is actual DATA to a source node. */

import type {
	SpendingBinding,
	SpendingInputs,
} from "../../examples/spending-alerts/causal-inputs.js";
import {
	type ConstructionScope,
	prepareConstruction,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import { causalColdNodeNames } from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type { RuntimeState } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { buildReferencePreset, REFERENCE_BUSINESS_NAMES } from "./spending-preset-reference.js";
import type { ReferenceLane } from "./spending-preset-reference-input.js";
export function referenceRun(
	diagnostics: "off" | "summary",
	binding: SpendingBinding,
	inspect?: (scope: ConstructionScope) => void,
) {
	const graph = new Graph({ name: "spending-reference-fixture" });
	const sources = {
		pack: graph.node<any>([], null, { name: "pack" }),
		arrivals: graph.node<any>([], null, { name: "arrivals" }),
		current: graph.node<any>([], null, { name: "current" }),
		verification: graph.node<any>([], null, { name: "verification" }),
		local: graph.node<any>([], null, { name: "local" }),
		inbox: graph.node<any>([], null, { name: "inbox" }),
	};
	const inputs: SpendingInputs = {
		evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
		verification: { receipts: sources.verification },
		localAuthority: { facts: sources.local },
		inbox: { facts: sources.inbox },
	};
	const names = [
		"spending/startup",
		...REFERENCE_BUSINESS_NAMES.map((n) => `spending/reference/${n}`),
		...causalColdNodeNames("spending/causal"),
		"requestMaterialJoin",
		"publication",
		...(diagnostics === "summary" ? ["spending/reference/summary"] : []),
	];
	const scope = prepareConstruction(graph, {
			name: "spending",
			epoch: binding.compositionEpoch,
			names,
			inputs: Object.values(sources),
		}),
		startup = scope.startupSource();
	inspect?.(scope);
	let built: ReturnType<typeof buildReferencePreset>;
	try {
		built = buildReferencePreset(graph, scope, startup, inputs, binding, diagnostics);
	} catch (e) {
		return scope.abort(e);
	}
	const owner = scope.seal(startup, built.roots);
	scope.transferToGraph(owner);
	startConstruction(graph, owner);
	const events: Record<string, unknown[]> = {
		assessment: [],
		publication: [],
		coverage: [],
		issues: [],
		startup: [],
		conservation: [],
		summary: [],
	};
	let stops: (() => void)[] = [];
	const connect = () => {
		if (stops.length) return;
		for (const [name, node] of Object.entries(built.view))
			stops.push(
				node.subscribe((m) => {
					if (m[0] === "DATA") events[name].push(m[1]);
				}),
			);
		stops.push(
			built.capabilities.execution.conservation.subscribe((m) => {
				if (m[0] === "DATA") events.conservation.push(m[1]);
			}),
		);
		if (built.summary)
			stops.push(
				built.summary.subscribe((m) => {
					if (m[0] === "DATA") events.summary.push(m[1]);
				}),
			);
	};
	const disconnect = () => {
		for (const stop of stops) stop();
		stops = [];
	};
	const state = () =>
		checkpointStateOfNode(graph.find("spending/causal/authority")!).ctxState
			?.value as RuntimeState<unknown>;
	const send = (lane: ReferenceLane, ...values: unknown[]) =>
		sources[lane].down(values.map((v) => ["DATA", v]));
	const cleanup = () => {
		disconnect();
		for (const root of owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
	};
	connect();
	return {
		graph,
		sources,
		inputs,
		scope,
		startup,
		built,
		owner,
		events,
		connect,
		disconnect,
		state,
		send,
		cleanup,
	};
}
