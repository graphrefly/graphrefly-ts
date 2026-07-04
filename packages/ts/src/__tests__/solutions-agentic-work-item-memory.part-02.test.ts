import { describe, expect, it } from "vitest";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordCandidateMaterial,
} from "../solutions/agentic-memory/index.js";
import {
	type AgenticWorkItemMemoryMappingPolicy,
	type AgenticWorkItemMemoryRecordCandidate,
	mapAgenticWorkItemMemoryBridge,
} from "../solutions/agentic-work-item-memory/index.js";
import type { WorkItemProjection } from "../solutions/work-item/index.js";

const workItem = (patch: Partial<WorkItemProjection> = {}): WorkItemProjection => ({
	workItemId: "wi-1",
	authoringRevision: 1,
	executionInputRevision: 1,
	lastEventId: "event-1",
	summary: "Remember outcome",
	...patch,
});

const record = (payload = "same material"): AgenticMemoryRecord<string> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	fragment: {
		id: "fragment-1",
		payload,
		tNs: 1n,
		confidence: 1,
		tags: ["work-item"],
		sources: ["wi-1"],
	},
});

const material = (payload?: string): AgenticMemoryRecordCandidateMaterial<string> => ({
	kind: "agentic-memory-record-candidate-material",
	operation: "create",
	operationVersion: 1,
	record: record(payload),
});

const policy = (
	patch: Partial<AgenticWorkItemMemoryMappingPolicy<string>> = {},
): AgenticWorkItemMemoryMappingPolicy<string> => ({
	kind: "agentic-work-item-memory-mapping-policy",
	policyId: "policy-1",
	...patch,
});

const explicit = (
	patch: Partial<AgenticWorkItemMemoryRecordCandidate<string>> = {},
): AgenticWorkItemMemoryRecordCandidate<string> => ({
	kind: "agentic-work-item-memory-record-candidate",
	candidateId: "candidate-1",
	workItemId: "wi-1",
	candidateMaterial: material(),
	...patch,
});

