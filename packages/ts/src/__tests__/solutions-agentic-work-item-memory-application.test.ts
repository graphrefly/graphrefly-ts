import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Message } from "../protocol/messages.js";
import type { ScoreSignal } from "../scoring/index.js";
import type {
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmissionPolicy,
	AgenticMemoryRecordApplicationEvidence,
	AgenticMemoryRecordApplicationPolicy,
	AgenticMemoryRecordCandidateMaterial,
} from "../solutions/agentic-memory/index.js";
import { agenticMemoryRecordAdmissionPolicySourceBundle } from "../solutions/agentic-memory/index.js";
import type {
	AgenticWorkItemMemoryMappingPolicy,
	AgenticWorkItemMemoryRecordCandidate,
} from "../solutions/agentic-work-item-memory/types.js";
import {
	type AgenticWorkItemMemoryApplicationRecipeBundle,
	type AgenticWorkItemMemoryApplicationRecipeResult,
	agenticWorkItemMemoryApplicationRecipeBundle,
	mapAgenticWorkItemMemoryApplicationRecipe,
} from "../solutions/agentic-work-item-memory-application/index.js";
import type { WorkItemProjection } from "../solutions/work-item/index.js";

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

const workItem = (patch: Partial<WorkItemProjection> = {}): WorkItemProjection => ({
	workItemId: "wi-1",
	authoringRevision: 1,
	executionInputRevision: 1,
	lastEventId: "event-1",
	summary: "Remember tested WorkItem evidence",
	sourceRefs: [{ kind: "issue", id: "issue-1" }],
	...patch,
});

const record = (patch: Partial<AgenticMemoryRecord<string>> = {}): AgenticMemoryRecord<string> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	fragment: {
		id: "fragment-1",
		payload: "WorkItem evidence was useful",
		tNs: 1n,
		confidence: 0.9,
		tags: ["work-item"],
		sources: ["wi-1"],
	},
	...patch,
});

const material = (
	patch: Partial<AgenticMemoryRecordCandidateMaterial<string>> = {},
): AgenticMemoryRecordCandidateMaterial<string> => ({
	kind: "agentic-memory-record-candidate-material",
	operation: "create",
	operationVersion: 1,
	record: record(),
	sourceRefs: [{ kind: "work-item-evidence", id: "ev-1" }],
	...patch,
});

const mappingPolicy = (
	patch: Partial<AgenticWorkItemMemoryMappingPolicy<string>> = {},
): AgenticWorkItemMemoryMappingPolicy<string> => ({
	kind: "agentic-work-item-memory-mapping-policy",
	policyId: "bridge-policy",
	scoreRules: [
		{
			ruleId: "quality",
			dimension: "quality",
			valueFrom: { input: "evidence", refId: "ev-1", path: ["metadata", "quality"] },
			confidence: 0.8,
		},
	],
	...patch,
});

const explicitCandidate = (
	patch: Partial<AgenticWorkItemMemoryRecordCandidate<string>> = {},
): AgenticWorkItemMemoryRecordCandidate<string> => ({
	kind: "agentic-work-item-memory-record-candidate",
	candidateId: "candidate-1",
	workItemId: "wi-1",
	candidateMaterial: material(),
	sourceRefs: [{ kind: "explicit-candidate", id: "candidate-1" }],
	...patch,
});

const admissionPolicy = (
	patch: Partial<AgenticMemoryRecordAdmissionPolicy> = {},
): AgenticMemoryRecordAdmissionPolicy => ({
	kind: "agentic-memory-record-admission-policy",
	policyId: "admission-policy",
	defaultState: "admitted",
	...patch,
});

const applicationPolicy = (
	patch: Partial<AgenticMemoryRecordApplicationPolicy> = {},
): AgenticMemoryRecordApplicationPolicy => ({
	kind: "agentic-memory-record-application-policy",
	policyId: "application-policy",
	...patch,
});

