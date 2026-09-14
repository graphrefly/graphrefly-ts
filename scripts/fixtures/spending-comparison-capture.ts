/** B121 offline observation adapter. No local-file preparation or participant execution. */
import assert from "node:assert/strict";
import { spendingAlertsFor } from "../../examples/spending-alerts/causal-entry.js";
import type { SpendingBinding } from "../../examples/spending-alerts/causal-inputs.js";
import { OfflineAlertResource } from "../../examples/spending-alerts/causal-resource.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import { inputsFor } from "./spending-focused-host-harness.js";
import { PlainSpendingProofHost } from "./spending-proof-plain-host.js";
import { proofEvaluation } from "./spending-proof-scenarios.js";
import { proofFacts } from "./spending-proof-verifier.js";

const binding = JSON.parse(process.argv[2]) as SpendingBinding;
const copy = (value: unknown) =>
	JSON.parse(
		JSON.stringify(value, (_key, item) => {
			if (item instanceof Map) return { collection: "Map", entries: [...item.entries()] };
			if (item instanceof Set) return { collection: "Set", values: [...item.values()] };
			return item;
		}),
	);
const drain = async () => {
	for (let i = 0; i < 32; i++) await Promise.resolve();
};
const results: unknown[] = [];
for (const arm of ["graph", "plain"] as const) {
	for (const caseId of (process.argv[3] === "C2" ? ["C2"] : ["C3", "C6"]) as (
		| "C2"
		| "C3"
		| "C6"
	)[]) {
		let beforeTransport: (() => void) | undefined;
		const writes: string[] = [];
		const pending: ((value: { bytesWritten: number }) => void)[] = [];
		const write = (payload: string) => {
			beforeTransport?.();
			writes.push(payload);
			return new Promise<{ bytesWritten: number }>((resolve) => pending.push(resolve));
		};
		const graph = arm === "graph" ? new Graph({ name: "comparison-memory" }) : undefined;
		const setup = graph ? inputsFor(graph) : undefined;
		const host =
			graph && setup
				? spendingAlertsFor(graph, { name: "proof" }).compose({
						...setup.inputs,
						inbox: { resource: new OfflineAlertResource(binding, write) },
					})
				: undefined;
		const plain = !host ? new PlainSpendingProofHost(binding, write) : undefined;
		const snapshots: unknown[] = [];
		let detach: (() => void)[] = [];
		let displayNotifications = 0;
		const connect = () => {
			assert.equal(detach.length, 0);
			detach = host
				? Object.values(host.view).map((n) => n.subscribe(() => displayNotifications++))
				: [plain!.observe(() => displayNotifications++)];
		};
		const disconnect = () => {
			for (const stop of detach) stop();
			detach = [];
		};
		const capture = (label: string) => {
			const state =
				host && graph
					? checkpointStateOfNode(graph.find("proof/causal/authority")!).ctxState?.value
					: plain!.observations();
			snapshots.push(
				copy({
					label,
					host: host ? host.inspect() : plain!.inspect(),
					authority: state,
					writes: writes.length,
					displayNotifications,
					displayConnected: detach.length > 0,
				}),
			);
		};
		beforeTransport = () => capture("writer-entry-before-transport");
		const feed = (
			lane: "pack" | "arrivals" | "current" | "verification" | "local",
			value: unknown,
		) => {
			if (setup) setup.sources[lane].down([["DATA", value as never]]);
			else plain!.feed(lane, value);
		};
		const one = proofEvaluation();
		const two = proofEvaluation({ revision: 2, dailyAverage: 101 });
		const evaluations = caseId === "C3" ? [one, two] : [one];
		try {
			connect();
			await drain();
			feed("pack", { format: "spending-input-v1", binding, evaluations });
			await drain();
			for (const e of evaluations) {
				const facts = proofFacts(e, binding);
				feed("current", facts.current);
				feed("local", facts.local);
				feed("arrivals", { packRef: binding.packRef, evaluationRefs: [e.evaluationRef] });
				await drain();
				capture(`before-verification-r${e.occurrence.revision}`);
				assert.equal(writes.length, e.occurrence.revision - 1);
				feed("verification", facts.verification);
				await drain();
				assert.equal(writes.length, e.occurrence.revision);
				capture(`admitted-r${e.occurrence.revision}`);
				pending[e.occurrence.revision - 1]({
					bytesWritten: caseId === "C6" ? 1 : Buffer.byteLength(writes[e.occurrence.revision - 1]),
				});
				await drain();
				capture(`outcome-r${e.occurrence.revision}`);
			}
			if (caseId === "C6") {
				const before = copy(host ? host.inspect() : plain!.inspect());
				assert.equal(before.normalEndReady, false);
				assert.equal(before.records.length, 1);
				assert.equal(before.records[0].outcome.state, "unknown");
				const authorityBefore = copy(
					host && graph
						? checkpointStateOfNode(graph.find("proof/causal/authority")!).ctxState?.value
						: plain!.observations(),
				);
				disconnect();
				await drain();
				capture("display-detached");
				assert.deepEqual(copy(host ? host.inspect() : plain!.inspect()), before);
				connect();
				await drain();
				capture("display-reattached");
				assert.deepEqual(copy(host ? host.inspect() : plain!.inspect()), before);
				assert.deepEqual(
					copy(
						host && graph
							? checkpointStateOfNode(graph.find("proof/causal/authority")!).ctxState?.value
							: plain!.observations(),
					),
					authorityBefore,
				);
				assert.equal(writes.length, 1);
			}
			results.push({
				arm,
				caseId,
				binding,
				evaluations,
				snapshots,
				writePayloads: writes,
				topology: graph ? graph.describe() : null,
				scope:
					caseId === "C3"
						? "External verification lane withheld. Internal synchronous business branches are NOT paused; no claim of missing internal branch coverage."
						: caseId === "C6"
							? "Injected one-byte short result, display disconnect/reconnect; retained host and authority unchanged. Memory only, no physical bytes."
							: "Equivalent loaded-source edit. Writer-entry snapshot precedes injected transport invocation; permission concerns physical transport, not a second admission.",
			});
		} finally {
			disconnect();
			if (host && graph) {
				for (const root of host.owner.roots) root.unsubscribe?.();
				const group = graph.topologyGroup();
				for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
				group.release();
			}
		}
	}
}
console.log(
	JSON.stringify({ kind: "b121-memory-checkpoints", realInboxIO: 0, participantRuns: 0, results }),
);
