/** Real cold assembly and finite offline inputs, shared wiring only (not verifier logic). */
import assert from "node:assert/strict";
import { buildSpendingPublication } from "../../examples/spending-alerts/causal-publication.js";
import type { NodeFn } from "../../packages/ts/src/ctx/types.js";
import { Dispatcher } from "../../packages/ts/src/dispatcher/index.js";
import {
	prepareConstruction,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import type { CausalBinding } from "../../packages/ts/src/solutions/causal-occurrence/capabilities.js";
import {
	causalColdNodeNames,
	prepareCausalOptions,
} from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type {
	CausalEffectOutcome,
	CausalOccurrenceBundleOptions,
	CommittedEffectsView,
	RuntimeState,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest } from "../../packages/ts/src/solutions/causal-occurrence/identity.js";
import {
	type OracleProfile,
	oracleCanonical,
	oracleFreeze,
	oracleHash,
	oracleMaterial,
	type oraclePublication,
	oracleSnapshot,
} from "./spending-publication-oracle.js";
import { buildReferencePublication } from "./spending-publication-reference.js";
export const publicationBinding: CausalBinding = Object.freeze({
	contract: "contract-v2",
	implementationRevision: "construction-v1",
	scope: "full",
	epoch: 1,
});
export const fixtureDigest = `sha256:${"b".repeat(64)}`;
export const publicationProfile: OracleProfile = oracleFreeze({
	packRef: { kind: "offline-pack", id: "finite" },
	destinationRef: { kind: "offline-inbox", id: "no-host" },
	sourceDigest: fixtureDigest,
	runtimeDigest: fixtureDigest,
	compositionEpoch: 1,
	hostEpoch: 1,
});
export function publicationFacts(id = "A", bytes = 0, revision = 1) {
	const raw = {
		revisionDomain: "d",
		occurrenceId: `o${revision}`,
		revision,
		sourceRefs: [
			{ kind: "input", id: `i${revision}` },
			{ kind: "policy", id: "p" },
		],
		value: revision,
	};
	const occurrence = { ...raw, digest: causalOccurrenceDigest(raw) };
	const { value: _, ...ref } = occurrence;
	const base = { transactionId: id, vendor: id, severity: "low" as const, message: "" };
	const payloadText = oracleCanonical({
		...base,
		message: "x".repeat(Math.max(0, bytes - Buffer.byteLength(oracleCanonical(base)))),
	});
	const { packRef: __, ...profile } = publicationProfile;
	const material = oracleMaterial({
		...profile,
		schema: "spending-alerts/request-material/v1" as const,
		occurrence: ref,
		effectId: `effect-${id}`,
		inputDigest: fixtureDigest,
		policyDigest: fixtureDigest,
		payloadText,
		payloadDigest: oracleHash(payloadText),
	});
	const proposal = {
		occurrence: ref,
		effectId: material.body.effectId,
		requestRef: material.requestRef,
		proposalDigest: material.proposalDigest,
	};
	const admission = {
		...proposal,
		admissionRef: { kind: "admission", id },
		state: "admitted" as const,
	};
	const outcome: CausalEffectOutcome = {
		...admission,
		state: "succeeded",
		result: { kind: "ok", value: { receipt: id } },
	};
	return oracleFreeze({ occurrence, material, proposal, admission, outcome });
}
export type HarnessFact = ReturnType<typeof publicationFacts>;
export type Arm = "production" | "reference";
export function publicationRun(
	arm: Arm,
	options: {
		capacity?: number;
		profile?: OracleProfile;
		observe?: boolean;
		capture?: boolean;
		fault?: boolean;
		foreignMaterial?: boolean;
	} = {},
) {
	const graph = new Graph({ dispatcher: new Dispatcher() });
	const sources = {
		occurrences: graph.node([], null, { name: "in/occurrences" }),
		admissions: graph.node([], null, { name: "in/admissions" }),
		branchTerminals: graph.node([], null, { name: "in/branchTerminals" }),
		effectProposals: graph.node([], null, { name: "in/effectProposals" }),
		effectAdmissions: graph.node([], null, { name: "in/effectAdmissions" }),
		effectOutcomes: graph.node([], null, { name: "in/effectOutcomes" }),
		evidence: graph.node([], null, { name: "in/evidence" }),
		watermarks: graph.node([], null, { name: "in/watermarks" }),
	};
	let currentMaterial: unknown;
	// The finite input owner persists its current pack outside UI subscription lifecycle.
	const material = graph.node(
		[],
		(ctx) => {
			if (currentMaterial !== undefined) ctx.down([["DATA", currentMaterial]]);
		},
		{ name: "material" },
	);
	const scope = prepareConstruction(graph, {
		name: "run",
		epoch: 1,
		names: ["run/startup", ...causalColdNodeNames("causal"), "requestMaterialJoin", "publication"],
		inputs: [...Object.values(sources), material],
	});
	const startup = scope.startupSource(),
		profile = options.profile ?? publicationProfile;
	const opts = {
		...sources,
		name: "causal",
		requiredBranches: ["one"],
		requiredEvidenceKinds: [],
		maxOccurrences: options.capacity ?? 64,
		maxEffects: options.capacity ?? 64,
		maxPending: 512,
		maxEvidence: 512,
	} as CausalOccurrenceBundleOptions<number>;
	const builder = arm === "production" ? buildSpendingPublication : buildReferencePublication;
	let joinFn: NodeFn | undefined;
	const original = scope.node.bind(scope);
	// Optional structural tests capture the actual fn; never used in timing arms.
	if (options.capture)
		scope.node = ((
			deps: readonly Node<unknown>[],
			fn: NodeFn | null,
			opts: Parameters<typeof scope.node>[2],
		) => {
			if (opts?.name === "requestMaterialJoin") joinFn = fn ?? undefined;
			return original(deps, fn, opts);
		}) as typeof scope.node;
	let foreign: Graph | undefined;
	if (options.foreignMaterial) foreign = new Graph();
	let built!:
		| ReturnType<typeof buildSpendingPublication<number>>
		| ReturnType<typeof buildReferencePublication<number>>;
	try {
		built = builder(
			graph,
			scope,
			startup,
			prepareCausalOptions(opts),
			publicationBinding,
			foreign ? foreign.node([], null, { name: "foreign" }) : material,
			profile,
		);
	} catch (error) {
		try {
			scope.abort(error);
		} catch {
			const group = graph.topologyGroup();
			for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
			group.release();
			if (foreign) {
				const group = foreign.topologyGroup();
				for (const n of foreign.describe().nodes) group.add(foreign.find(n.id)!);
				group.release();
			}
			throw error;
		}
	}
	if (options.capture) scope.node = original;
	const owner = scope.seal(startup, built.causal.roots);
	scope.transferToGraph(owner);
	if (options.fault) built.causal.roots[0].down([["ERROR", new Error("owned startup fault")]]);
	startConstruction(graph, owner);
	let latest: unknown,
		ui: (() => void) | undefined,
		observeStop: (() => void) | undefined,
		events = 0,
		summaryBytes = 0;
	let dataEvents = 0;
	const connect = () => {
		if (ui) return;
		if (options.observe)
			observeStop = graph.observe("publication").subscribe((event) => {
				events++;
				summaryBytes += Buffer.byteLength(JSON.stringify({ path: event.path, type: event.msg[0] }));
			});
		ui = built.publication.subscribe((m) => {
			if (m[0] === "DATA") {
				latest = m[1];
				dataEvents++;
			}
		});
	};
	const disconnect = () => {
		ui?.();
		ui = undefined;
		observeStop?.();
		observeStop = undefined;
	};
	const send = (lane: keyof typeof sources, ...values: unknown[]) =>
		sources[lane].down(values.map((v) => ["DATA", v]));
	const frames = (values: unknown[]) => {
		currentMaterial = values.at(-1);
		material.down(values.map((value) => ["DATA", value]));
	};
	const frame = (value: unknown) => {
		currentMaterial = value;
		material.down([["DATA", value]]);
	};
	const release = (f: HarnessFact) => {
		send("occurrences", f.occurrence);
		send("admissions", {
			occurrence: f.proposal.occurrence,
			decisionId: "decision",
			decisionDigest: fixtureDigest,
			state: "admitted",
		});
		send("watermarks", { revisionDomain: "d", revision: f.occurrence.revision });
	};
	const admit = (f: HarnessFact) => {
		release(f);
		send("effectProposals", f.proposal);
		send("effectAdmissions", f.admission);
	};
	const state = () =>
		checkpointStateOfNode(graph.find("causal/authority")!).ctxState?.value as
			| RuntimeState<number>
			| undefined;
	const close = () => {
		disconnect();
		for (const r of owner.roots) r.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
		assert.equal(graph.describe().nodes.length, 0);
	};
	return {
		graph,
		sources,
		material,
		scope,
		startup,
		built,
		owner,
		joinFn,
		connect,
		disconnect,
		send,
		frame,
		frames,
		release,
		admit,
		state,
		close,
		get latest() {
			return latest as ReturnType<typeof oraclePublication> | undefined;
		},
		get view() {
			return state()?.committedEffects as CommittedEffectsView | undefined;
		},
		stats: () => ({ events, summaryBytes, dataEvents }),
		snapshot: (facts: readonly HarnessFact[]) =>
			oracleSnapshot(
				profile,
				facts.map((f) => f.material),
			),
	};
}