describe("agentic WorkItem memory bridge API boundaries (D582)", () => {
	it("suppresses duplicate explicit and generated candidates with identical material", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy({
				recordRules: [
					{
						ruleId: "candidate-1",
						candidateMaterialFrom: {
							input: "context",
							refId: "ctx-1",
							path: ["value"],
						},
					},
				],
			}),
			context: [
				{
					kind: "agentic-work-item-memory-context",
					contextId: "ctx-1",
					workItemId: "wi-1",
					value: material(),
				},
			],
			candidates: [
				explicit({
					sourceRefs: [{ kind: "agentic-work-item-memory-context", id: "ctx-1" }],
				}),
			],
		});

		expect(result.proposals).toHaveLength(1);
		expect(result.cursor.duplicateSuppressions).toBe(1);
		expect(result.cursor.candidateConflicts).toBe(0);
		expect(result.audit.map((entry) => entry.action)).toContain("duplicate-suppressed");
		expect(result.issues).toHaveLength(0);
	});

	it("reports candidate-conflict and emits no proposal for same coordinate with different material", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy({
				recordRules: [
					{
						ruleId: "candidate-1",
						candidateMaterialFrom: {
							input: "context",
							refId: "ctx-1",
							path: ["value"],
						},
					},
				],
			}),
			context: [
				{
					kind: "agentic-work-item-memory-context",
					contextId: "ctx-1",
					workItemId: "wi-1",
					value: material("generated material"),
				},
			],
			candidates: [
				explicit({
					candidateMaterial: material("explicit material"),
					sourceRefs: [{ kind: "agentic-work-item-memory-context", id: "ctx-1" }],
				}),
			],
		});

		expect(result.proposals).toHaveLength(0);
		expect(result.status.state).toBe("candidate-conflict");
		expect(result.cursor.candidateConflicts).toBe(1);
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.candidate-conflict",
		);
		expect(result.audit.map((entry) => entry.action)).toContain("candidate-conflict");
	});

	it("turns malformed policies and candidate coordinates into bridge DATA issues", () => {
		const badPolicy = {
			kind: "agentic-work-item-memory-mapping-policy",
			policyId: "policy-1",
			scoreRules: [
				{
					ruleId: "bad",
					dimension: "quality",
					value: 1,
					callback: () => 1,
				},
			],
		} as unknown as AgenticWorkItemMemoryMappingPolicy<string>;
		const badPolicyResult = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: badPolicy,
		});
		expect(badPolicyResult.status.state).toBe("blocked");
		expect(badPolicyResult.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"agentic-work-item-memory.policy-not-data",
				"agentic-work-item-memory.policy-forbidden-authority",
			]),
		);

		const badCandidateResult = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy(),
			candidates: [
				{
					kind: "agentic-work-item-memory-record-candidate",
					candidateId: "",
					workItemId: "",
					candidateMaterial: material(),
					sourceRefs: [{ kind: "", id: "" }],
				},
			],
		});
		expect(badCandidateResult.proposals).toHaveLength(0);
		expect(badCandidateResult.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"agentic-work-item-memory.missing-candidate-id",
				"agentic-work-item-memory.missing-work-item-id",
				"agentic-work-item-memory.invalid-source-coordinate",
			]),
		);
	});

	it("turns non-object and accessor policies into bridge DATA issues without throwing", () => {
		const nullPolicyResult = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: null as never,
		});
		expect(nullPolicyResult.status.state).toBe("blocked");
		expect(nullPolicyResult.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"agentic-work-item-memory.invalid-policy-kind",
				"agentic-work-item-memory.missing-policy-id",
			]),
		);

		const accessorPolicy = {
			kind: "agentic-work-item-memory-mapping-policy",
			policyId: "policy-1",
		};
		Object.defineProperty(accessorPolicy, "metadata", {
			enumerable: true,
			get() {
				throw new Error("must not invoke accessor");
			},
		});
		const accessorResult = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: accessorPolicy as never,
		});
		expect(accessorResult.status.state).toBe("blocked");
		expect(accessorResult.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.policy-not-data",
		);
	});

	it("rejects explicit candidates from the wrong bridge lane", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy(),
			candidates: [
				explicit({
					kind: "agentic-memory-record-candidate-material" as never,
				}),
			],
		});

		expect(result.proposals).toHaveLength(0);
		expect(result.status.state).toBe("partial");
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.invalid-candidate-kind",
		);
	});

	it("does not let selectors read evidence from a different WorkItem", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy({
				scoreRules: [
					{
						ruleId: "quality",
						dimension: "quality",
						valueFrom: { input: "evidence", refId: "ev-2", path: ["metadata", "quality"] },
					},
				],
			}),
			evidence: [
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "ev-2",
					workItemId: "wi-2",
					effectRunId: "run-2",
					effectRunResultId: "result-2",
					status: "completed",
					metadata: { quality: 1 },
				},
			],
		});

		expect(result.scoreSignals).toHaveLength(0);
		expect(result.status.state).toBe("partial");
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.selector-source-mismatch",
		);
	});

	it("rejects forbidden authority fields even when nested in policy metadata", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy({
				metadata: { providerHandle: "provider-1" },
			} as Partial<AgenticWorkItemMemoryMappingPolicy<string>>),
		});

		expect(result.status.state).toBe("blocked");
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.policy-forbidden-authority",
		);
	});

	it("reports malformed selectors as DATA issues instead of throwing", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy({
				scoreRules: [
					{
						ruleId: "bad-selector",
						dimension: "quality",
						valueFrom: { input: "evidence" } as never,
					},
				],
			}),
		});

		expect(result.scoreSignals).toHaveLength(0);
		expect(result.status.state).toBe("blocked");
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.invalid-selector",
		);
	});

	it("reports malformed candidate lanes as DATA issues instead of throwing", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy(),
			candidates: "not-candidates" as never,
		});

		expect(result.proposals).toHaveLength(0);
		expect(result.status.state).toBe("partial");
		expect(result.issues.map((issue) => issue.code)).toContain(
			"agentic-work-item-memory.invalid-input-array",
		);
	});

	it("keeps bridge read models local and out of admission/application lifecycle vocabulary", () => {
		const result = mapAgenticWorkItemMemoryBridge({
			workItem: workItem(),
			policy: policy(),
			candidates: [explicit()],
		});
		const bridgeReadModels = JSON.stringify({
			status: result.status,
			issues: result.issues,
			audit: result.audit,
			cursor: result.cursor,
		});
		expect(bridgeReadModels).not.toContain("admitted");
		expect(bridgeReadModels).not.toContain("applied");
		expect(bridgeReadModels).not.toContain("already-applied");
		expect(bridgeReadModels).not.toContain("rejected");
		expect(result.proposals).toHaveLength(1);
	});
});
