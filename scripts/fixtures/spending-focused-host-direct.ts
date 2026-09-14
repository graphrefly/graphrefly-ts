/** Explicit offline construction reference: same nodes and host, manual lifecycle orchestration. */
import {
	buildOfflineSpendingHost,
	OfflineAlertResource,
} from "../../examples/spending-alerts/causal-focused-host.js";
import {
	type SpendingBinding,
	type SpendingInputs,
	same,
	validateBinding,
} from "../../examples/spending-alerts/causal-inputs.js";
import { spendingNodeNames } from "../../examples/spending-alerts/causal-preset.js";
import {
	prepareConstruction,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";

export function directOfflineSpending(
	graph: Graph,
	inputs: Omit<SpendingInputs, "inbox">,
	rawBinding: SpendingBinding,
	resource: OfflineAlertResource,
	options: { name: string; diagnostics?: "off" | "summary" },
) {
	const binding = validateBinding(rawBinding);
	if (
		!(resource instanceof OfflineAlertResource) ||
		resource.kind !== "offline-alert-resource" ||
		!same(resource.binding, binding)
	)
		throw new TypeError("offline resource binding");
	const name = options.name;
	const scope = prepareConstruction(graph, {
		name,
		epoch: binding.compositionEpoch,
		names: [
			...spendingNodeNames(name, options.diagnostics),
			`${name}/hostFacts`,
			`${name}/hostGuard`,
			`${name}/runEndReady`,
			`${name}/hostPackFacts`,
		],
		inputs: [
			inputs.evaluations.pack,
			inputs.evaluations.arrivals,
			inputs.evaluations.current,
			inputs.verification.receipts,
			inputs.localAuthority.facts,
		],
	});
	const lease = resource.claim();
	try {
		const startup = scope.startupSource();
		const assembly = buildOfflineSpendingHost(
			graph,
			scope,
			startup,
			inputs,
			binding,
			lease,
			options,
		);
		const owner = scope.seal(startup, assembly.roots);
		scope.transferToGraph(owner);
		lease.transfer();
		startConstruction(graph, owner);
		assembly.afterStart(owner);
		return Object.freeze({
			consume: assembly.consume,
			owner,
			guard: assembly.guard,
			source: assembly.source,
			runEndReady: assembly.runEndReady,
			built: assembly.built,
			inspect: assembly.inspect,
			afterStart: assembly.afterStart,
		});
	} catch (error) {
		lease.abort();
		return scope.abort(error);
	}
}
