/** Shared offline integration fixture. Host exclusively owns inbox facts. */
import {
	composeOfflineSpending,
	OfflineAlertResource,
} from "../../examples/spending-alerts/causal-focused-host.js";
import type {
	ArrivalFrame,
	CurrentFrame,
	Evaluation,
	EvaluationPack,
	LocalAuthorityFrame,
	VerificationFrame,
} from "../../examples/spending-alerts/causal-inputs.js";
import { batch } from "../../packages/ts/src/batch/batch.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import type { RuntimeState } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { evaluationPack, policyFacts, presetBinding } from "./spending-preset-harness.js";
export async function drain() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}
function deferred() {
	let resolve!: (value: { bytesWritten: number }) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<{ bytesWritten: number }>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
export function inputsFor(graph: Graph) {
	const sources = {
		pack: graph.node<EvaluationPack>([], null, { name: "pack" }),
		arrivals: graph.node<ArrivalFrame>([], null, { name: "arrivals" }),
		current: graph.node<CurrentFrame>([], null, { name: "current" }),
		verification: graph.node<VerificationFrame>([], null, { name: "verification" }),
		local: graph.node<LocalAuthorityFrame>([], null, { name: "local" }),
	};
	return {
		sources,
		inputs: {
			evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
			verification: { receipts: sources.verification },
			localAuthority: { facts: sources.local },
		},
	};
}
export function runHost(
	mode: "off" | "summary" = "off",
	write?: (payload: string) => Promise<{ bytesWritten: number }>,
) {
	const graph = new Graph({ name: "focused-host-integration" });
	const { sources, inputs } = inputsFor(graph);
	const calls: string[] = [];
	const pending = deferred();
	const host = composeOfflineSpending(
		graph,
		inputs,
		presetBinding,
		new OfflineAlertResource(presetBinding, (payload) => {
			calls.push(payload);
			return write ? write(payload) : pending.promise;
		}),
		{ name: "spending", diagnostics: mode },
	);
	let subscriptions: (() => void)[] = [];
	const publications: unknown[] = [];
	const connect = () => {
		if (subscriptions.length) return;
		subscriptions = Object.entries(host.consume.view).map(([name, node]) =>
			node.subscribe((m) => {
				if (name === "publication" && m[0] === "DATA") publications.push(m[1]);
			}),
		);
	};
	const disconnect = () => {
		for (const stop of subscriptions) stop();
		subscriptions = [];
	};
	const send = (lane: keyof typeof sources, value: unknown) =>
		sources[lane].down([["DATA", value]]);
	const drive = (evaluations: readonly Evaluation[]) => {
		const facts = evaluations.map((e) => policyFacts(e));
		send("pack", evaluationPack(evaluations));
		batch(() => {
			send("current", { ...facts[0].current, current: facts.flatMap((f) => f.current.current) });
			send("verification", {
				...facts[0].verification,
				receipts: facts.flatMap((f) => f.verification.receipts),
			});
			send("local", { ...facts[0].local, grants: facts.flatMap((f) => f.local.grants) });
			send("arrivals", {
				packRef: presetBinding.packRef,
				evaluationRefs: evaluations.map((e) => e.evaluationRef),
			});
		});
	};
	const state = () =>
		checkpointStateOfNode(graph.find("spending/causal/authority")!).ctxState
			?.value as RuntimeState<unknown>;
	// Forced test teardown is not a successful normal end of the run lifecycle.
	const teardown = () => {
		disconnect();
		for (const root of host.owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
		group.release();
	};
	connect();
	return {
		graph,
		sources,
		host,
		calls,
		pending,
		publications,
		connect,
		disconnect,
		send,
		drive,
		state,
		teardown,
	};
}
