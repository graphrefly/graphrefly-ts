/** Passive offline fixtures; explicitly no qualified host, writer, or effect dispatch. */

import type {
	ArrivalFrame,
	CurrentFrame,
	Evaluation,
	EvaluationPack,
	InboxObservationFrame,
	LocalAuthorityFrame,
	SpendingBinding,
	SpendingInputs,
	VerificationFrame,
} from "../../examples/spending-alerts/causal-inputs.js";
import {
	buildSpendingPresetNodes,
	spendingInputNodes,
	spendingNodeNames,
} from "../../examples/spending-alerts/causal-preset.js";
import {
	type ConstructionScope,
	prepareConstruction,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import type {
	CausalEffectOutcome,
	RuntimeState,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	oracleBusiness,
	oracleCanonical,
	oracleFreeze,
	oracleHash,
	oracleRequest,
} from "./spending-preset-oracle.js";
export const fixtureHash = oracleHash(
	"explicit offline fixture; not a loaded-source or host attestation",
);
export const presetBinding: SpendingBinding = oracleFreeze({
	packRef: { kind: "offline-pack", id: "preset" },
	sourceDigest: fixtureHash,
	runtimeDigest: fixtureHash,
	destinationRef: { kind: "offline-inbox", id: "no-host" },
	compositionEpoch: 1,
	hostEpoch: 1,
	runRef: "preset-fixture",
	evidenceMode: "fixture-observations",
});
export function evaluationFixture(
	index = 0,
	vendor = "coffee",
	prefixLength = 2,
	flagged = true,
): Evaluation {
	const id = `evaluation-${vendor}-${index}`,
		prefix = Array.from({ length: prefixLength }, (_, i) => ({
			id: `${id}:tx${i}`,
			vendor,
			category: "coffee",
			amount: 100 + i * 40,
			timestampIso: "2026-09-09T00:00:00.000Z",
		}));
	const policy = { zThreshold: flagged ? 0.5 : 100, dailyRatioThreshold: 100 },
		profile = { dailyAverage: 100, typicalCategories: ["coffee"] },
		profileRef = { kind: "profile", id: "base" },
		policyRef = { kind: "policy", id: flagged ? "alert" : "normal" };
	const value = {
		evaluationRef: id,
		subjectRef: id,
		inputDigest: oracleHash(oracleCanonical({ profileRef, profile, prefix })),
		profileRef,
		profile,
		policyRef,
		policyDigest: oracleHash(oracleCanonical(policy)),
		policy,
		prefix,
	};
	const ref = {
		revisionDomain: `fixture-${vendor}`,
		occurrenceId: id,
		revision: index + 1,
		sourceRefs: [{ kind: "evaluation", id }],
	};
	const digest = oracleHash(
		oracleCanonical({
			schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
			...ref,
			value,
		}),
	);
	return oracleFreeze({ ...value, occurrence: { ...ref, digest } });
}
export function evaluationPack(
	evaluations: readonly Evaluation[],
	binding = presetBinding,
): EvaluationPack {
	return oracleFreeze({ format: "spending-input-v1", binding, evaluations });
}
export function policyFacts(e: Evaluation, binding = presetBinding) {
	const request = oracleRequest(e, binding),
		requestDigest =
			request?.body.payloadDigest ??
			oracleHash(oracleCanonical({ kind: "no-publish", evaluationRef: e.evaluationRef }));
	const current: CurrentFrame = {
		binding,
		current: [
			{
				revisionDomain: e.occurrence.revisionDomain,
				occurrence: e.occurrence,
				policyRef: e.policyRef,
				policyDigest: e.policyDigest,
				watermark: e.occurrence.revision,
			},
		],
	};
	const verification: VerificationFrame = {
		binding,
		receipts: [
			{
				receiptRef: { kind: "fixture-verification", id: e.evaluationRef },
				issuerRef: { kind: "fixture", id: "independent-two-pass-oracle" },
				verifierRevision: "spending-oracle-v1",
				occurrence: e.occurrence,
				inputDigest: e.inputDigest,
				policyDigest: e.policyDigest,
				sourceDigest: binding.sourceDigest,
				runtimeDigest: binding.runtimeDigest,
				requestDigest,
				numericDomainRef: "spending-finite-v1",
				verdict: "pass",
				artifactRef: { kind: "fixture-artifact", id: e.evaluationRef },
				artifactDigest: oracleHash(oracleCanonical(oracleBusiness(e))),
			},
		],
	};
	const local: LocalAuthorityFrame = {
		binding,
		tick: 1,
		stop: false,
		grants: [
			{
				grantRef: { kind: "fixture-grant", id: e.evaluationRef },
				ownerRef: { kind: "fixture-owner", id: "offline" },
				operation: "append-alert",
				occurrence: e.occurrence,
				requestDigest,
				destinationRef: binding.destinationRef,
				hostEpoch: binding.hostEpoch,
				validFrom: 0,
				validThrough: 100,
				maxWrites: 64,
				replayScope: { compositionEpoch: binding.compositionEpoch, hostEpoch: binding.hostEpoch },
				revoked: false,
			},
		],
	};
	const inbox: InboxObservationFrame = {
		binding,
		issuerRef: { kind: "fixture", id: "passive-boundary" },
		artifactRef: { kind: "fixture-artifact", id: "no-io" },
		artifactDigest: fixtureHash,
		readiness: { ready: true, observedAt: 0, validThrough: 100, availableSlots: 1 },
		outcomes: [],
	};
	return oracleFreeze({ current, verification, local, inbox, request });
}
export function presetRun(
	diagnostics: "off" | "summary" = "off",
	binding = presetBinding,
	inspect?: (scope: ConstructionScope) => void,
) {
	const graph = new Graph({ name: "spending-preset-fixture" });
	const sources = {
		pack: graph.node<EvaluationPack>([], null, { name: "pack" }),
		arrivals: graph.node<ArrivalFrame>([], null, { name: "arrivals" }),
		current: graph.node<CurrentFrame>([], null, { name: "current" }),
		verification: graph.node<VerificationFrame>([], null, { name: "verification" }),
		local: graph.node<LocalAuthorityFrame>([], null, { name: "local" }),
		inbox: graph.node<InboxObservationFrame>([], null, { name: "inbox" }),
	};
	const inputs: SpendingInputs = {
		evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
		verification: { receipts: sources.verification },
		localAuthority: { facts: sources.local },
		inbox: { facts: sources.inbox },
	};
	const scope = prepareConstruction(graph, {
			name: "spending",
			epoch: binding.compositionEpoch,
			names: spendingNodeNames("spending", diagnostics),
			inputs: spendingInputNodes(inputs),
		}),
		startup = scope.startupSource();
	inspect?.(scope);
	let built: ReturnType<typeof buildSpendingPresetNodes>;
	try {
		built = buildSpendingPresetNodes(
			graph,
			scope,
			startup,
			inputs,
			binding,
			"spending",
			diagnostics,
		);
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
		for (const [name, node] of Object.entries(built.consume.view))
			stops.push(
				node.subscribe((m) => {
					if (m[0] === "DATA") events[name].push(m[1]);
				}),
			);
		stops.push(
			built.consume.capabilities.execution.conservation.subscribe((m) => {
				if (m[0] === "DATA") events.conservation.push(m[1]);
			}),
		);
		if (built.diagnosticSummary)
			stops.push(
				built.diagnosticSummary.subscribe((m) => {
					if (m[0] === "DATA") events.summary.push(m[1]);
				}),
			);
	};
	const disconnect = () => {
		for (const stop of stops) stop();
		stops = [];
	};
	const send = (lane: keyof typeof sources, ...values: unknown[]) =>
		sources[lane].down(values.map((v) => ["DATA", v]));
	const drive = (e: Evaluation) => {
		const f = policyFacts(e, binding);
		send("current", f.current);
		send("verification", f.verification);
		send("local", f.local);
		send("inbox", f.inbox);
		send("arrivals", { packRef: binding.packRef, evaluationRefs: [e.evaluationRef] });
	};
	const state = () =>
		checkpointStateOfNode(graph.find("spending/causal/authority")!).ctxState
			?.value as RuntimeState<unknown>;
	const outcome = (stateName: CausalEffectOutcome["state"] = "succeeded"): CausalEffectOutcome => {
		const records = [...state().effects.values()],
			record = records.at(-1)!;
		if (!record?.admission) throw new Error("fixture has no admitted record");
		return {
			...record.proposal,
			admissionRef: record.admission.admissionRef,
			state: stateName,
			result:
				stateName === "succeeded"
					? { kind: "ok", value: { source: "fixture", io: false } }
					: {
							kind: "error",
							error: { kind: "issue", code: `fixture/${stateName}`, message: stateName },
						},
		};
	};
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
		inputs,
		sources,
		scope,
		startup,
		built,
		owner,
		events,
		send,
		drive,
		state,
		outcome,
		connect,
		disconnect,
		cleanup,
	};
}

/** Rebind an adversarial finite numeric fixture independently of candidate digest helpers. */
export function evaluationWithAmounts(amounts: readonly number[]): Evaluation {
	const base = evaluationFixture(0, "coffee", amounts.length);
	const { occurrence, ...initial } = base;
	const prefix = initial.prefix.map((t, i) => ({ ...t, amount: amounts[i] }));
	const value = {
		...initial,
		prefix,
		inputDigest: oracleHash(
			oracleCanonical({ profileRef: initial.profileRef, profile: initial.profile, prefix }),
		),
	};
	const { digest: _digest, ...ref } = occurrence;
	return oracleFreeze({
		...value,
		occurrence: {
			...ref,
			digest: oracleHash(
				oracleCanonical({
					schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
					...ref,
					value,
				}),
			),
		},
	});
}
