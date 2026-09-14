/** D171 source-bound finite proof worker. Default mode is injected memory, never inbox I/O. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { BusinessFrame } from "../../examples/spending-alerts/causal-business.js";
import { composeSpendingHost } from "../../examples/spending-alerts/causal-focused-host.js";
import type {
	SpendingBinding,
	VerificationFrame,
} from "../../examples/spending-alerts/causal-inputs.js";
import type { MaterialResult } from "../../examples/spending-alerts/causal-material-owner.js";
import {
	prepareLocalSpendingProofResource,
	prepareSpendingProofResourceWithIO,
} from "../../examples/spending-alerts/causal-resource.js";
import { batch } from "../../packages/ts/src/batch/batch.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import type {
	CausalQuiescence,
	CommittedEffectsView,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { inputsFor } from "./spending-focused-host-harness.js";
import { PlainSpendingProofHost } from "./spending-proof-plain-host.js";
import { proofScenarios } from "./spending-proof-scenarios.js";
import { type ProofTrace, verifyCandidate, verifyProofTrace } from "./spending-proof-verifier.js";

const config = JSON.parse(process.argv[2]) as {
	arm: "graph" | "plain";
	caseId: string;
	binding: SpendingBinding;
	path: string;
	mode: "memory" | "local";
};
if (!["memory", "local"].includes(config.mode)) throw new Error("invalid execution mode");
const scenario = proofScenarios(config.binding).find((s) => s.id === config.caseId);
assert.ok(scenario, "missing frozen scenario");
let bytes = Buffer.alloc(0);
const transport =
	config.mode === "local"
		? await prepareLocalSpendingProofResource(config.path, config.binding)
		: await prepareSpendingProofResourceWithIO(config.path, config.binding, {
				open: async () => ({
					writeBytes: async (chunk) => {
						bytes = Buffer.concat([bytes, chunk]);
						return { bytesWritten: chunk.length };
					},
					close: async () => {},
				}),
			});
const resource = transport.resource;
let graph: Graph | undefined;
let host: ReturnType<typeof composeSpendingHost> | undefined;
let plain: PlainSpendingProofHost | undefined;
const subscriptions: (() => void)[] = [];
try {
	graph = config.arm === "graph" ? new Graph({ name: "source-bound-proof" }) : undefined;
	const setup = graph ? inputsFor(graph) : undefined;
	host =
		graph && setup
			? composeSpendingHost(graph, setup.inputs, config.binding, resource, { name: "proof" })
			: undefined;
	const plainLease = host ? undefined : resource.claim();
	plainLease?.transfer();
	plain = plainLease
		? new PlainSpendingProofHost(config.binding, (payload) => plainLease.write(payload))
		: undefined;
	const business = new Map<string, unknown>(),
		materials = new Map<string, unknown>();
	let effects: CommittedEffectsView["effects"] = [];
	const obligations = new Map<string, CausalQuiescence>();
	if (host) {
		subscriptions.push(
			host.built.publication.causal.committedEffects.subscribe((m) => {
				if (m[0] === "DATA") effects = (m[1] as CommittedEffectsView).effects;
			}),
		);
		subscriptions.push(
			host.built.publication.causal.ports.quiescence.subscribe((m) => {
				if (m[0] === "DATA") {
					const q = m[1] as CausalQuiescence;
					obligations.set(q.revisionDomain, q);
				}
			}),
		);
		subscriptions.push(
			host.built.business.assessment.subscribe((m) => {
				if (m[0] === "DATA")
					for (const row of (m[1] as BusinessFrame<unknown>).rows)
						business.set(row.evaluation.evaluationRef, row.value);
			}),
		);
		subscriptions.push(
			host.built.materials.requestMaterials.subscribe((m) => {
				if (m[0] === "DATA")
					for (const row of (m[1] as BusinessFrame<MaterialResult>).rows)
						if (row.value.kind === "retained")
							materials.set(row.evaluation.evaluationRef, row.value.material);
			}),
		);
	}
	async function drain() {
		for (let i = 0; i < 32; i++) await Promise.resolve();
	}
	function capture() {
		if (plain) {
			const o = plain.observations();
			for (const [id, v] of o.assessments) business.set(id, v);
			for (const [id, v] of o.materials) materials.set(id, v);
		}
		return scenario!.evaluations
			.filter((e) => business.has(e.evaluationRef))
			.map((e) => ({
				evaluationRef: e.evaluationRef,
				business: business.get(e.evaluationRef),
				request: materials.get(e.evaluationRef) ?? null,
			}));
	}
	function current() {
		return host ? host.inspect() : plain!.inspect();
	}
	const checkpoints: { label: string; attemptedCalls: number; host: unknown }[] = [];
	await drain();
	for (const step of scenario.steps) {
		if (step.kind === "feed") {
			let value = step.value;
			if (step.lane === "verification") {
				const candidates = capture();
				const f = value as VerificationFrame;
				value = {
					...f,
					receipts: f.receipts.map((r) => {
						const e = scenario.evaluations.find((e) => e.occurrence.digest === r.occurrence.digest);
						const actual = e && candidates.find((c) => c.evaluationRef === e.evaluationRef);
						const verdict =
							e && actual && verifyCandidate(e, config.binding, actual).passed ? "pass" : "fail";
						return { ...r, verdict: r.verdict === "fail" ? "fail" : verdict };
					}),
				};
			}
			if (setup) batch(() => setup.sources[step.lane].down([["DATA", value as never]]));
			else plain!.feed(step.lane, value);
		} else if (step.kind === "drain") {
			await drain();
		} else if (step.kind === "settle") {
			await transport.settle(
				step.call,
				step.result === "short"
					? "short1"
					: step.result === "reject"
						? "reject-before-write"
						: "full",
			);
			await drain();
		} else if (step.kind === "checkpoint") {
			checkpoints.push({
				label: step.label,
				attemptedCalls: transport.attemptedPayloads.length,
				host: current(),
			});
		}
	}
	await drain();
	const state = current();
	const trace: ProofTrace = {
		candidates: capture(),
		attemptedPayloads: transport.attemptedPayloads,
		records: state.records,
		effects: plain ? plain.observations().effects : effects,
		obligations: plain ? plain.observations().obligations : [...obligations.values()],
		checkpoints: checkpoints.map(({ label, attemptedCalls }) => ({ label, attemptedCalls })),
		normalEndReady: state.normalEndReady,
	};
	const after = config.mode === "local" ? await readFile(config.path) : Buffer.from(bytes);
	const verdict = verifyProofTrace(scenario.evaluations, config.binding, scenario.expected, trace, {
		before: Buffer.alloc(0),
		after,
	});
	console.log(
		JSON.stringify({
			caseId: scenario.id,
			family: scenario.family,
			arm: config.arm,
			mode: resource.mode,
			transportAttempts: transport.transportAttempts,
			verdict,
			trace,
			checkpoints,
			topology: graph
				? {
						nodes: graph.describe().nodes.map((n) => ({ id: n.id, factory: n.factory })),
						edges: graph.describe().edges,
					}
				: null,
			readback: { before: [], after: [...after] },
		}),
	);
	if (!verdict.passed) process.exitCode = 1;
} finally {
	for (const stop of subscriptions) stop();
	if (host && graph) {
		for (const lease of host.owner.roots) lease.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
		group.release();
	}
	// A pending case remains pending evidence. Forced process teardown is not normal run completion.
	try {
		await resource.close();
	} catch (error) {
		if ((host?.inspect().inFlight ?? plain?.inspect().inFlight ?? 0) === 0) {
			console.error(error);
			process.exitCode = 1;
		}
	}
}