const evidence = () =>
	[
		{
			kind: "work-item-evidence-recorded" as const,
			evidenceId: "ev-1",
			workItemId: "wi-1",
			effectRunId: "run-1",
			effectRunResultId: "result-1",
			status: "completed" as const,
			metadata: { quality: 0.72 },
		},
	] as const;

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) return sourceFiles(full);
		return full.endsWith(".ts") ? [full] : [];
	});
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const importsAgenticWorkItemMemory = (source: string): boolean =>
	/(?:from\s+["'][^"']*agentic-work-item-memory|import\s*\([^)]*["'][^"']*agentic-work-item-memory)/.test(
		source,
	);
const importsAgenticMemoryApplicationHistoryHelper = (source: string): boolean =>
	/projectAgenticMemoryRecordApplicationPriorEvidence|projectAgenticMemoryRecordApplicationEvidenceFacts|agenticMemoryRecordApplicationPriorEvidenceBundle|agenticMemoryRecordApplicationEvidenceFactsBundle/.test(
		source,
	);
const importsAgenticMemoryStoreFrameHelper = (source: string): boolean =>
	/AGENTIC_MEMORY_.*STORE_FRAME|AgenticMemory.*StoreFrame|agenticMemory.*StoreFrame|frameAgenticMemoryRecords|frameAgenticMemoryApplicationEvidence|frameAgenticMemoryApplicationDecisions|decodeAgenticMemoryRecordStoreFrame|decodeAgenticMemoryApplicationEvidenceStoreFrame|decodeAgenticMemoryApplicationDecisionStoreFrame/.test(
		source,
	);
const importsAgenticMemoryMaterializerHelper = (source: string): boolean =>
	/AgenticMemoryRecordMaterialization|AgenticMemoryRecordMaterializer|materializeAgenticMemoryRecordChanges|agenticMemoryRecordMaterializerBundle/.test(
		source,
	);

describe("agentic WorkItem memory application recipe wiring (D572/D576/D577/D581/D582/D587)", () => {
	it("maps evidence through the bridge, then admits and applies only through AgenticMemory helpers", () => {
		const result = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy(),
			evidence: evidence(),
			candidates: [explicitCandidate()],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
			evaluation: 11,
		});

		expectTypeOf(result).toMatchTypeOf<AgenticWorkItemMemoryApplicationRecipeResult<string>>();
		expect(result.scoreSignals).toHaveLength(1);
		expect(result.scoreSignals[0]).toMatchObject<Partial<ScoreSignal>>({
			kind: "score-signal",
			subjectId: "wi-1",
			dimension: "quality",
			value: 0.72,
		});
		expect(result.proposals).toHaveLength(1);
		expect(result.admission?.admitted).toHaveLength(1);
		expect(result.application?.records.map((item) => item.id)).toEqual(["record-1"]);
		expect(result.application?.applicationDecisions).toEqual([
			expect.objectContaining({
				state: "applied",
				reasonCode: "applied-create",
				proposalId: result.proposals[0]?.proposalId,
			}),
		]);
		expect(result.bridge.cursor).toMatchObject({ scoreSignals: 1, proposals: 1 });
	});

	it("keeps bridge-only mode available without admission or application inputs", () => {
		const result = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy(),
			evidence: evidence(),
			candidates: [explicitCandidate()],
		});

		expect(result.bridge.status.state).toBe("ready");
		expect(result.scoreSignals).toHaveLength(1);
		expect(result.proposals).toHaveLength(1);
		expect(result.admission).toBeUndefined();
		expect(result.application).toBeUndefined();
	});

	it("creates records only when AgenticMemory create semantics permit", () => {
		const current = [
			record({
				id: "record-1",
				fragment: {
					id: "fragment-current",
					payload: "already stored",
					tNs: 1n,
					confidence: 1,
					tags: [],
					sources: [],
				},
			}),
		];
		const result = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy(),
			candidates: [explicitCandidate()],
			records: current,
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
		});

		expect(result.admission?.rejected).toHaveLength(1);
		expect(result.application?.records).toEqual(current);
		expect(result.application?.applicationDecisions).toEqual([
			expect.objectContaining({
				state: "skipped",
				reasonCode: "skipped-non-admitted",
			}),
		]);
		expect(result.application?.appliedRecords).toHaveLength(0);
	});

	it("does not turn rejected or needs-review admission states into record truth", () => {
		for (const defaultState of ["rejected", "needs-review"] as const) {
			const result = mapAgenticWorkItemMemoryApplicationRecipe({
				workItem: workItem(),
				policy: mappingPolicy(),
				candidates: [explicitCandidate()],
				records: [],
				admissionPolicy: admissionPolicy({ defaultState }),
				applicationPolicy: applicationPolicy(),
			});

			expect(result.admission?.admissions[0]?.state).toBe(defaultState);
			expect(result.application?.records).toEqual([]);
			expect(result.application?.applicationDecisions).toEqual([
				expect.objectContaining({
					state: "skipped",
					reasonCode: "skipped-non-admitted",
				}),
			]);
		}
	});

	it("uses AgenticMemory idempotency evidence to prevent duplicate application", () => {
		const first = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy(),
			candidates: [explicitCandidate()],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
		});
		const decision = first.application?.applicationDecisions[0];
		const priorEvidence: AgenticMemoryRecordApplicationEvidence[] =
			decision?.materialIdentity === undefined
				? []
				: [
						{
							kind: "agentic-memory-record-application-evidence",
							admissionId: decision.admissionId,
							proposalId: decision.proposalId,
							operation: decision.operation,
							operationVersion: decision.operationVersion,
							idempotencyKey: decision.idempotencyKey,
							recordId: "record-1",
							fragmentId: "fragment-1",
							targetRecordId: "record-1",
							materialIdentity: decision.materialIdentity,
						},
					];
		const replay = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy(),
			candidates: [explicitCandidate()],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
			applicationPriorEvidence: priorEvidence,
		});

		expect(replay.application?.records).toEqual([]);
		expect(replay.application?.applicationDecisions).toEqual([
			expect.objectContaining({
				state: "skipped",
				reasonCode: "already-applied",
			}),
		]);
	});

	it("does not feed conflicted bridge candidates into downstream admission or application", () => {
		const result = mapAgenticWorkItemMemoryApplicationRecipe({
			workItem: workItem(),
			policy: mappingPolicy({
				recordRules: [
					{
						ruleId: "candidate-1",
						candidateMaterialFrom: { input: "context", refId: "ctx-1", path: ["value"] },
					},
				],
			}),
			context: [
				{
					kind: "agentic-work-item-memory-context",
					contextId: "ctx-1",
					workItemId: "wi-1",
					value: material({
						record: record({
							fragment: {
								id: "fragment-1",
								payload: "generated",
								tNs: 1n,
								confidence: 1,
								tags: [],
								sources: [],
							},
						}),
					}),
				},
			],
			candidates: [
				explicitCandidate({
					candidateMaterial: material({
						record: record({
							fragment: {
								id: "fragment-1",
								payload: "explicit",
								tNs: 1n,
								confidence: 1,
								tags: [],
								sources: [],
							},
						}),
					}),
					sourceRefs: [{ kind: "agentic-work-item-memory-context", id: "ctx-1" }],
				}),
			],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
		});

		expect(result.bridge.status.state).toBe("candidate-conflict");
		expect(result.proposals).toHaveLength(0);
		expect(result.admission?.admissions).toHaveLength(0);
		expect(result.application?.applicationDecisions).toHaveLength(0);
		expect(result.application?.records).toEqual([]);
	});

	it("exposes a graph-visible recipe without bridge-owned admission/application semantics", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const currentWorkItem = g.state(workItem(), { name: "workItem" });
		const policy = g.state(mappingPolicy({ scoreRules: [] }), { name: "bridgePolicy" });
		const candidates = g.state<readonly AgenticWorkItemMemoryRecordCandidate<string>[]>([], {
			name: "candidates",
		});
		const admissionSources = g.state(
			[
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "static-admission-policy",
					sourceKind: "static",
					priority: 0,
					material: admissionPolicy(),
				},
			] as const,
			{ name: "admissionPolicySources" },
		);
		const admissionSource = agenticMemoryRecordAdmissionPolicySourceBundle(g, {
			name: "admissionPolicySource",
			policySources: admissionSources,
		});
		const application = g.state(applicationPolicy(), { name: "applicationPolicy" });
		const priorEvidence = g.state<readonly AgenticMemoryRecordApplicationEvidence[]>([], {
			name: "applicationPriorEvidence",
		});
		const bundle = agenticWorkItemMemoryApplicationRecipeBundle(g, {
			name: "recipe",
			records,
			workItem: currentWorkItem,
			policy,
			candidates,
			admissionPolicy: admissionSource.admissionPolicy,
			applicationPolicy: application,
			applicationPriorEvidence: priorEvidence,
		});

		expectTypeOf(bundle).toMatchTypeOf<AgenticWorkItemMemoryApplicationRecipeBundle>();
		const edges = g.describe().edges;
		expect(edges).toEqual(
			expect.arrayContaining([
				{ from: "workItem", to: "recipe/bridge/projection" },
				{ from: "bridgePolicy", to: "recipe/bridge/projection" },
				{ from: "admissionPolicySources", to: "admissionPolicySource/projection" },
				{
					from: "admissionPolicySource/projection",
					to: "admissionPolicySource/admissionPolicy",
				},
				{ from: "admissionPolicySource/admissionPolicy", to: "recipe/admission/projection" },
				{ from: "recipe/bridge/proposals", to: "recipe/admission/projection" },
				{ from: "recipe/admission/admissions", to: "recipe/application/projection" },
				{ from: "applicationPriorEvidence", to: "recipe/application/projection" },
				{ from: "recipe/application/projection", to: "recipe/application/records" },
			]),
		);
		expect(edges).not.toEqual(
			expect.arrayContaining([
				{ from: "recipe/application/applicationDecisions", to: "recipe/application/projection" },
				{ from: "recipe/application/records", to: "recipe/application/projection" },
			]),
		);
		expect(bundle.input.admissionPolicy).toBe(admissionSource.admissionPolicy);
		expect(bundle.input.applicationPriorEvidence).toBe(priorEvidence);

		const observed = collect(bundle.records ?? bundle.proposals);
		candidates.set([explicitCandidate()]);
		expect(data<readonly AgenticMemoryRecord<string>[]>(observed.messages).at(-1)).toEqual([
			record(),
		]);
		observed.unsubscribe();
	});

	it("keeps WorkItem, AgenticMemory, and bridge cores independent of the application recipe", () => {
		for (const file of sourceFiles(join(srcRoot, "solutions/work-item"))) {
			const source = readFileSync(file, "utf8");
			expect(importsAgenticWorkItemMemory(source)).toBe(false);
			expect(importsAgenticMemoryApplicationHistoryHelper(source)).toBe(false);
			expect(importsAgenticMemoryStoreFrameHelper(source)).toBe(false);
			expect(importsAgenticMemoryMaterializerHelper(source)).toBe(false);
		}
		for (const file of sourceFiles(join(srcRoot, "solutions/agentic-memory"))) {
			expect(importsAgenticWorkItemMemory(readFileSync(file, "utf8"))).toBe(false);
		}
		for (const file of sourceFiles(join(srcRoot, "solutions/agentic-work-item-memory"))) {
			const source = readFileSync(file, "utf8");
			expect(importsAgenticMemoryApplicationHistoryHelper(source)).toBe(false);
			expect(importsAgenticMemoryStoreFrameHelper(source)).toBe(false);
			expect(importsAgenticMemoryMaterializerHelper(source)).toBe(false);
		}
	});
});
