import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import { stableJsonString } from "../json/codec.js";
import type { Message } from "../protocol/messages.js";
import type { ScoreSignal } from "../scoring/index.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordCandidateMaterial,
} from "../solutions/agentic-memory/index.js";
import {
	type AgenticWorkItemMemoryBridgeBundle,
	type AgenticWorkItemMemoryBridgeResult,
	type AgenticWorkItemMemoryMappingPolicy,
	type AgenticWorkItemMemoryRecordCandidate,
	agenticWorkItemMemoryBridgeBundle,
	mapAgenticWorkItemMemoryBridge,
} from "../solutions/agentic-work-item-memory/index.js";
import type { WorkItemProjection } from "../solutions/work-item/index.js";

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

const sourceCoordinate = (refs: readonly { kind: string; id: string; metadata?: unknown }[]) =>
	canonicalTupleKey(
		refs
			.map((ref) => canonicalTupleKey([ref.kind, ref.id, stableJsonString(ref.metadata ?? {})]))
			.sort(),
	);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

const workItem = (patch: Partial<WorkItemProjection> = {}): WorkItemProjection => ({
	workItemId: "wi-1",
	authoringRevision: 1,
	executionInputRevision: 2,
	lastEventId: "event-1",
	summary: "Ship bridge",
	priority: 4,
	sourceRefs: [{ kind: "issue", id: "issue-1" }],
	...patch,
});

const record = (payload = "learned fact"): AgenticMemoryRecord<string> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	fragment: {
		id: "fragment-1",
		payload,
		tNs: 1n,
		confidence: 0.9,
		tags: ["work-item"],
		sources: ["wi-1"],
	},
});

const material = (payload?: string): AgenticMemoryRecordCandidateMaterial<string> => ({
	kind: "agentic-memory-record-candidate-material",
	operation: "create",
	operationVersion: 1,
	record: record(payload),
	sourceRefs: [{ kind: "upstream", id: "candidate-source" }],
});

const policy = (
	patch: Partial<AgenticWorkItemMemoryMappingPolicy<string>> = {},
): AgenticWorkItemMemoryMappingPolicy<string> => ({
	kind: "agentic-work-item-memory-mapping-policy",
	policyId: "policy-1",
	scoreRules: [
		{
			ruleId: "quality",
			dimension: "quality",
			valueFrom: { input: "evidence", refId: "ev-1", path: ["metadata", "quality"] },
			confidence: 0.8,
			weight: 2,
		},
	],
	...patch,
});

