import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import * as packageRoot from "../index.js";
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
import * as focusedAgenticWorkItemMemory from "../solutions/agentic-work-item-memory/index.js";
import { agenticWorkItemMemoryBridgeBundle } from "../solutions/agentic-work-item-memory/index.js";
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
import * as solutionsAggregate from "../solutions/index.js";
import type { SolutionOccurrence } from "../solutions/occurrence.js";
import type { WorkItemProjection } from "../solutions/work-item/index.js";
import { occurrenceData, occurrenceFixture } from "./solution-occurrence-fixture.js";

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
	it("keeps the D151 occurrence lifecycle package-private", () => {
		const occurrenceName = "agenticWorkItemMemoryBridgeOccurrenceNode";
		expect(occurrenceName in focusedAgenticWorkItemMemory).toBe(false);
		expect(occurrenceName in packageRoot).toBe(false);
		expect(occurrenceName in solutionsAggregate).toBe(false);
	});

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

	it("exposes the real occurrence-aware bridge, admission, and application topology", () => {
		const g = graph();
		const policySources = g.state(
			[
				{
					kind: "agentic-memory-record-admission-policy-source" as const,
					sourceId: "static-policy",
					sourceKind: "static" as const,
					priority: 0,
					material: admissionPolicy(),
				},
			],
			{ name: "admissionPolicySources" },
		);
		const source = agenticMemoryRecordAdmissionPolicySourceBundle(g, {
			name: "policySource",
			policySources,
		});
		// This single source constructs a complete caller-owned snapshot. No latest-value fan-in.
		const occurrences = g.derived(
			[source.admissionPolicy],
			(admission) =>
				occurrenceFixture({
					workItem: workItem(),
					policy: mappingPolicy({ scoreRules: [] }),
					candidates: [explicitCandidate()],
					records: [],
					admissionPolicy: admission,
					applicationPolicy: applicationPolicy(),
					applicationPriorEvidence: [],
				}),
			{ name: "caller/complete-occurrence" },
		);
		const bundle = agenticWorkItemMemoryApplicationRecipeBundle(g, {
			name: "recipe",
			occurrences,
			maxOccurrences: 2,
			through: "application",
		});
		expectTypeOf(bundle).toMatchTypeOf<AgenticWorkItemMemoryApplicationRecipeBundle>();
		const observed = collect(bundle.records!);
		expect(
			occurrenceData<readonly AgenticMemoryRecord<string>[]>(observed.messages).at(-1),
		).toEqual([record()]);
		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "caller/complete-occurrence", to: "recipe/input" },
				{ from: "recipe/input", to: "recipe/bridge/projection" },
				{ from: "recipe/bridge/proposals", to: "recipe/admission-input/right" },
				{ from: "recipe/input", to: "recipe/admission-input/left" },
				{ from: "recipe/admission-input", to: "recipe/admission/projection" },
				{ from: "recipe/admission/admissions", to: "recipe/application-input/right" },
				{ from: "recipe/input", to: "recipe/application-input/left" },
				{ from: "recipe/application-input", to: "recipe/application/projection" },
				{ from: "recipe/application/projection", to: "recipe/application/records" },
			]),
		);
		expect(g.describe().edges).not.toContainEqual({
			from: "recipe/application/applicationDecisions",
			to: "recipe/application/projection",
		});
		observed.unsubscribe();
	});

	it("preserves initial multi-DATA snapshots through the complete two-join recipe", () => {
		const g = graph();
		const value = {
			workItem: workItem(),
			policy: mappingPolicy({ scoreRules: [] }),
			candidates: [explicitCandidate()],
			records: [],
			admissionPolicy: admissionPolicy(),
			applicationPolicy: applicationPolicy(),
			applicationPriorEvidence: [],
		};
		const first = occurrenceFixture(value);
		const second = {
			...first,
			occurrenceId: "initial-second",
			occurrenceDigest: `sha256:${"2".repeat(64)}`,
		};
		const occurrences = g.producer<SolutionOccurrence<typeof value>>((ctx) =>
			ctx.down([
				["DATA", first],
				["DATA", second],
			]),
		);
		const recipe = agenticWorkItemMemoryApplicationRecipeBundle(g, {
			name: "initial-recipe",
			occurrences,
			maxOccurrences: 2,
			through: "application",
		});
		const observed = collect(recipe.records!);
		expect(
			data<SolutionOccurrence<readonly AgenticMemoryRecord<string>[]>>(observed.messages).map(
				(frame) => [frame.occurrenceId, frame.value.length],
			),
		).toEqual([
			[first.occurrenceId, 1],
			[second.occurrenceId, 1],
		]);
		observed.unsubscribe();
	});
	it("preserves complete bridge occurrences across separate reordered waves", () => {
		const g = graph();
		type Input = Readonly<{
			readonly workItem: WorkItemProjection;
			readonly policy: AgenticWorkItemMemoryMappingPolicy<string>;
			readonly candidates: readonly AgenticWorkItemMemoryRecordCandidate<string>[];
		}>;
		const occurrences = g.node<SolutionOccurrence<Input>>([], null, {
			name: "occurrence/complete-bridge-input",
		});
		const projected = agenticWorkItemMemoryBridgeBundle(g, {
			occurrences,
			name: "occurrence/complete-bridge",
			maxOccurrences: 2,
		});
		const observed = collect(projected.projection);
		const makeOccurrence = (id: string, itemId: string): SolutionOccurrence<Input> =>
			Object.freeze({
				occurrenceId: id,
				occurrenceRevision: 1,
				occurrenceDigest: `sha256:${(id === "bridge-1" ? "1" : "2").repeat(64)}`,
				occurrenceSourceRefs: Object.freeze([{ kind: "work-item", id: itemId }]),
				value: Object.freeze({
					workItem: workItem({ workItemId: itemId, lastEventId: `${itemId}/event` }),
					policy: mappingPolicy({ policyId: `${itemId}/policy`, scoreRules: [] }),
					candidates: Object.freeze([
						explicitCandidate({
							candidateId: `${itemId}/candidate`,
							workItemId: itemId,
							candidateMaterial: material({
								record: record({
									id: `${itemId}/record`,
									fragment: {
										...record().fragment,
										id: `${itemId}/fragment`,
										sources: [itemId],
									},
								}),
							}),
						}),
					]),
				}),
			});
		const second = makeOccurrence("bridge-2", "wi-2");
		const first = makeOccurrence("bridge-1", "wi-1");
		occurrences.down([["DATA", second]]);
		occurrences.down([["DATA", first]]);
		const outputs = data<SolutionOccurrence<{ readonly proposals: readonly unknown[] }>>(
			observed.messages,
		);
		expect(outputs.map((output) => output.occurrenceId)).toEqual(["bridge-2", "bridge-1"]);
		expect(outputs.every((output) => output.value.proposals.length === 1)).toBe(true);
		occurrences.down([["DATA", second]]);
		expect(data(observed.messages)).toHaveLength(2);
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