describe("agentic WorkItem memory bridge (D581)", () => {
	it("maps WorkItem evidence into generic ScoreSignal and explicit candidate into proposal facts", () => {
		const candidate: AgenticWorkItemMemoryRecordCandidate<string> = {
			kind: "agentic-work-item-memory-record-candidate",
			candidateId: "candidate-1",
			workItemId: "wi-1",
			candidateMaterial: material(),
			sourceRefs: [{ kind: "explicit-candidate", id: "candidate-1" }],
		};
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy(),
			evidence: [
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "ev-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "result-1",
					status: "completed",
					sourceRefs: [{ kind: "effect-run", id: "run-1" }],
					metadata: { quality: 0.75 },
				},
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "ev-2",
					workItemId: "wi-1",
					effectRunId: "run-2",
					effectRunResultId: "result-2",
					status: "completed",
					sourceRefs: [{ kind: "effect-run", id: "run-2" }],
					metadata: { quality: 0.1 },
				},
			],
			candidates: [candidate],
			evaluation: 7,
		});

		expectTypeOf(result).toMatchTypeOf<AgenticWorkItemMemoryBridgeResult<string>>();
		expect(result.status.state).toBe("ready");
		expect(result.scoreSignals).toHaveLength(1);
		expect(result.scoreSignals[0]).toMatchObject<Partial<ScoreSignal>>({
			kind: "score-signal",
			subjectId: "wi-1",
			dimension: "quality",
			value: 0.75,
			confidence: 0.8,
			weight: 2,
		});
		const scoreCoordinateSource = sourceCoordinate([
			{
				kind: "work-item",
				id: "wi-1",
				metadata: { authoringRevision: 1, executionInputRevision: 2 },
			},
			{ kind: "issue", id: "issue-1" },
			{ kind: "work-item-evidence", id: "ev-1" },
			{ kind: "effect-run", id: "run-1" },
			{ kind: "effect-run-result", id: "result-1" },
		]);
		expect(result.scoreSignals[0]?.signalId).toBe(
			compoundTupleKey("agentic-work-item-memory-score-signal", [
				"policy-1",
				"wi-1",
				scoreCoordinateSource,
				"quality",
				"wi-1",
				"quality",
			]),
		);
		expect(result.scoreSignals[0]?.sourceRefs?.map((ref) => `${ref.kind}:${ref.id}`)).toEqual(
			expect.arrayContaining([
				"work-item:wi-1",
				"issue:issue-1",
				"work-item-evidence:ev-1",
				"effect-run:run-1",
				"effect-run-result:result-1",
			]),
		);
		expect(result.scoreSignals[0]?.sourceRefs?.map((ref) => `${ref.kind}:${ref.id}`)).not.toContain(
			"effect-run:run-2",
		);
		expect(result.proposals).toHaveLength(1);
		const coordinateSource = sourceCoordinate([
			{
				kind: "work-item",
				id: "wi-1",
				metadata: { authoringRevision: 1, executionInputRevision: 2 },
			},
			{ kind: "issue", id: "issue-1" },
			{ kind: "explicit-candidate", id: "candidate-1" },
			{ kind: "upstream", id: "candidate-source" },
		]);
		const coordinate = canonicalTupleKey([
			"policy-1",
			"wi-1",
			coordinateSource,
			"candidate-1",
			"create",
			"",
			"record-1",
		]);
		expect(result.proposals[0]?.proposalId).toBe(
			compoundTupleKey("agentic-work-item-memory-proposal", [coordinate]),
		);
		expect(result.proposals[0]?.idempotencyKey).toBe(
			canonicalTupleKey([
				"agentic-work-item-memory",
				"policy-1",
				"wi-1",
				coordinateSource,
				"candidate-1",
				"create",
				"",
				"record-1",
			]),
		);
		expect(result.proposals[0]?.correlationId).toBe(
			compoundTupleKey("agentic-work-item-memory-correlation", [
				"policy-1",
				"wi-1",
				coordinateSource,
			]),
		);
		expect(result.proposals[0]?.causationId).toBe(
			compoundTupleKey("agentic-work-item-memory-causation", [
				"policy-1",
				"wi-1",
				coordinateSource,
				"candidate-1",
			]),
		);
		expect(result.proposals[0]?.sourceRefs?.map((ref) => `${ref.kind}:${ref.id}`)).toEqual(
			expect.arrayContaining([
				"work-item:wi-1",
				"issue:issue-1",
				"agentic-work-item-memory-candidate:candidate-1",
				"explicit-candidate:candidate-1",
			]),
		);
		expect(result.cursor).toMatchObject({
			evaluation: 7,
			scoreSignals: 1,
			proposals: 1,
			issues: 0,
		});
		expect(result.audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(["score-signal-emitted", "record-proposal-emitted"]),
		);
	});

	it("exposes an explainable graph bundle over DATA inputs", () => {
		const g = graph();
		const workItems = g.state(workItem(), { name: "workItem" });
		const policies = g.state(policy({ scoreRules: [] }), { name: "policy" });
		const candidates = g.state<readonly AgenticWorkItemMemoryRecordCandidate<string>[]>([], {
			name: "candidates",
		});
		const bundle = agenticWorkItemMemoryBridgeBundle(g, {
			name: "bridge",
			workItem: workItems,
			policy: policies,
			candidates,
		});
		expectTypeOf(bundle).toMatchTypeOf<AgenticWorkItemMemoryBridgeBundle>();
		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "workItem", to: "bridge/projection" },
				{ from: "policy", to: "bridge/projection" },
				{ from: "candidates", to: "bridge/projection" },
				{ from: "bridge/projection", to: "bridge/proposals" },
				{ from: "bridge/projection", to: "bridge/status" },
			]),
		);

		const observed = collect(bundle.projection);
		candidates.set([
			{
				kind: "agentic-work-item-memory-record-candidate",
				candidateId: "candidate-1",
				workItemId: "wi-1",
				candidateMaterial: material(),
			},
		]);

		const latest = data<AgenticWorkItemMemoryBridgeResult<string>>(observed.messages).at(-1);
		observed.unsubscribe();
		expect(latest?.proposals).toHaveLength(1);
		expect(latest?.status.state).toBe("ready");
	});
});
