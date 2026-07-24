import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { memoryAgenticMemoryPassiveStoreFrameAdapter } from "../adapters/index.js";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { MemoryAnswer, MemoryFragment } from "../patterns/index.js";
import type { Message } from "../protocol/messages.js";
import { indexedDbAgenticMemoryCommittedFactLogBackend } from "../solutions/agentic-memory/browser.js";
import { nodeFileAgenticMemoryCommittedFactLogBackend } from "../solutions/agentic-memory/node.js";
import {
	AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
	AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
	type AgenticMemoryCommittedFactLog,
	type AgenticMemoryCommittedFactLogAppendAttemptResult,
	type AgenticMemoryCommittedFactLogBackend,
	type AgenticMemoryCommittedFactLogBackendStatus,
	type AgenticMemoryCommittedFactLogStartupReadResult,
	type AgenticMemoryCommittedFactReadMaterializationProjection,
	type AgenticMemoryCommittedFactReadMaterializationStatus,
	type AgenticMemoryConsolidationCommand,
	type AgenticMemoryConsolidationError,
	type AgenticMemoryConsolidationOutcome,
	type AgenticMemoryConsolidationRecordDraft,
	type AgenticMemoryConsolidationRequest,
	type AgenticMemoryConsolidationStatus,
	type AgenticMemoryContext,
	type AgenticMemoryContextAttribution,
	type AgenticMemoryContextPackingError,
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextPackingStatus,
	type AgenticMemoryContextText,
	type AgenticMemoryDurabilityGateStatus,
	type AgenticMemoryFactCommitStatus,
	type AgenticMemoryKgAssertionDraft,
	type AgenticMemoryKgProjectionError,
	type AgenticMemoryMaterializedFactLogBootstrapStatus,
	type AgenticMemoryPackedContext,
	type AgenticMemoryProposalAdmissionDecision,
	type AgenticMemoryProposalAdmissionPolicy,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordAdmission,
	type AgenticMemoryRecordAdmissionPolicy,
	type AgenticMemoryRecordAdmissionPolicySourceProjection,
	type AgenticMemoryRecordAdmissionStatus,
	type AgenticMemoryRecordApplicationDecision,
	type AgenticMemoryRecordApplicationEvidence,
	type AgenticMemoryRecordApplicationMaterialIdentity,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordApplicationPriorEvidenceProjection,
	type AgenticMemoryRecordApplicationStatus,
	type AgenticMemoryRecordMaterializationProjection,
	type AgenticMemoryRecordMaterializationStatus,
	type AgenticMemoryRecordMaterializerBundle,
	type AgenticMemoryRecordProposal,
	type AgenticMemoryRecordStoreFrameProjection,
	type AgenticMemoryRetentionCommand,
	type AgenticMemoryRetentionError,
	type AgenticMemorySourceProjection,
	admitAgenticMemoryRecordProposals,
	agenticMemoryApplicationDecisionStoreFrameCodec,
	agenticMemoryApplicationEvidenceStoreFrameBundle,
	agenticMemoryApplicationEvidenceStoreFrameCodec,
	agenticMemoryBundle,
	agenticMemoryCommittedApplicationDecisionFact,
	agenticMemoryCommittedApplicationEvidenceFact,
	agenticMemoryCommittedFact,
	agenticMemoryCommittedFactBatch,
	agenticMemoryCommittedFactBatchCodec,
	agenticMemoryCommittedFactLogAppendAttempt,
	agenticMemoryCommittedFactLogBackendAdapter,
	agenticMemoryCommittedFactLogBackendCursor,
	agenticMemoryCommittedFactLogBackendStatus,
	agenticMemoryCommittedFactLogStartupRead,
	agenticMemoryCommittedFactReadMaterializationBundle,
	agenticMemoryCommittedFactSnapshot,
	agenticMemoryCommittedFactSnapshotTailEquivalent,
	agenticMemoryCommittedPriorEvidenceFact,
	agenticMemoryCommittedRecordMaterialFact,
	agenticMemoryConsolidationApplicationBundle,
	agenticMemoryConsolidationBundle,
	agenticMemoryContextPackingBundle,
	agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy,
	agenticMemoryDurabilityGateBundle,
	agenticMemoryDurabilityGateInput,
	agenticMemoryDurabilityResultMayAdvance,
	agenticMemoryDurabilityUncertainResolutionStatus,
	agenticMemoryFactCommitStatusIsDurable,
	agenticMemoryFactCommitStatusIsTerminalFailure,
	agenticMemoryKgProjectionBundle,
	agenticMemoryMaterializedFactLogBootstrapBundle,
	agenticMemoryMaterializedFactLogBootstrapInput,
	agenticMemoryRecordAdmissionBundle,
	agenticMemoryRecordAdmissionPolicySourceBundle,
	agenticMemoryRecordApplicationBundle,
	agenticMemoryRecordApplicationEvidenceFactsBundle,
	agenticMemoryRecordApplicationPriorEvidenceBundle,
	agenticMemoryRecordFrame,
	agenticMemoryRecordMaterializerBundle,
	agenticMemoryRecordStoreFrameBundle,
	agenticMemoryRecordStoreFrameCodec,
	agenticMemoryRetentionBundle,
	applyAgenticMemoryRecordAdmissions,
	assertAgenticMemoryCommittedFact,
	decodeAgenticMemoryApplicationDecisionStoreFrame,
	decodeAgenticMemoryApplicationEvidenceStoreFrame,
	decodeAgenticMemoryRecordStoreFrame,
	frameAgenticMemoryApplicationDecisions,
	frameAgenticMemoryApplicationEvidence,
	frameAgenticMemoryRecords,
	materializeAgenticMemoryCommittedFactSnapshotTail,
	materializeAgenticMemoryCommittedFacts,
	materializeAgenticMemoryRecordChanges,
	memoryAgenticMemoryCommittedFactLog,
	normalizeAgenticMemoryCommittedFactLogBackendAppendResult,
	normalizeAgenticMemoryCommittedFactLogBackendReadResult,
	projectAgenticMemoryCommittedFactReadMaterialization,
	projectAgenticMemoryDurabilityGate,
	projectAgenticMemoryMaterializedFactLogBootstrap,
	projectAgenticMemoryRecordAdmissionPolicySource,
	projectAgenticMemoryRecordApplicationEvidenceFacts,
	projectAgenticMemoryRecordApplicationPriorEvidence,
} from "../solutions/index.js";

const textDecoder = new TextDecoder();

async function withTempDir<T>(label: string, fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), `${label}-`));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const fragment = <T = string>(patch: Partial<MemoryFragment<T>> = {}): MemoryFragment<T> => ({
	id: "fact-1",
	payload: "payload" as T,
	tNs: 10n,
	confidence: 0.8,
	tags: ["project", "policy"],
	sources: [],
	...patch,
});

describe("AgenticMemory D585 passive store-frame helpers", () => {
	it("frames and decodes AgenticMemoryRecord arrays with strict DATA provenance preserved", () => {
		const sourceRefs = [{ kind: "agentic-memory-record", id: "record-store" }];
		const policyRefs = [{ kind: "agentic-memory-store-frame-policy", id: "policy-store" }];
		const stored = record({
			id: "record-store",
			fragment: fragment({
				id: "fragment-store",
				payload: { nested: ["strict", 1, true] },
				sources: ["source-a"],
			}),
		});

		const frame = frameAgenticMemoryRecords([stored], {
			sourceRefs,
			policyRefs,
			metadata: { batch: "import-1" },
		});
		const decoded = decodeAgenticMemoryRecordStoreFrame(frame);
		const codec = agenticMemoryRecordStoreFrameCodec();
		const roundTrip = codec.decode(codec.encode(frame));

		expect(frame).toMatchObject({
			format: "graphrefly.agenticMemoryRecordStoreFrame",
			version: 1,
			kind: "agentic-memory-record-store-frame",
			sourceRefs,
			policyRefs,
			metadata: { batch: "import-1" },
		});
		expect(frame.records[0]?.record.fragment.tNs).toBe("10");
		expect(decoded).toEqual([stored]);
		expect(roundTrip).toEqual(frame);
		expect(Object.isFrozen(frame.records)).toBe(true);
		expect(Object.isFrozen(frame.metadata)).toBe(true);
	});

	it("rejects accessor-backed store frames without executing getters", () => {
		let getterExecuted = false;
		const hostile: Record<string, unknown> = {
			version: 1,
			kind: "agentic-memory-record-store-frame",
			records: [],
		};
		Object.defineProperty(hostile, "format", {
			enumerable: true,
			get() {
				getterExecuted = true;
				return "graphrefly.agenticMemoryRecordStoreFrame";
			},
		});

		expect(() => decodeAgenticMemoryRecordStoreFrame(hostile)).toThrow(/data property/);
		expect(getterExecuted).toBe(false);

		for (const [field, decode, format, kind] of [
			[
				"records",
				decodeAgenticMemoryRecordStoreFrame,
				"graphrefly.agenticMemoryRecordStoreFrame",
				"agentic-memory-record-store-frame",
			],
			[
				"priorEvidence",
				decodeAgenticMemoryApplicationEvidenceStoreFrame,
				"graphrefly.agenticMemoryApplicationEvidenceStoreFrame",
				"agentic-memory-application-evidence-store-frame",
			],
			[
				"applicationDecisions",
				decodeAgenticMemoryApplicationDecisionStoreFrame,
				"graphrefly.agenticMemoryApplicationDecisionStoreFrame",
				"agentic-memory-application-decision-store-frame",
			],
		] as const) {
			let payloadGetterExecuted = false;
			const payloadHostile: Record<string, unknown> = { format, version: 1, kind };
			Object.defineProperty(payloadHostile, field, {
				enumerable: true,
				get() {
					payloadGetterExecuted = true;
					return [];
				},
			});

			expect(() => decode(payloadHostile)).toThrow(/data property/);
			expect(payloadGetterExecuted).toBe(false);
		}
	});

	it("frames and decodes application evidence, priorEvidence, and application decisions", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions([admitted()], applicationPolicy());
		const decisions = snapshot.applicationDecisions;
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(decisions);
		const evidenceFrame = frameAgenticMemoryApplicationEvidence(evidence.priorEvidence, {
			metadata: { phase: "later-evaluation-input" },
		});
		const decisionFrame = frameAgenticMemoryApplicationDecisions(decisions, {
			sourceRefs: [{ kind: "agentic-memory-record-application", id: "application-1" }],
		});
		const evidenceCodec = agenticMemoryApplicationEvidenceStoreFrameCodec();
		const decisionCodec = agenticMemoryApplicationDecisionStoreFrameCodec();

		expect(decodeAgenticMemoryApplicationEvidenceStoreFrame(evidenceFrame)).toEqual(
			evidence.priorEvidence,
		);
		expect(evidenceCodec.decode(evidenceCodec.encode(evidenceFrame))).toEqual(evidenceFrame);
		expect(decodeAgenticMemoryApplicationDecisionStoreFrame(decisionFrame)).toEqual(decisions);
		expect(decisionCodec.decode(decisionCodec.encode(decisionFrame))).toEqual(decisionFrame);
		expect(decisionFrame.applicationDecisions[0]).toHaveProperty("candidateMaterial.record.format");
		expect(evidenceFrame.priorEvidence.entries).toEqual(evidence.evidenceFacts);
	});

	it("rejects semantically malformed decision frames through the decision frame codec", () => {
		const codec = agenticMemoryApplicationDecisionStoreFrameCodec();
		const malformed = {
			format: "graphrefly.agenticMemoryApplicationDecisionStoreFrame",
			version: 1,
			kind: "agentic-memory-application-decision-store-frame",
			applicationDecisions: [{}],
		};

		expect(() => codec.decode(strictCanonicalJsonBytes(malformed))).toThrow(
			/decision\.applicationId must be non-empty/,
		);
	});

	it("rejects malformed skipped/rejected decisions and optional decision fields in decision frames", () => {
		const codec = agenticMemoryApplicationDecisionStoreFrameCodec();
		const snapshot = applyAgenticMemoryRecordAdmissions([admitted()], applicationPolicy());
		const frame = frameAgenticMemoryApplicationDecisions(snapshot.applicationDecisions);
		const decision = frame.applicationDecisions[0];
		if (decision === undefined) throw new Error("expected application decision fixture");

		const malformedSkipped = {
			...frame,
			applicationDecisions: [
				{
					...decision,
					state: "skipped",
					candidateMaterial: {
						...decision?.candidateMaterial,
						kind: "wrong",
					},
				},
			],
		};
		const malformedOptional = {
			...frame,
			applicationDecisions: [{ ...decision, idempotencyKey: 123 }],
		};

		expect(() => codec.decode(strictCanonicalJsonBytes(malformedSkipped))).toThrow(
			/candidateMaterial\.kind/,
		);
		expect(() => codec.decode(strictCanonicalJsonBytes(malformedOptional))).toThrow(
			/idempotencyKey/,
		);
	});

	it("rejects unknown top-level fields and forbidden metadata in store frames", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions([admitted()], applicationPolicy());
		const decisions = snapshot.applicationDecisions;
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(decisions);
		const recordsFrame = frameAgenticMemoryRecords([record()]);
		const evidenceFrame = frameAgenticMemoryApplicationEvidence(evidence.priorEvidence);
		const decisionFrame = frameAgenticMemoryApplicationDecisions(decisions);

		expect(() =>
			decodeAgenticMemoryRecordStoreFrame({ ...recordsFrame, storageHandle: "hidden" }),
		).toThrow(/unexpected fields/);
		expect(() =>
			decodeAgenticMemoryApplicationEvidenceStoreFrame({ ...evidenceFrame, commitAck: true }),
		).toThrow(/unexpected fields/);
		expect(() =>
			decodeAgenticMemoryApplicationDecisionStoreFrame({ ...decisionFrame, backend: "x" }),
		).toThrow(/unexpected fields/);
		expect(() =>
			frameAgenticMemoryRecords([record()], { metadata: { storageHandle: "hidden" } }),
		).toThrow(/not graph-visible DATA/);
		expect(() =>
			frameAgenticMemoryApplicationEvidence(evidence.priorEvidence, {
				metadata: { hydrate: true },
			}),
		).toThrow(/not graph-visible DATA/);
		expect(() =>
			frameAgenticMemoryApplicationDecisions(decisions, { metadata: { commit: "ack" } }),
		).toThrow(/not graph-visible DATA/);
	});

	it("keeps malformed frames on the DATA issue path in graph bundles", () => {
		const g = graph();
		const malformed = g.state(
			{
				format: "graphrefly.agenticMemoryRecordStoreFrame",
				version: 1,
				kind: "agentic-memory-record-store-frame",
				records: [{ nope: true }],
			},
			{ name: "storeFrame" },
		);
		const bundle = agenticMemoryRecordStoreFrameBundle(g, {
			name: "d585RecordFrame",
			storeFrame: malformed,
		});
		const projection = collect(bundle.projection);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		malformed.set(malformed.cache);

		expect(projection.messages.map((message) => message[0])).not.toContain("ERROR");
		expect(data<AgenticMemoryRecordStoreFrameProjection>(projection.messages).at(-1)).toMatchObject(
			{
				kind: "agentic-memory-record-store-frame-projection",
				records: [],
			},
		);
		expect(data(status.messages).at(-1)).toMatchObject({ state: "error" });
		expect(data<readonly { code: string }[]>(issues.messages).at(-1)?.[0]?.code).toBe(
			"agentic-memory.record-store-frame.invalid",
		);
		expect(g.describe().edges).toContainEqual({
			from: "storeFrame",
			to: "d585RecordFrame/projection",
		});
		expect(g.describe().edges).toContainEqual({
			from: "d585RecordFrame/projection",
			to: "d585RecordFrame/records",
		});
	});

	it("keeps malformed evidence frames on the DATA issue path in graph bundles", () => {
		const g = graph();
		const malformed = g.state(
			{
				format: "graphrefly.agenticMemoryApplicationEvidenceStoreFrame",
				version: 1,
				kind: "agentic-memory-application-evidence-store-frame",
				priorEvidence: { kind: "wrong", entries: [] },
			},
			{ name: "evidenceStoreFrame" },
		);
		const bundle = agenticMemoryApplicationEvidenceStoreFrameBundle(g, {
			name: "d585EvidenceFrameInvalid",
			storeFrame: malformed,
		});
		const projection = collect(bundle.projection);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		malformed.set(malformed.cache);

		expect(projection.messages.map((message) => message[0])).not.toContain("ERROR");
		expect(data(status.messages).at(-1)).toMatchObject({ state: "error" });
		expect(data<readonly { code: string }[]>(issues.messages).at(-1)?.[0]?.code).toBe(
			"agentic-memory.application-evidence-store-frame.invalid",
		);
		expect(data(projection.messages).at(-1)).toMatchObject({
			kind: "agentic-memory-application-evidence-store-frame-projection",
			evidenceFacts: [],
		});
	});

	it("decodes application evidence frames as ordinary DATA without storage or application authority", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions([admitted()], applicationPolicy());
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			snapshot.applicationDecisions,
		);
		const frame = frameAgenticMemoryApplicationEvidence(evidence.evidenceFacts);
		const g = graph();
		const frameNode = g.state(frame, { name: "evidenceStoreFrame" });
		const bundle = agenticMemoryApplicationEvidenceStoreFrameBundle(g, {
			name: "d585EvidenceFrame",
			storeFrame: frameNode,
		});
		const priorEvidence = collect(bundle.priorEvidence);
		const evidenceFacts = collect(bundle.evidenceFacts);

		frameNode.set(frame);

		expect(data(priorEvidence.messages).at(-1)).toEqual(evidence.priorEvidence);
		expect(data(evidenceFacts.messages).at(-1)).toEqual(evidence.evidenceFacts);
		const dtoText = JSON.stringify({
			recordFrame: frameAgenticMemoryRecords([record()]),
			evidenceFrame: frame,
		});
		expect(dtoText).not.toMatch(
			/storageHandle|graphHandle|nodeHandle|providerHandle|runtimeHandle|"hydrate"|"restore"|"persist"|"commit"|"ack"|"adapter"|"backend"|"loader"|"writer"|"engine"/,
		);
		expect(dtoText).not.toMatch(/application-decision/);
	});

	it("persists encoded frames outside the graph and re-enters decoded records only as explicit DATA", async () => {
		const adapter = memoryAgenticMemoryPassiveStoreFrameAdapter();
		const firstEvaluation = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d585-boundary", proposalId: "d585-boundary" })],
			applicationPolicy(),
		);
		const applicationRecords = firstEvaluation.records;
		const frame = frameAgenticMemoryRecords(applicationRecords, {
			metadata: { boundary: "explicit-host-storage-event" },
		});
		const codec = agenticMemoryRecordStoreFrameCodec();

		const write = await adapter.write(codec.encode(frame));
		const read = await adapter.read();
		const decodedRecords = decodeAgenticMemoryRecordStoreFrame(codec.decode(read.frames[0]!));
		const later = graph();
		const records = later.state<readonly AgenticMemoryRecord<string>[]>([], {
			name: "loadedRecords",
		});
		const query = later.state({ tags: ["policy"] }, { name: "query" });
		const memory = agenticMemoryBundle(later, { name: "laterMemory", records, query });
		const projected = collect(memory.records);

		records.set(decodedRecords);

		expect(write.status.state).toBe("ready");
		expect(read.status.state).toBe("ready");
		expect(write.audit).toEqual([
			expect.objectContaining({ action: "frame-received", frameIndex: 0 }),
		]);
		expect(read.audit).toEqual([expect.objectContaining({ action: "frames-read" })]);
		expect(decodedRecords).toEqual(applicationRecords);
		expect(data<readonly AgenticMemoryRecord<string>[]>(projected.messages).at(-1)).toEqual(
			applicationRecords,
		);
		expect(later.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "loadedRecords", to: "laterMemory/projection" },
				{ from: "laterMemory/projection", to: "laterMemory/records" },
			]),
		);
		expect(JSON.stringify({ write, read })).not.toMatch(
			/commit|commitAck|hydrate|hydration|restore|truth/i,
		);
		expect(firstEvaluation.applicationDecisions).toEqual([
			expect.objectContaining({ state: "applied", admissionId: "d585-boundary" }),
		]);
	});

	it("does not mutate records while framing", () => {
		const original = record({
			id: "record-mutability",
			fragment: fragment({ id: "fragment-mutability", payload: { value: "before" } }),
		});
		const before = structuredClone({
			...original,
			fragment: { ...original.fragment, tNs: original.fragment.tNs.toString() },
		});

		frameAgenticMemoryRecords([original]);

		expect({
			...original,
			fragment: { ...original.fragment, tNs: original.fragment.tNs.toString() },
		}).toEqual(before);
	});
});

describe("AgenticMemory D589 committed fact-log contract", () => {
	it("rejects empty committed fact batches before append semantics exist", () => {
		expect(() => agenticMemoryCommittedFactBatch([])).toThrow(/facts is empty/);
	});

	it("commits canonical facts as whole batches and reads them by fact-stream cursor only", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const first = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d589-a", fragment: fragment({ id: "fragment-d589-a" }) }),
			{ operation: "create", sourceRefs: [{ kind: "application", id: "application-1" }] },
		);
		const second = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d589-b", fragment: fragment({ id: "fragment-d589-b" }) }),
			{ operation: "create", sourceRefs: [{ kind: "application", id: "application-1" }] },
		);
		const batch = agenticMemoryCommittedFactBatch([first, second]);
		const codec = agenticMemoryCommittedFactBatchCodec();

		const committed = await log.append(codec.decode(codec.encode(batch)));
		const page0 = await log.read();
		const page1 = await log.read({
			after: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});

		expect(committed).toMatchObject({
			status: "committed",
			facts: 2,
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			issues: [],
		});
		expect(page0.facts).toEqual([first, second]);
		expect(page0.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
		expect(page1.facts).toEqual([second]);
		expect(page1.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
		expect(JSON.stringify(committed.cursor)).not.toMatch(
			/graph|wave|application|backend|row|policy/i,
		);
	});

	it("treats duplicate identity+material as idempotent duplicate", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d589-duplicate",
				fragment: fragment({ id: "fragment-d589-duplicate" }),
			}),
			{ operation: "create" },
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);

		const first = await log.append(batch);
		const duplicate = await log.append(batch);
		const read = await log.read();

		expect(first.status).toBe("committed");
		expect(duplicate.status).toBe("duplicate");
		expect(agenticMemoryFactCommitStatusIsDurable(duplicate.status)).toBe(true);
		expect(read.facts).toEqual([fact]);
	});

	it("reports same identity with different material as conflict and chooses no winner", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const original = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d589-conflict", fragment: fragment({ id: "fragment-d589-original" }) }),
			{ operation: "create", correlationId: "same-coordinate" },
		);
		const conflicting = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d589-conflict",
				fragment: fragment({ id: "fragment-d589-conflicting", payload: "different" }),
			}),
			{ operation: "create", correlationId: "same-coordinate" },
		);

		await log.append(agenticMemoryCommittedFactBatch([original]));
		const conflict = await log.append(agenticMemoryCommittedFactBatch([conflicting]));
		const read = await log.read();

		expect(original.identity).toEqual(conflicting.identity);
		expect(original.materialIdentity).not.toEqual(conflicting.materialIdentity);
		expect(conflict.status).toBe("conflict");
		expect(agenticMemoryFactCommitStatusIsTerminalFailure(conflict.status)).toBe(true);
		expect(read.facts).toEqual([original]);
		expect(materializeAgenticMemoryCommittedFacts(read.facts).records).toEqual([
			record({ id: "record-d589-conflict", fragment: fragment({ id: "fragment-d589-original" }) }),
		]);
	});

	it("rejects validation/precondition failures without committing any fact", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d589-rejected", fragment: fragment({ id: "fragment-d589-rejected" }) }),
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const malformed = {
			...batch,
			batchIdentity: { ...batch.batchIdentity, key: "not-the-canonical-batch-identity" },
		};
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			applyAgenticMemoryRecordAdmissions(
				[admitted({ admissionId: "d589-invalid-evidence", proposalId: "d589-invalid-evidence" })],
				applicationPolicy(),
			).applicationDecisions,
		).evidenceFacts[0]!;
		const evidenceFact = agenticMemoryCommittedApplicationEvidenceFact(evidence);
		const malformedEvidence = {
			...agenticMemoryCommittedFactBatch([evidenceFact]),
			facts: [
				{
					...evidenceFact,
					material: {
						...evidenceFact.material,
						evidence: { ...evidence, admissionId: "" },
					},
				},
			],
		};
		const priorFact = agenticMemoryCommittedPriorEvidenceFact(
			{ kind: "agentic-memory-record-application-prior-evidence", entries: [evidence] },
			{ subjectId: "prior-d589-invalid" },
		);
		const malformedPriorEvidence = {
			...agenticMemoryCommittedFactBatch([priorFact]),
			facts: [
				{
					...priorFact,
					material: {
						...priorFact.material,
						priorEvidence: {
							kind: "agentic-memory-record-application-prior-evidence",
							entries: [{ ...evidence, proposalId: "" }],
						},
					},
				},
			],
		};

		const result = await log.append(malformed as never);
		const evidenceResult = await log.append(malformedEvidence as never);
		const priorResult = await log.append(malformedPriorEvidence as never);
		const read = await log.read();

		expect(result.status).toBe("rejected");
		expect(evidenceResult.status).toBe("rejected");
		expect(priorResult.status).toBe("rejected");
		expect(result.issues[0]?.code).toBe("agentic-memory.fact-log.batch-rejected");
		expect(read.facts).toEqual([]);
	});

	it("rejects non-canonical identity algorithms, coordinate fields, and family/material mismatches", () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d589-canonical",
				fragment: fragment({ id: "fragment-d589-canonical" }),
			}),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			applyAgenticMemoryRecordAdmissions(
				[admitted({ admissionId: "d589-family", proposalId: "d589-family" })],
				applicationPolicy(),
			).applicationDecisions,
		).evidenceFacts[0]!;

		expect(() =>
			assertAgenticMemoryCommittedFact({
				...fact,
				identity: { ...fact.identity, algorithm: "backend-row-id" },
			}),
		).toThrow(/identity/);
		expect(() =>
			agenticMemoryCommittedFact(
				"record-material",
				{ subjectId: "bad-scope", scope: "x" } as never,
				{
					kind: "agentic-memory-committed-record-material",
					record: fact.material.record,
				},
			),
		).toThrow(/scope/);
		expect(() =>
			agenticMemoryCommittedFact(
				"record-material",
				{ subjectId: "family-mismatch" },
				{ kind: "agentic-memory-committed-application-evidence-material", evidence },
			),
		).toThrow(/material kind/);
	});

	it("rejects cursors that are not AgenticMemory fact-stream cursors", () => {
		const log = memoryAgenticMemoryCommittedFactLog();

		expect(() => log.read({ after: 0 as never })).toThrow(/cursor must be an object/);
		expect(() =>
			log.read({ after: { kind: "application-version", position: 0 } as never }),
		).toThrow(/fact-stream cursor/);
	});

	it("keeps uncertain distinct from durable success and terminal failure", () => {
		const statuses: readonly AgenticMemoryFactCommitStatus[] = [
			"committed",
			"duplicate",
			"conflict",
			"rejected",
			"uncertain",
		];

		expect(statuses.filter(agenticMemoryFactCommitStatusIsDurable)).toEqual([
			"committed",
			"duplicate",
		]);
		expect(statuses.filter(agenticMemoryFactCommitStatusIsTerminalFailure)).toEqual([
			"conflict",
			"rejected",
		]);
		expect(agenticMemoryFactCommitStatusIsDurable("uncertain")).toBe(false);
		expect(agenticMemoryFactCommitStatusIsTerminalFailure("uncertain")).toBe(false);
	});

	it("commits application-emitted graph DATA only as canonical facts, not application acks", async () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state([admitted({ admissionId: "d589-app", proposalId: "d589-app" })], {
			name: "admissions",
		});
		const policy = g.state(applicationPolicy(), { name: "policy" });
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "d589Application",
			records,
			admissions,
			policy,
		});
		const decisions = collect(application.applicationDecisions);
		admissions.set(admissions.cache);
		const emittedDecisions = data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(
			decisions.messages,
		).at(-1);
		if (emittedDecisions === undefined) throw new Error("expected graph-visible decisions");
		const evidenceProjection = projectAgenticMemoryRecordApplicationEvidenceFacts(emittedDecisions);
		const facts = [
			agenticMemoryCommittedApplicationDecisionFact(emittedDecisions[0]!),
			agenticMemoryCommittedApplicationEvidenceFact(evidenceProjection.evidenceFacts[0]!),
		];
		const log = memoryAgenticMemoryCommittedFactLog();

		const result = await log.append(agenticMemoryCommittedFactBatch(facts));
		const read = await log.read();
		const materialized = materializeAgenticMemoryCommittedFacts(read.facts);

		expect(decisions.messages.map((message) => message[0])).toContain("DATA");
		expect(result.status).toBe("committed");
		expect(JSON.stringify(result)).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hydrate/i,
		);
		expect(read.facts).toEqual(facts);
		expect(materialized.priorEvidence.entries).toEqual(evidenceProjection.evidenceFacts);
		expect(materialized.records).toEqual([]);
	});

	it("keeps the reference adapter from decoding, applying, admitting, or mutating records", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d589-materialized",
			fragment: fragment({ id: "fragment-d589-materialized" }),
		});
		const fact = agenticMemoryCommittedRecordMaterialFact(committedRecord);

		await log.append(agenticMemoryCommittedFactBatch([fact]));
		const read = await log.read();

		expect(read).not.toHaveProperty("records");
		expect(read).not.toHaveProperty("priorEvidence");
		expect(read.facts).toEqual([fact]);
		expect(materializeAgenticMemoryCommittedFacts(read.facts).records).toEqual([committedRecord]);
	});

	it("materializes records/priorEvidence by library materialization and preserves snapshot+tail equivalence", async () => {
		const applied = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d589-evidence", proposalId: "d589-evidence" })],
			applicationPolicy(),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			applied.applicationDecisions,
		);
		const prefix = [
			agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d589-prefix", fragment: fragment({ id: "fragment-d589-prefix" }) }),
			),
			agenticMemoryCommittedApplicationEvidenceFact(evidence.evidenceFacts[0]!),
		];
		const tail = [
			agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d589-tail", fragment: fragment({ id: "fragment-d589-tail" }) }),
			),
		];

		const direct = materializeAgenticMemoryCommittedFacts([...prefix, ...tail]);
		const compacted = materializeAgenticMemoryCommittedFactSnapshotTail(
			agenticMemoryCommittedFactSnapshot(prefix),
			tail,
		);

		expect(direct.records.map((item) => item.id)).toEqual([
			"record-d589-prefix",
			"record-d589-tail",
		]);
		expect(direct.priorEvidence.entries).toEqual(evidence.evidenceFacts);
		expect(compacted.records).toEqual(direct.records);
		expect(compacted.priorEvidence).toEqual(direct.priorEvidence);
		expect(agenticMemoryCommittedFactSnapshotTailEquivalent(prefix, tail)).toBe(true);
	});
});

describe("AgenticMemory D592 committed fact-log backend adapter contract", () => {
	it("normalizes backend append results to D589 commit result DATA with diagnostics only", () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d592-append", fragment: fragment({ id: "fragment-d592-append" }) }),
			{ operation: "create", correlationId: "d592-append" },
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const backendCursor = agenticMemoryCommittedFactLogBackendCursor("sqlite-test", {
			rowid: "backend-row-10",
		});
		const backendStatus = agenticMemoryCommittedFactLogBackendStatus("degraded", {
			backend: "sqlite-test",
			capabilities: [
				{
					kind: "agentic-memory-committed-fact-log-backend-capability",
					name: "physical-transactions",
					supported: true,
					status: "available",
				},
			],
			issues: [
				{
					kind: "issue",
					code: "backend.fsync.best-effort",
					message: "fsync is host policy",
					severity: "warning",
				},
			],
		});

		const normalized = normalizeAgenticMemoryCommittedFactLogBackendAppendResult({
			status: "committed",
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			facts: batch.facts.length,
			issues: [
				{
					kind: "issue",
					code: "backend.transaction.retried",
					message: "physical transaction retried",
					severity: "info",
				},
			],
			audit: [
				{
					kind: "agentic-memory-fact-log-audit",
					action: "batch-committed",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
				},
			],
			backendCursor,
			backendStatus,
		});

		expect(normalized).toMatchObject({
			status: "committed",
			facts: 1,
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});
		expect(normalized).not.toHaveProperty("backendCursor");
		expect(normalized).not.toHaveProperty("backendStatus");
		expect(normalized).not.toHaveProperty("records");
		expect(normalized.issues.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"backend.transaction.retried",
				"backend.fsync.best-effort",
				"agentic-memory.fact-log-backend.status",
			]),
		);
		expect(normalized.audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				"batch-committed",
				"backend-append-normalized",
				"backend-status-linked",
				"backend-capability-linked",
				"backend-cursor-linked",
			]),
		);
		expect(JSON.stringify(normalized.cursor)).not.toContain("backend-row-10");
		expect(JSON.stringify(normalized)).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydrate|hydration|restore|commitBarrier/i,
		);
	});

	it("keeps duplicate, conflict, rejected, and uncertain D589-shaped without app ack semantics", () => {
		const statuses: readonly AgenticMemoryFactCommitStatus[] = [
			"duplicate",
			"conflict",
			"rejected",
			"uncertain",
		];
		const normalized = statuses.map((status, index) =>
			normalizeAgenticMemoryCommittedFactLogBackendAppendResult({
				status,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: index },
				facts: 0,
				issues: [],
				audit: [],
			}),
		);

		expect(normalized.map((item) => item.status)).toEqual(statuses);
		expect(normalized.map((item) => item.cursor.kind)).toEqual([
			"agentic-memory-fact-stream.cursor",
			"agentic-memory-fact-stream.cursor",
			"agentic-memory-fact-stream.cursor",
			"agentic-memory-fact-stream.cursor",
		]);
		expect(agenticMemoryFactCommitStatusIsDurable(normalized[0]!.status)).toBe(true);
		expect(agenticMemoryFactCommitStatusIsTerminalFailure(normalized[1]!.status)).toBe(true);
		expect(agenticMemoryFactCommitStatusIsTerminalFailure(normalized[2]!.status)).toBe(true);
		expect(agenticMemoryFactCommitStatusIsDurable(normalized[3]!.status)).toBe(false);
		expect(agenticMemoryFactCommitStatusIsTerminalFailure(normalized[3]!.status)).toBe(false);
		expect(JSON.stringify(normalized)).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydrate|hydration|restore|commitBarrier/i,
		);
	});

	it("normalizes backend read results to stream-ordered committed facts with fact-stream cursor only", () => {
		const first = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d592-read-a", fragment: fragment({ id: "fragment-d592-read-a" }) }),
			{ operation: "create", correlationId: "d592-read-a" },
		);
		const second = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d592-read-b", fragment: fragment({ id: "fragment-d592-read-b" }) }),
			{ operation: "create", correlationId: "d592-read-b" },
		);
		const backendCursor = agenticMemoryCommittedFactLogBackendCursor("indexeddb-test", {
			store: "facts",
			key: "backend-key-2",
		});

		const read = normalizeAgenticMemoryCommittedFactLogBackendReadResult({
			facts: [first, second],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			done: true,
			issues: [],
			audit: [],
			backendCursor,
			backendStatus: agenticMemoryCommittedFactLogBackendStatus("available", {
				backend: "indexeddb-test",
			}),
		});

		expect(read.facts).toEqual([first, second]);
		expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
		expect(read.done).toBe(true);
		expect(read).not.toHaveProperty("backendCursor");
		expect(read).not.toHaveProperty("records");
		expect(read.audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(["facts-read", "backend-read-normalized", "backend-cursor-linked"]),
		);
		expect(JSON.stringify(read.cursor)).not.toMatch(/indexeddb|backend-key|row/i);
	});

	it("rejects backend row ids/storage cursors as fact-log cursors and reports issues", () => {
		const append = normalizeAgenticMemoryCommittedFactLogBackendAppendResult({
			status: "committed",
			cursor: { kind: "backend-row-id", position: 10 },
			facts: 1,
			issues: [],
			audit: [],
		});
		const read = normalizeAgenticMemoryCommittedFactLogBackendReadResult({
			facts: [],
			cursor: { kind: "backend-row-id", position: 10 },
			done: true,
			issues: [],
			audit: [],
		});

		expect(append.status).toBe("uncertain");
		expect(append.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 0 });
		expect(append.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.fact-log-backend.invalid-fact-cursor",
				}),
			]),
		);
		expect(read.facts).toEqual([]);
		expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 0 });
		expect(read.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.fact-log-backend.invalid-fact-cursor",
				}),
			]),
		);
	});

	it("keeps malformed backend diagnostics on the D589 DATA issue path", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d592-malformed-diagnostics",
				fragment: fragment({ id: "fragment-d592-malformed-diagnostics" }),
			}),
			{ operation: "create", correlationId: "d592-malformed-diagnostics" },
		);
		const malformedAppend = normalizeAgenticMemoryCommittedFactLogBackendAppendResult({
			status: "committed",
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
			facts: 0,
			issues: [{ kind: "not-issue", code: "bad", message: "bad" }],
			audit: [{ kind: "agentic-memory-fact-log-audit", action: "not-audit-action" }],
			backendStatus: {
				kind: "agentic-memory-committed-fact-log-backend-status",
				state: "not-a-status",
				capabilities: [],
				issues: [],
				audit: [],
			},
		});
		const asyncLog = agenticMemoryCommittedFactLogBackendAdapter({
			append() {
				return Promise.resolve({
					status: "committed",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
					facts: 0,
					issues: [
						{
							kind: "issue",
							code: "backend.bad-details",
							message: "bad diagnostic details",
							details: undefined,
						},
					],
					audit: [],
				});
			},
			read() {
				return Promise.resolve({
					facts: [],
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
					done: true,
					issues: [{ kind: "nope", code: "bad", message: "bad" }],
					audit: [{ kind: "agentic-memory-fact-log-audit", action: "nope" }],
				});
			},
		});

		const append = await asyncLog.append(agenticMemoryCommittedFactBatch([fact]));
		const read = await asyncLog.read();

		expect(malformedAppend.issues.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"agentic-memory.fact-log-backend.invalid-issues",
				"agentic-memory.fact-log-backend.invalid-audit",
				"agentic-memory.fact-log-backend.invalid-status",
			]),
		);
		expect(append.status).not.toBe("committed");
		expect(append.issues.map((item) => item.code)).toContain(
			"agentic-memory.fact-log-backend.invalid-append-result",
		);
		expect(read.issues.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"agentic-memory.fact-log-backend.invalid-issues",
				"agentic-memory.fact-log-backend.invalid-audit",
			]),
		);
	});

	it("downgrades partial committed append results instead of exposing durable success", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d592-partial-commit",
				fragment: fragment({ id: "fragment-d592-partial-commit" }),
			}),
			{ operation: "create", correlationId: "d592-partial-commit" },
		);
		const log = agenticMemoryCommittedFactLogBackendAdapter({
			append() {
				return {
					status: "committed",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
					facts: 0,
					issues: [],
					audit: [],
				};
			},
			read() {
				return {
					facts: [],
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
					done: true,
					issues: [],
					audit: [],
				};
			},
		});

		const append = await log.append(agenticMemoryCommittedFactBatch([fact]));

		expect(append).toMatchObject({
			status: "uncertain",
			facts: 0,
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
		});
		expect(append.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.fact-log-backend.committed-facts-mismatch",
				}),
			]),
		);
	});

	it("drops read facts when the fact-stream cursor does not cover them", () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d592-read-cursor-coverage",
				fragment: fragment({ id: "fragment-d592-read-cursor-coverage" }),
			}),
			{ operation: "create", correlationId: "d592-read-cursor-coverage" },
		);

		const read = normalizeAgenticMemoryCommittedFactLogBackendReadResult({
			facts: [fact],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
			done: true,
			issues: [],
			audit: [],
		});

		expect(read.facts).toEqual([]);
		expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 0 });
		expect(read.done).toBe(false);
		expect(read.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.fact-log-backend.invalid-read-cursor-coverage",
				}),
			]),
		);
	});

	it("preserves caller read checkpoints on backend read failure", async () => {
		const log = agenticMemoryCommittedFactLogBackendAdapter({
			append() {
				return {
					status: "duplicate",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 3 },
					facts: 0,
					issues: [],
					audit: [],
				};
			},
			read() {
				throw new Error("backend unavailable");
			},
		});

		const read = await log.read({
			after: { kind: "agentic-memory-fact-stream.cursor", position: 3 },
		});

		expect(read.facts).toEqual([]);
		expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 3 });
		expect(read.done).toBe(false);
		expect(read.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "agentic-memory.fact-log-backend.read-threw" }),
			]),
		);
	});

	it("wraps a backend as a fact-log adapter without materialization, restore, or live refresh", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d592-wrapper", fragment: fragment({ id: "fragment-d592-wrapper" }) }),
			{ operation: "create", correlationId: "d592-wrapper" },
		);
		const appended: (typeof fact)[] = [];
		const backend: AgenticMemoryCommittedFactLogBackend = {
			append(batch) {
				appended.push(...batch.facts);
				return {
					status: "committed",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: appended.length },
					facts: batch.facts.length,
					issues: [],
					audit: [],
				};
			},
			read(opts = {}) {
				const after = opts.after?.position ?? 0;
				const visible = appended.slice(after);
				return {
					facts: visible,
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: appended.length },
					done: true,
					issues: [],
					audit: [],
				};
			},
		};
		const log = agenticMemoryCommittedFactLogBackendAdapter(backend);

		const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
		const read = await log.read();
		const materialized = materializeAgenticMemoryCommittedFacts(read.facts);

		expect(append.status).toBe("committed");
		expect(read.facts).toEqual([fact]);
		expect(read).not.toHaveProperty("records");
		expect(read).not.toHaveProperty("priorEvidence");
		expect(materialized.records).toEqual([
			record({ id: "record-d592-wrapper", fragment: fragment({ id: "fragment-d592-wrapper" }) }),
		]);
		expect(JSON.stringify({ append, read })).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydrate|hydration|restore|commitBarrier|replay|apply|admit/i,
		);
	});

	it("turns backend append uncertainty into explicit read/idempotency resolution work", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d592-uncertain",
				fragment: fragment({ id: "fragment-d592-uncertain" }),
			}),
			{ operation: "create", correlationId: "d592-uncertain" },
		);
		const committed = memoryAgenticMemoryCommittedFactLog();
		await committed.append(agenticMemoryCommittedFactBatch([fact]));
		const uncertain = normalizeAgenticMemoryCommittedFactLogBackendAppendResult({
			status: "uncertain",
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
			facts: 0,
			issues: [
				{
					kind: "issue",
					code: "backend.connection.lost-after-write",
					message: "backend cannot prove whether the append committed",
					retryable: true,
				},
			],
			audit: [],
		});
		const projection = projectAgenticMemoryDurabilityGate(
			agenticMemoryCommittedFactBatch([fact]),
			uncertain,
			{ downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy() },
		);
		const read = await committed.read();

		expect(uncertain.status).toBe("uncertain");
		expect(projection.status).toMatchObject({
			state: "uncertain",
			downstreamAdvance: { allowed: false, reason: "uncertain-requires-read-resolution" },
		});
		expect(materializeAgenticMemoryCommittedFacts(read.facts).records).toEqual([
			record({
				id: "record-d592-uncertain",
				fragment: fragment({ id: "fragment-d592-uncertain" }),
			}),
		]);
	});

	it("keeps D591 materialization library-owned and caller-wired after normalized reads", () => {
		const committedRecord = record({
			id: "record-d592-d591",
			fragment: fragment({ id: "fragment-d592-d591" }),
		});
		const fact = agenticMemoryCommittedRecordMaterialFact(committedRecord, {
			operation: "create",
			correlationId: "d592-d591",
		});
		const read = normalizeAgenticMemoryCommittedFactLogBackendReadResult({
			facts: [fact],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			done: true,
			issues: [],
			audit: [],
		});
		const projection = projectAgenticMemoryCommittedFactReadMaterialization(read);

		expect(read).not.toHaveProperty("records");
		expect(read).not.toHaveProperty("priorEvidence");
		expect(projection.records).toEqual([committedRecord]);
		expect(projection.status).toMatchObject({
			state: "ready",
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});
	});

	it("exposes backend status/capability DTOs as diagnostic DATA only", () => {
		const status: AgenticMemoryCommittedFactLogBackendStatus =
			agenticMemoryCommittedFactLogBackendStatus("available", {
				backend: "memory-test",
				capabilities: [
					{
						kind: "agentic-memory-committed-fact-log-backend-capability",
						name: "storage-cursors",
						supported: true,
						status: "available",
						details: { cursor: "opaque" },
					},
				],
				audit: [
					{
						kind: "agentic-memory-committed-fact-log-backend-audit",
						action: "backend-status-reported",
						backend: "memory-test",
					},
				],
			});

		expect(status.kind).toBe("agentic-memory-committed-fact-log-backend-status");
		expect(status.capabilities[0]).toMatchObject({
			kind: "agentic-memory-committed-fact-log-backend-capability",
			name: "storage-cursors",
			supported: true,
		});
		expect(status).not.toHaveProperty("append");
		expect(status).not.toHaveProperty("read");
		expect(status).not.toHaveProperty("records");
		expect(status).not.toHaveProperty("restore");
		expect(status).not.toHaveProperty("hydrate");
		expect(Object.isFrozen(status.capabilities[0]?.details)).toBe(true);
	});
});

describe("AgenticMemory D594 Node file committed fact-log reference backend", () => {
	it("exposes direct backend storage diagnostics without changing fact cursors", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const first = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-file-direct-a",
					fragment: fragment({ id: "fragment-d594-file-direct-a" }),
				}),
				{ operation: "create", correlationId: "d594-file-direct-a" },
			);
			const second = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-file-direct-b",
					fragment: fragment({ id: "fragment-d594-file-direct-b" }),
				}),
				{ operation: "create", correlationId: "d594-file-direct-b" },
			);
			const backend = nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir, {
				backendName: "node-file-d594-direct-smoke",
			});
			const status = typeof backend.status === "function" ? await backend.status() : backend.status;

			const append = await backend.append(agenticMemoryCommittedFactBatch([first, second]));
			const reopened = nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir, {
				backendName: "node-file-d594-direct-smoke",
			});
			const readAll = await reopened.read();
			const readAfterFirst = await reopened.read({
				after: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});

			expect(append).toMatchObject({
				status: "committed",
				facts: 2,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
				backendCursor: {
					kind: AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
					backend: "node-file-d594-direct-smoke",
				},
			});
			expect(append.backendCursor?.value).toMatchObject({
				appendLogSeq: expect.any(Number),
				storageKey: expect.any(String),
			});
			expect(status?.capabilities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "single-writer", supported: true }),
					expect.objectContaining({ name: "whole-batch-visibility", supported: true }),
					expect.objectContaining({ name: "multi-writer-correctness", supported: false }),
					expect.objectContaining({ name: "fsync-guarantee", supported: false }),
				]),
			);
			expect(readAll.facts).toEqual([first, second]);
			expect(readAll.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
			expect(readAll.backendCursor?.kind).toBe(
				AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND,
			);
			expect(readAfterFirst.facts).toEqual([second]);
			expect(readAfterFirst.cursor).toEqual({
				kind: "agentic-memory-fact-stream.cursor",
				position: 2,
			});
			expect(
				JSON.stringify({
					appendCursor: append.cursor,
					readCursor: readAll.cursor,
					readAfterFirstCursor: readAfterFirst.cursor,
				}),
			).not.toMatch(/node-file|appendLogSeq|storageKey|backend|file|path|row|key/i);
		});
	});

	it("persists canonical committed fact batches and reads them in fact-stream order", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const first = agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d594-file-a", fragment: fragment({ id: "fragment-d594-file-a" }) }),
				{ operation: "create", correlationId: "d594-file-a" },
			);
			const second = agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d594-file-b", fragment: fragment({ id: "fragment-d594-file-b" }) }),
				{ operation: "create", correlationId: "d594-file-b" },
			);
			const batch = agenticMemoryCommittedFactBatch([first, second]);
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);

			const append = await log.append(batch);
			const reopened = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);
			const readAll = await reopened.read();
			const readAfterFirst = await reopened.read({
				after: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});

			expect(append).toMatchObject({
				status: "committed",
				facts: 2,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
			expect(readAll.facts).toEqual([first, second]);
			expect(readAll.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
			expect(readAfterFirst.facts).toEqual([second]);
			expect(readAfterFirst.cursor).toEqual({
				kind: "agentic-memory-fact-stream.cursor",
				position: 2,
			});
			expect(
				JSON.stringify({ appendCursor: append.cursor, readCursor: readAll.cursor }),
			).not.toMatch(/file|path|storage|appendLog|seq|row|backend/i);
		});
	});

	it("uses D589 identity/material rules for duplicate and conflict without choosing a winner", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);
			const original = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-conflict",
					fragment: fragment({ id: "fragment-d594-conflict-original" }),
				}),
				{ operation: "create", correlationId: "d594-conflict" },
			);
			const conflicting = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-conflict",
					fragment: fragment({ id: "fragment-d594-conflict-other", payload: "other" }),
				}),
				{ operation: "create", correlationId: "d594-conflict" },
			);
			const batch = agenticMemoryCommittedFactBatch([original]);

			const committed = await log.append(batch);
			const duplicate = await log.append(batch);
			const conflict = await log.append(agenticMemoryCommittedFactBatch([conflicting]));
			const read = await log.read();

			expect(committed.status).toBe("committed");
			expect(duplicate.status).toBe("duplicate");
			expect(conflict.status).toBe("conflict");
			expect(original.identity).toEqual(conflicting.identity);
			expect(original.materialIdentity).not.toEqual(conflicting.materialIdentity);
			expect(read.facts).toEqual([original]);
			expect(materializeAgenticMemoryCommittedFacts(read.facts).records).toEqual([
				record({
					id: "record-d594-conflict",
					fragment: fragment({ id: "fragment-d594-conflict-original" }),
				}),
			]);
		});
	});

	it("keeps batch visibility whole by rejecting partial-overlap appends", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);
			const existing = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-overlap-a",
					fragment: fragment({ id: "fragment-d594-overlap-a" }),
				}),
				{ operation: "create", correlationId: "d594-overlap-a" },
			);
			const newFact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-overlap-b",
					fragment: fragment({ id: "fragment-d594-overlap-b" }),
				}),
				{ operation: "create", correlationId: "d594-overlap-b" },
			);

			await log.append(agenticMemoryCommittedFactBatch([existing]));
			const overlap = await log.append(agenticMemoryCommittedFactBatch([existing, newFact]));
			const read = await log.read();

			expect(overlap.status).toBe("rejected");
			expect(overlap.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "agentic-memory.fact-log-backend.node-file.batch-overlaps-committed-log",
					}),
				]),
			);
			expect(read.facts).toEqual([existing]);
			expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 1 });
		});
	});

	it("keeps backend diagnostics and storage cursors as issue/audit DATA only", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const backend = nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir, {
				backendName: "node-file-d594-diagnostics",
			});
			const log = agenticMemoryCommittedFactLogBackendAdapter(backend);
			const fact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-diagnostics",
					fragment: fragment({ id: "fragment-d594-diagnostics" }),
				}),
				{ operation: "create", correlationId: "d594-diagnostics" },
			);

			const directStatus =
				typeof backend.status === "function" ? await backend.status() : backend.status;
			const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
			const read = await log.read();

			expect(directStatus).toMatchObject({
				kind: "agentic-memory-committed-fact-log-backend-status",
				backend: "node-file-d594-diagnostics",
			});
			expect(directStatus?.capabilities.map((capability) => capability.name)).toEqual(
				expect.arrayContaining([
					"single-writer",
					"whole-batch-visibility",
					"multi-writer-correctness",
					"fsync-guarantee",
				]),
			);
			expect(append).not.toHaveProperty("backendCursor");
			expect(append).not.toHaveProperty("backendStatus");
			expect(read).not.toHaveProperty("backendCursor");
			expect(read).not.toHaveProperty("backendStatus");
			expect(append.audit.map((entry) => entry.action)).toEqual(
				expect.arrayContaining(["backend-cursor-linked", "backend-status-linked"]),
			);
			expect(read.audit.map((entry) => entry.action)).toContain("backend-cursor-linked");
			expect(JSON.stringify({ appendCursor: append.cursor, readCursor: read.cursor })).not.toMatch(
				/node-file|appendLogSeq|storageKey|backend/i,
			);
		});
	});

	it("reports uncertain physical append outcomes without implying success or failure", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d594-uncertain",
				fragment: fragment({ id: "fragment-d594-uncertain" }),
			}),
			{ operation: "create", correlationId: "d594-uncertain" },
		);
		const log = agenticMemoryCommittedFactLogBackendAdapter(
			nodeFileAgenticMemoryCommittedFactLogBackend<string>(join(tmpdir(), "bad\0fact-log")),
		);

		const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
		const projection = projectAgenticMemoryDurabilityGate(
			agenticMemoryCommittedFactBatch([fact]),
			append,
			{
				downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
			},
		);

		expect(append.status).toBe("uncertain");
		expect(agenticMemoryFactCommitStatusIsDurable(append.status)).toBe(false);
		expect(agenticMemoryFactCommitStatusIsTerminalFailure(append.status)).toBe(false);
		expect(projection.status).toMatchObject({
			state: "uncertain",
			downstreamAdvance: { allowed: false, reason: "uncertain-requires-read-resolution" },
		});
	});

	it("integrates with runtime startup read and append attempt helpers as explicit DATA boundaries", async () => {
		await withTempDir("graphrefly-agentic-memory-d594", async (dir) => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);
			const committed = record({
				id: "record-d594-runtime",
				fragment: fragment({ id: "fragment-d594-runtime" }),
			});
			const batch = agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committed, {
					operation: "create",
					correlationId: "d594-runtime",
				}),
			]);

			const append = await agenticMemoryCommittedFactLogAppendAttempt(log, batch, {
				evaluation: 11,
				downstreamAdvancePolicy:
					agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy("d594-runtime-policy"),
			});
			const startup = await agenticMemoryCommittedFactLogStartupRead(log, { evaluation: 12 });

			expect(append.commitResult).toMatchObject({
				status: "committed",
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});
			expect(append.durabilityStatus).toMatchObject({
				state: "durable",
				downstreamAdvance: {
					allowed: true,
					policyId: "d594-runtime-policy",
					reason: "fact-log-committed",
				},
			});
			expect(startup.records).toEqual([committed]);
			expect(startup.bootstrapStatus).toMatchObject({
				state: "ready",
				readyForCallerWiring: true,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});
			expect(jsonForBoundaryText({ append, startup })).not.toMatch(
				/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier|sameEvaluationFeedback/i,
			);
		});
	});
});

describe("AgenticMemory D641 journal specialization restart coverage", () => {
	it("reads and materializes raw memory plus insight records in a separate cold process", async () => {
		await withTempDir("graphrefly-agentic-memory-d641-process", async (dir) => {
			const fixture = fileURLToPath(
				new URL("./fixtures/agentic-memory-d641-process.ts", import.meta.url),
			);
			const run = (mode: "write" | "read") =>
				JSON.parse(
					execFileSync(process.execPath, ["--import", "tsx", fixture, mode, dir], {
						cwd: process.cwd(),
						encoding: "utf8",
					}),
				) as Record<string, unknown>;

			expect(run("write")).toMatchObject({
				status: "committed",
				facts: 2,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
			expect(run("read")).toMatchObject({
				artifactKinds: ["raw", "insight"],
				state: "ready",
				readyForCallerWiring: true,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
		});
	});

	it("reopens file-backed raw memory and insight records through explicit startup materialization", async () => {
		await withTempDir("graphrefly-agentic-memory-d641", async (dir) => {
			const raw = record({
				id: "record-d641-raw",
				artifactKind: "raw",
				fragment: fragment({
					id: "fragment-d641-raw",
					payload: "bounded raw evidence",
				}),
			});
			const insight = record({
				id: "record-d641-insight",
				artifactKind: "insight",
				fragment: fragment({
					id: "fragment-d641-insight",
					payload: "derived reusable insight",
				}),
			});
			const firstHandle = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);

			const append = await agenticMemoryCommittedFactLogAppendAttempt(
				firstHandle,
				agenticMemoryCommittedFactBatch([
					agenticMemoryCommittedRecordMaterialFact(raw, {
						operation: "create",
						correlationId: "d641-raw",
					}),
					agenticMemoryCommittedRecordMaterialFact(insight, {
						operation: "create",
						correlationId: "d641-insight",
					}),
				]),
			);
			const reopenedHandle = agenticMemoryCommittedFactLogBackendAdapter(
				nodeFileAgenticMemoryCommittedFactLogBackend<string>(dir),
			);
			const startup = await agenticMemoryCommittedFactLogStartupRead(reopenedHandle, {
				evaluation: 641,
			});

			expect(append.commitResult).toMatchObject({
				status: "committed",
				facts: 2,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
			expect(startup.records).toEqual([raw, insight]);
			expect(startup.records.map((item) => item.artifactKind)).toEqual(["raw", "insight"]);
			expect(startup.bootstrapStatus).toMatchObject({
				state: "ready",
				readyForCallerWiring: true,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
			expect(jsonForBoundaryText(startup)).not.toMatch(
				/hotHydration|liveRefresh|graphCommitBarrier|applicationAck/i,
			);
		});
	});
});

describe("AgenticMemory D594 browser IndexedDB committed fact-log reference backend", () => {
	it("persists canonical committed fact batches and reads them in fact-stream order", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const spec = indexedDbSpec("order");
			const first = agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d594-idb-a", fragment: fragment({ id: "fragment-d594-idb-a" }) }),
				{ operation: "create", correlationId: "d594-idb-a" },
			);
			const second = agenticMemoryCommittedRecordMaterialFact(
				record({ id: "record-d594-idb-b", fragment: fragment({ id: "fragment-d594-idb-b" }) }),
				{ operation: "create", correlationId: "d594-idb-b" },
			);
			const batch = agenticMemoryCommittedFactBatch([first, second]);
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(spec),
			);

			const append = await log.append(batch);
			const reopened = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(spec),
			);
			const readAll = await reopened.read();
			const readAfterFirst = await reopened.read({
				after: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});

			expect(append).toMatchObject({
				status: "committed",
				facts: 2,
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			});
			expect(readAll.facts).toEqual([first, second]);
			expect(readAll.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 2 });
			expect(readAfterFirst.facts).toEqual([second]);
			expect(readAfterFirst.cursor).toEqual({
				kind: "agentic-memory-fact-stream.cursor",
				position: 2,
			});
			expect(
				JSON.stringify({ appendCursor: append.cursor, readCursor: readAll.cursor }),
			).not.toMatch(/indexedDb|idb|storage|appendLog|seq|row|backend|key/i);
		});
	});

	it("uses D589 identity/material rules for duplicate and conflict without choosing a winner", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(indexedDbSpec("conflict")),
			);
			const original = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-conflict",
					fragment: fragment({ id: "fragment-d594-idb-conflict-original" }),
				}),
				{ operation: "create", correlationId: "d594-idb-conflict" },
			);
			const conflicting = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-conflict",
					fragment: fragment({ id: "fragment-d594-idb-conflict-other", payload: "other" }),
				}),
				{ operation: "create", correlationId: "d594-idb-conflict" },
			);
			const batch = agenticMemoryCommittedFactBatch([original]);

			const committed = await log.append(batch);
			const duplicate = await log.append(batch);
			const conflict = await log.append(agenticMemoryCommittedFactBatch([conflicting]));
			const read = await log.read();

			expect(committed.status).toBe("committed");
			expect(duplicate.status).toBe("duplicate");
			expect(conflict.status).toBe("conflict");
			expect(original.identity).toEqual(conflicting.identity);
			expect(original.materialIdentity).not.toEqual(conflicting.materialIdentity);
			expect(read.facts).toEqual([original]);
			expect(materializeAgenticMemoryCommittedFacts(read.facts).records).toEqual([
				record({
					id: "record-d594-idb-conflict",
					fragment: fragment({ id: "fragment-d594-idb-conflict-original" }),
				}),
			]);
		});
	});

	it("keeps batch visibility whole by rejecting partial-overlap appends", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(indexedDbSpec("overlap")),
			);
			const existing = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-overlap-a",
					fragment: fragment({ id: "fragment-d594-idb-overlap-a" }),
				}),
				{ operation: "create", correlationId: "d594-idb-overlap-a" },
			);
			const newFact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-overlap-b",
					fragment: fragment({ id: "fragment-d594-idb-overlap-b" }),
				}),
				{ operation: "create", correlationId: "d594-idb-overlap-b" },
			);

			await log.append(agenticMemoryCommittedFactBatch([existing]));
			const overlap = await log.append(agenticMemoryCommittedFactBatch([existing, newFact]));
			const read = await log.read();

			expect(overlap.status).toBe("rejected");
			expect(overlap.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "agentic-memory.fact-log-backend.indexeddb.batch-overlaps-committed-log",
					}),
				]),
			);
			expect(read.facts).toEqual([existing]);
			expect(read.cursor).toEqual({ kind: "agentic-memory-fact-stream.cursor", position: 1 });
		});
	});

	it("keeps backend diagnostics and IndexedDB storage cursors as issue/audit DATA only", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>(indexedDbSpec("diag"), {
				backendName: "indexeddb-d594-diagnostics",
			});
			const log = agenticMemoryCommittedFactLogBackendAdapter(backend);
			const fact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-diagnostics",
					fragment: fragment({ id: "fragment-d594-idb-diagnostics" }),
				}),
				{ operation: "create", correlationId: "d594-idb-diagnostics" },
			);

			const directStatus =
				typeof backend.status === "function" ? await backend.status() : backend.status;
			const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
			const read = await log.read();

			expect(directStatus).toMatchObject({
				kind: "agentic-memory-committed-fact-log-backend-status",
				backend: "indexeddb-d594-diagnostics",
			});
			expect(directStatus?.capabilities.map((capability) => capability.name)).toEqual(
				expect.arrayContaining([
					"single-writer",
					"whole-batch-visibility",
					"browser-transaction-attempt",
					"multi-writer-correctness",
					"fsync-guarantee",
				]),
			);
			expect(append).not.toHaveProperty("backendCursor");
			expect(append).not.toHaveProperty("backendStatus");
			expect(read).not.toHaveProperty("backendCursor");
			expect(read).not.toHaveProperty("backendStatus");
			expect(append.audit.map((entry) => entry.action)).toEqual(
				expect.arrayContaining(["backend-cursor-linked", "backend-status-linked"]),
			);
			expect(read.audit.map((entry) => entry.action)).toContain("backend-cursor-linked");
			expect(JSON.stringify({ appendCursor: append.cursor, readCursor: read.cursor })).not.toMatch(
				/indexeddb|appendLogSeq|storageKey|backend|key/i,
			);
			expect(jsonForBoundaryText({ directStatus })).not.toMatch(
				/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier|sameEvaluationFeedback/i,
			);
		});
	});

	it("normalizes an empty diagnostic backend name before reporting backend cursors", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>(
				indexedDbSpec("empty-backend-name"),
				{ backendName: "" },
			);
			const log = agenticMemoryCommittedFactLogBackendAdapter(backend);
			const fact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-empty-backend-name",
					fragment: fragment({ id: "fragment-d594-idb-empty-backend-name" }),
				}),
				{ operation: "create", correlationId: "d594-idb-empty-backend-name" },
			);

			const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
			const read = await log.read();

			expect(append.status).toBe("committed");
			expect(read.facts).toEqual([fact]);
			expect(append.audit.map((entry) => entry.action)).toContain("backend-cursor-linked");
			expect(read.audit.map((entry) => entry.action)).toContain("backend-cursor-linked");
		});
	});

	it("keeps malformed direct read cursors on the issue DATA path", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const backend = indexedDbAgenticMemoryCommittedFactLogBackend<string>(
				indexedDbSpec("malformed-direct-cursor"),
			);
			const invalidReadOpts = { after: null } as unknown as Parameters<typeof backend.read>[0];

			const read = await backend.read(invalidReadOpts);

			expect(read).toMatchObject({
				facts: [],
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
				done: false,
			});
			expect(read.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "agentic-memory.fact-log-backend.indexeddb.invalid-fact-cursor",
					}),
				]),
			);
		});
	});

	it("reports uncertain physical append outcomes without implying success or failure", async () => {
		await withIndexedDbMock(createMemoryIndexedDb({ failPut: true }), async () => {
			const fact = agenticMemoryCommittedRecordMaterialFact(
				record({
					id: "record-d594-idb-uncertain",
					fragment: fragment({ id: "fragment-d594-idb-uncertain" }),
				}),
				{ operation: "create", correlationId: "d594-idb-uncertain" },
			);
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(indexedDbSpec("uncertain")),
			);

			const append = await log.append(agenticMemoryCommittedFactBatch([fact]));
			const projection = projectAgenticMemoryDurabilityGate(
				agenticMemoryCommittedFactBatch([fact]),
				append,
				{
					downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
				},
			);
			const read = await log.read();

			expect(append.status).toBe("uncertain");
			expect(read.facts).toEqual([]);
			expect(agenticMemoryFactCommitStatusIsDurable(append.status)).toBe(false);
			expect(agenticMemoryFactCommitStatusIsTerminalFailure(append.status)).toBe(false);
			expect(projection.status).toMatchObject({
				state: "uncertain",
				downstreamAdvance: { allowed: false, reason: "uncertain-requires-read-resolution" },
			});
		});
	});

	it("integrates with runtime startup read and append attempt helpers as explicit DATA boundaries", async () => {
		await withIndexedDbMock(createMemoryIndexedDb(), async () => {
			const log = agenticMemoryCommittedFactLogBackendAdapter(
				indexedDbAgenticMemoryCommittedFactLogBackend<string>(indexedDbSpec("runtime")),
			);
			const committed = record({
				id: "record-d594-idb-runtime",
				fragment: fragment({ id: "fragment-d594-idb-runtime" }),
			});
			const batch = agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committed, {
					operation: "create",
					correlationId: "d594-idb-runtime",
				}),
			]);

			const append = await agenticMemoryCommittedFactLogAppendAttempt(log, batch, {
				evaluation: 21,
				downstreamAdvancePolicy:
					agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy("d594-idb-runtime-policy"),
			});
			const startup = await agenticMemoryCommittedFactLogStartupRead(log, { evaluation: 22 });

			expect(append.commitResult).toMatchObject({
				status: "committed",
				cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});
			expect(append.durabilityStatus).toMatchObject({
				state: "durable",
				downstreamAdvance: {
					allowed: true,
					policyId: "d594-idb-runtime-policy",
					reason: "fact-log-committed",
				},
			});
			expect(startup.records).toEqual([committed]);
			expect(startup.bootstrapStatus).toMatchObject({
				state: "ready",
				readyForCallerWiring: true,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			});
			expect(jsonForBoundaryText({ append, startup })).not.toMatch(
				/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier|sameEvaluationFeedback/i,
			);
		});
	});
});

describe("AgenticMemory D590 durable-result gate boundary", () => {
	it("projects fact-log durability result DATA without implicit downstream advance", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-result", fragment: fragment({ id: "fragment-d590-result" }) }),
			{ operation: "create", correlationId: "d590-result" },
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const commitResult = await log.append(batch);

		const projection = projectAgenticMemoryDurabilityGate(batch, commitResult);

		expect(projection.kind).toBe("agentic-memory-durability-gate-projection");
		expect(projection.result).toMatchObject({
			kind: "agentic-memory-durability-result",
			batchIdentity: batch.batchIdentity,
			commitStatus: "committed",
			state: "durable",
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});
		expect(projection.status).toMatchObject<Partial<AgenticMemoryDurabilityGateStatus>>({
			state: "durable",
			commitStatus: "committed",
			downstreamAdvance: {
				kind: "agentic-memory-durability-downstream-advance",
				allowed: false,
				commitStatus: "committed",
				reason: "no-explicit-policy",
			},
		});
		expect(projection.cursor).toMatchObject({
			batchFacts: 1,
			resultFacts: 1,
			committed: 1,
			duplicate: 0,
			terminalFailures: 0,
			uncertain: 0,
		});
		expect(JSON.stringify(projection)).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydration|restore|commitBarrier/i,
		);
	});

	it("allows downstream advance only through the explicit committed-or-duplicate policy helper", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-policy", fragment: fragment({ id: "fragment-d590-policy" }) }),
			{ operation: "create", correlationId: "d590-policy" },
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const committed = await log.append(batch);
		const duplicate = await log.append(batch);
		const policy = agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy("policy-d590");

		const committedProjection = projectAgenticMemoryDurabilityGate(batch, committed, {
			downstreamAdvancePolicy: policy,
		});
		const duplicateProjection = projectAgenticMemoryDurabilityGate(batch, duplicate, {
			downstreamAdvancePolicy: policy,
		});

		expect(agenticMemoryDurabilityResultMayAdvance("committed", policy)).toBe(true);
		expect(agenticMemoryDurabilityResultMayAdvance("duplicate", policy)).toBe(true);
		expect(agenticMemoryDurabilityResultMayAdvance("conflict", policy)).toBe(false);
		expect(agenticMemoryDurabilityResultMayAdvance("rejected", policy)).toBe(false);
		expect(agenticMemoryDurabilityResultMayAdvance("uncertain", policy)).toBe(false);
		expect(committedProjection.status.downstreamAdvance).toMatchObject({
			allowed: true,
			policyId: "policy-d590",
			reason: "fact-log-committed",
		});
		expect(duplicateProjection.status.downstreamAdvance).toMatchObject({
			allowed: true,
			policyId: "policy-d590",
			reason: "fact-log-duplicate",
		});
		expect((await log.read()).facts).toEqual([fact]);
	});

	it("classifies conflict and rejected as terminal durability-attempt failures without rollback", async () => {
		const applicationSnapshot = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d590-terminal", proposalId: "d590-terminal" })],
			applicationPolicy(),
		);
		const appliedRecordIdsBeforeStorageFailure = applicationSnapshot.records.map((item) => item.id);
		const log = memoryAgenticMemoryCommittedFactLog();
		const original = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-conflict", fragment: fragment({ id: "fragment-d590-original" }) }),
			{ operation: "create", correlationId: "d590-terminal" },
		);
		const conflicting = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d590-conflict",
				fragment: fragment({ id: "fragment-d590-conflicting", payload: "different" }),
			}),
			{ operation: "create", correlationId: "d590-terminal" },
		);
		const batch = agenticMemoryCommittedFactBatch([conflicting]);
		const policy = agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy();

		await log.append(agenticMemoryCommittedFactBatch([original]));
		const conflict = await log.append(batch);
		const rejected = await log.append({ ...batch, facts: [] } as never);
		const conflictProjection = projectAgenticMemoryDurabilityGate(batch, conflict, {
			downstreamAdvancePolicy: policy,
		});
		const rejectedProjection = projectAgenticMemoryDurabilityGate(batch, rejected, {
			downstreamAdvancePolicy: policy,
		});
		const conflictWithoutPolicy = projectAgenticMemoryDurabilityGate(batch, conflict);
		const read = await log.read();

		expect(conflictProjection.status).toMatchObject({
			state: "terminal-failure",
			commitStatus: "conflict",
			downstreamAdvance: { allowed: false, reason: "terminal-durability-attempt-failure" },
		});
		expect(rejectedProjection.status).toMatchObject({
			state: "terminal-failure",
			commitStatus: "rejected",
			downstreamAdvance: { allowed: false, reason: "terminal-durability-attempt-failure" },
		});
		expect(conflictWithoutPolicy.status.downstreamAdvance).toMatchObject({
			allowed: false,
			reason: "terminal-durability-attempt-failure",
		});
		expect(Object.isFrozen(rejectedProjection.status.factLogCursor)).toBe(true);
		expect(Object.isFrozen(rejectedProjection.issues[0])).toBe(true);
		expect(Object.isFrozen(rejectedProjection.audit[0])).toBe(true);
		expect(read.facts).toEqual([original]);
		expect(applicationSnapshot.records.map((item) => item.id)).toEqual(
			appliedRecordIdsBeforeStorageFailure,
		);
		expect(conflictProjection).not.toHaveProperty("records");
		expect(conflictProjection).not.toHaveProperty("applicationDecisions");
	});

	it("keeps uncertain unresolved until explicit fact-log read and library materialization", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d590-uncertain",
			fragment: fragment({ id: "fragment-d590-uncertain" }),
		});
		const fact = agenticMemoryCommittedRecordMaterialFact(committedRecord, {
			operation: "create",
			correlationId: "d590-uncertain",
		});
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const uncertain = {
			status: "uncertain",
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
			facts: 0,
			issues: [],
			audit: [],
		} as const;

		const projection = projectAgenticMemoryDurabilityGate(batch, uncertain, {
			downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
		});
		const projectionWithoutPolicy = projectAgenticMemoryDurabilityGate(batch, uncertain);
		const resolution = agenticMemoryDurabilityUncertainResolutionStatus(projection.result);
		await log.append(batch);
		const explicitRead = await log.read();
		const materialized = materializeAgenticMemoryCommittedFacts(explicitRead.facts);

		expect(projection.status).toMatchObject({
			state: "uncertain",
			commitStatus: "uncertain",
			downstreamAdvance: { allowed: false, reason: "uncertain-requires-read-resolution" },
		});
		expect(projectionWithoutPolicy.status.downstreamAdvance).toMatchObject({
			allowed: false,
			reason: "uncertain-requires-read-resolution",
		});
		expect(resolution).toMatchObject({
			state: "requires-fact-log-read",
			reason: "uncertain-requires-read-idempotency-resolution",
			batchIdentity: batch.batchIdentity,
		});
		expect(projection.result).not.toHaveProperty("records");
		expect(materialized.records).toEqual([committedRecord]);
	});

	it("creates graph-visible ordinary DATA read-model nodes and no append/hydration side channel", async () => {
		const g = graph();
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-graph", fragment: fragment({ id: "fragment-d590-graph" }) }),
			{ operation: "create", correlationId: "d590-graph" },
		);
		const batchValue = agenticMemoryCommittedFactBatch([fact]);
		const resultValue = await log.append(batchValue);
		const attemptResult = g.state(agenticMemoryDurabilityGateInput(batchValue, resultValue), {
			name: "attemptResult",
		});
		const bundle = agenticMemoryDurabilityGateBundle(g, {
			name: "durability",
			attemptResult,
			downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
		});
		const result = collect(bundle.result);
		const status = collect(bundle.status);
		const advance = collect(bundle.downstreamAdvance);
		const issues = collect(bundle.issues);
		const audit = collect(bundle.audit);
		const cursor = collect(bundle.cursor);

		attemptResult.set(attemptResult.cache);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "attemptResult", to: "durability/projection" },
				{ from: "durability/projection", to: "durability/result" },
				{ from: "durability/projection", to: "durability/status" },
				{ from: "durability/projection", to: "durability/downstreamAdvance" },
				{ from: "durability/projection", to: "durability/issues" },
				{ from: "durability/projection", to: "durability/audit" },
				{ from: "durability/projection", to: "durability/cursor" },
			]),
		);
		expect(result.messages.map((message) => message[0])).toContain("DATA");
		expect(status.messages.map((message) => message[0])).toContain("DATA");
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "durable",
			commitStatus: "committed",
		});
		expect(data(advance.messages).at(-1)).toMatchObject({ allowed: true });
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(data(audit.messages).at(-1)).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "durability-result-projected" })]),
		);
		expect(data(cursor.messages).at(-1)).toMatchObject({ committed: 1, terminalFailures: 0 });
		expect((await log.read()).facts).toEqual([fact]);
	});

	it("does not correlate independent latest batch and commit-result nodes inside the gate", async () => {
		const g = graph();
		const log = memoryAgenticMemoryCommittedFactLog();
		const firstFact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-first", fragment: fragment({ id: "fragment-d590-first" }) }),
			{ operation: "create", correlationId: "d590-first" },
		);
		const secondFact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-d590-second", fragment: fragment({ id: "fragment-d590-second" }) }),
			{ operation: "create", correlationId: "d590-second" },
		);
		const firstBatch = agenticMemoryCommittedFactBatch([firstFact]);
		const secondBatch = agenticMemoryCommittedFactBatch([secondFact]);
		const firstResult = await log.append(firstBatch);
		const attemptResult = g.state(agenticMemoryDurabilityGateInput(firstBatch, firstResult), {
			name: "attemptResult",
		});
		const unrelatedBatch = g.state(secondBatch, { name: "unrelatedBatch" });
		const unrelatedCommitResult = g.state(firstResult, { name: "unrelatedCommitResult" });
		const bundle = agenticMemoryDurabilityGateBundle(g, {
			name: "durability",
			attemptResult,
			downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
		});
		const result = collect(bundle.result);

		unrelatedBatch.set(secondBatch);
		unrelatedCommitResult.set(firstResult);

		expect(g.describe().edges).not.toEqual(
			expect.arrayContaining([
				{ from: "unrelatedBatch", to: "durability/projection" },
				{ from: "unrelatedCommitResult", to: "durability/projection" },
			]),
		);
		expect(data(result.messages).map((item) => item.batchIdentity)).toEqual([
			firstBatch.batchIdentity,
		]);
		expect(data(result.messages)).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ batchIdentity: secondBatch.batchIdentity }),
			]),
		);
	});
});

describe("AgenticMemory D591 fact-log read materialization re-entry boundary", () => {
	it("projects explicit read-result DATA into deterministic records/priorEvidence/evidence", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const firstRecord = record({
			id: "record-d591-stream-order",
			fragment: fragment({ id: "fragment-d591-first", payload: "first" }),
		});
		const laterRecord = record({
			id: "record-d591-stream-order",
			fragment: fragment({ id: "fragment-d591-later", payload: "later" }),
		});
		const application = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d591-evidence", proposalId: "d591-evidence" })],
			applicationPolicy(),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			application.applicationDecisions,
		);
		const facts = [
			agenticMemoryCommittedRecordMaterialFact(firstRecord, {
				operation: "create",
				correlationId: "d591-first",
			}),
			agenticMemoryCommittedApplicationEvidenceFact(evidence.evidenceFacts[0]!),
			agenticMemoryCommittedRecordMaterialFact(laterRecord, {
				operation: "replace",
				correlationId: "d591-later",
			}),
		];
		await log.append(agenticMemoryCommittedFactBatch(facts));
		const read = await log.read();
		const page = await log.read({ limit: 1 });

		const projection = projectAgenticMemoryCommittedFactReadMaterialization(read);
		const pageProjection = projectAgenticMemoryCommittedFactReadMaterialization(page);

		expect(read).toHaveProperty("facts");
		expect(read).toHaveProperty("cursor");
		expect(read).toHaveProperty("done");
		expect(read).toHaveProperty("issues");
		expect(read).toHaveProperty("audit");
		expect(read).not.toHaveProperty("records");
		expect(read).not.toHaveProperty("priorEvidence");
		expect(projection).toMatchObject<
			Partial<AgenticMemoryCommittedFactReadMaterializationProjection<string>>
		>({
			kind: "agentic-memory-committed-fact-read-materialization-projection",
			status: {
				state: "ready",
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 3 },
				done: true,
				completePrefix: true,
			},
		});
		expect(projection.records).toEqual([laterRecord]);
		expect(projection.priorEvidence.entries).toEqual(evidence.evidenceFacts);
		expect(projection.evidence).toEqual(evidence.evidenceFacts);
		expect(projection.cursor).toMatchObject({
			readFacts: 3,
			materializedRecords: 1,
			evidenceFacts: 1,
			invalidFacts: 0,
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 3 },
			completePrefix: true,
		});
		expect(pageProjection.status).toMatchObject({
			state: "partial",
			done: false,
			completePrefix: false,
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});
		expect(pageProjection.records).toEqual([firstRecord]);
		expect(
			JSON.stringify({
				read: { cursor: read.cursor, done: read.done, issues: read.issues, audit: read.audit },
				projection: {
					status: projection.status,
					issues: projection.issues,
					audit: projection.audit,
					cursor: projection.cursor,
				},
			}),
		).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydrate|hydration|restore|commitBarrier|backendRow|graphClock|applicationVersion|policyClock/i,
		);
	});

	it("creates graph-visible ordinary DATA nodes without reading storage or mutating live records", async () => {
		const g = graph();
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d591-graph",
			fragment: fragment({ id: "fragment-d591-graph" }),
		});
		const fact = agenticMemoryCommittedRecordMaterialFact(committedRecord, {
			operation: "create",
			correlationId: "d591-graph",
		});
		await log.append(agenticMemoryCommittedFactBatch([fact]));
		const read = await log.read();
		const readResult = g.state(read, { name: "readResult" });
		const liveRecords = g.state<readonly AgenticMemoryRecord<string>[]>([], {
			name: "callerRecords",
		});
		const laterAdmissionRecord = record({
			id: "record-d591-later-application",
			fragment: fragment({ id: "fragment-d591-later-application" }),
		});
		const admissions = g.state(
			[
				admitted({
					admissionId: "d591-later-application",
					proposalId: "d591-later-application",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: laterAdmissionRecord,
						sourceRefs: [{ kind: "import", id: "import-d591-later" }],
					},
				}),
			],
			{ name: "laterAdmissions" },
		);
		const policy = g.state(applicationPolicy(), { name: "laterPolicy" });
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "laterApplication",
			records: liveRecords,
			admissions,
			policy,
		});
		const bundle = agenticMemoryCommittedFactReadMaterializationBundle(g, {
			name: "readMaterialization",
			readResult,
		});
		const records = collect(bundle.records);
		const priorEvidence = collect(bundle.priorEvidence);
		const evidence = collect(bundle.evidence);
		const status = collect(bundle.status);
		const issues = collect(bundle.issues);
		const audit = collect(bundle.audit);
		const cursor = collect(bundle.cursor);
		const applied = collect(application.records);

		readResult.set(read);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "readResult", to: "readMaterialization/projection" },
				{ from: "readMaterialization/projection", to: "readMaterialization/records" },
				{ from: "readMaterialization/projection", to: "readMaterialization/priorEvidence" },
				{ from: "readMaterialization/projection", to: "readMaterialization/evidence" },
				{ from: "readMaterialization/projection", to: "readMaterialization/status" },
				{ from: "readMaterialization/projection", to: "readMaterialization/issues" },
				{ from: "readMaterialization/projection", to: "readMaterialization/audit" },
				{ from: "readMaterialization/projection", to: "readMaterialization/cursor" },
			]),
		);
		expect(g.describe().edges).not.toContainEqual({
			from: "readMaterialization/records",
			to: "callerRecords",
		});
		expect(data<readonly AgenticMemoryRecord<string>[]>(records.messages).at(-1)).toEqual([
			committedRecord,
		]);
		expect(data(priorEvidence.messages).at(-1)).toMatchObject({
			kind: "agentic-memory-record-application-prior-evidence",
			entries: [],
		});
		expect(data(evidence.messages).at(-1)).toEqual([]);
		expect(
			data<AgenticMemoryCommittedFactReadMaterializationStatus>(status.messages).at(-1),
		).toMatchObject({
			state: "ready",
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			completePrefix: true,
		});
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(data(audit.messages).at(-1)).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "read-result-materialized" })]),
		);
		expect(data(cursor.messages).at(-1)).toMatchObject({
			readFacts: 1,
			materializedRecords: 1,
			done: true,
			completePrefix: true,
		});
		expect(liveRecords.cache).toEqual([]);
		expect(data(applied.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-d591-later-application" }),
		]);

		liveRecords.set(data<readonly AgenticMemoryRecord<string>[]>(records.messages).at(-1)!);
		admissions.set(admissions.cache);

		expect(data<readonly AgenticMemoryRecord<string>[]>(applied.messages).at(-1)).toEqual([
			committedRecord,
			expect.objectContaining({ id: "record-d591-later-application" }),
		]);
	});

	it("reports malformed read material through status/issues/audit, not backend-owned application", () => {
		const malformedFact = {
			format: "graphrefly.agenticMemoryCommittedFact",
			version: 1,
			kind: "agentic-memory-committed-fact",
			family: "record-material",
			coordinates: { subjectId: "bad" },
			identity: { algorithm: "backend-row-id", key: "bad" },
			materialIdentity: { algorithm: "backend-row-id", key: "bad" },
			material: { kind: "agentic-memory-committed-record-material", record: {} },
		};
		const projection = projectAgenticMemoryCommittedFactReadMaterialization({
			facts: [malformedFact],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			done: true,
			issues: [],
			audit: [],
		});
		const badCursor = projectAgenticMemoryCommittedFactReadMaterialization({
			facts: [],
			cursor: { kind: "backend-row-id", position: 0 },
			done: true,
			issues: [],
			audit: [],
		});
		const badDiagnostics = projectAgenticMemoryCommittedFactReadMaterialization({
			facts: [],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
			done: true,
			issues: [null],
			audit: [
				{
					kind: "agentic-memory-fact-log-audit",
					action: "facts-read",
					cursor: { kind: "backend-row-id", position: 0 },
				},
			],
		});

		expect(projection.status.state).toBe("partial");
		expect(projection.records).toEqual([]);
		expect(projection.priorEvidence.entries).toEqual([]);
		expect(projection.issues[0]?.code).toBe(
			"agentic-memory.committed-fact-materialization.invalid-fact",
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "issue-recorded" })]),
		);
		expect(badCursor.status.state).toBe("error");
		expect(badCursor.issues[0]?.code).toBe(
			"agentic-memory.committed-fact-read-materialization.invalid-read-result",
		);
		expect(badCursor.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "read-result-invalid" })]),
		);
		expect(badDiagnostics.status.state).toBe("error");
		expect(badDiagnostics.issues[0]).toMatchObject({
			code: "agentic-memory.committed-fact-read-materialization.invalid-read-result",
			refs: expect.arrayContaining([
				"issues[0] must be an issue object",
				"audit[0].cursor must be a fact-stream cursor",
			]),
		});
		expect(badDiagnostics.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "read-result-invalid" })]),
		);
		expect(JSON.stringify({ projection, badCursor, badDiagnostics })).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hydrate|hydration|restore|commitBarrier/i,
		);
	});

	it("rejects read results whose fact-stream cursor does not cover returned facts", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const first = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d591-cursor-coverage-a",
				fragment: fragment({ id: "fragment-d591-cursor-coverage-a" }),
			}),
			{ operation: "create", correlationId: "d591-cursor-coverage-a" },
		);
		const second = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-d591-cursor-coverage-b",
				fragment: fragment({ id: "fragment-d591-cursor-coverage-b" }),
			}),
			{ operation: "create", correlationId: "d591-cursor-coverage-b" },
		);
		await log.append(agenticMemoryCommittedFactBatch([first, second]));
		const read = await log.read();

		const projection = projectAgenticMemoryCommittedFactReadMaterialization({
			...read,
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
		});

		expect(projection.status).toMatchObject({
			state: "error",
			done: false,
			completePrefix: false,
			factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
		});
		expect(projection.records).toEqual([]);
		expect(projection.priorEvidence.entries).toEqual([]);
		expect(projection.evidence).toEqual([]);
		expect(projection.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.committed-fact-read-materialization.invalid-cursor",
				}),
			]),
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "read-result-invalid" })]),
		);
		expect(JSON.stringify(projection)).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hydrate|hydration|restore|replay|commitBarrier|backendRow/i,
		);
	});
});

describe("AgenticMemory D593 materialized fact-log bootstrap/re-entry boundary", () => {
	it("projects ready D591 materialization into caller-wirable bootstrap input DATA", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d593-ready",
			fragment: fragment({ id: "fragment-d593-ready" }),
		});
		const application = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d593-evidence", proposalId: "d593-evidence" })],
			applicationPolicy(),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			application.applicationDecisions,
		);
		await log.append(
			agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committedRecord, {
					operation: "create",
					correlationId: "d593-ready",
				}),
				agenticMemoryCommittedApplicationEvidenceFact(evidence.evidenceFacts[0]!),
			]),
		);
		const materialization = projectAgenticMemoryCommittedFactReadMaterialization(await log.read());

		const input = agenticMemoryMaterializedFactLogBootstrapInput(materialization);
		const projection = projectAgenticMemoryMaterializedFactLogBootstrap(materialization);

		expect(input).toMatchObject({
			kind: "agentic-memory-materialized-fact-log-bootstrap-input",
			records: [committedRecord],
			priorEvidence: { entries: evidence.evidenceFacts },
			evidence: evidence.evidenceFacts,
		});
		expect(projection).toMatchObject({
			kind: "agentic-memory-materialized-fact-log-bootstrap-projection",
			status: {
				state: "ready",
				readyForCallerWiring: true,
				sourceState: "ready",
				sourceDone: true,
				sourceCompletePrefix: true,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			},
		});
		expect(projection.records).toEqual([committedRecord]);
		expect(projection.priorEvidence.entries).toEqual(evidence.evidenceFacts);
		expect(projection.evidence).toEqual(evidence.evidenceFacts);
		expect(projection.issues).toEqual([]);
		expect(projection.audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				"bootstrap-input-projected",
				"caller-wiring-required",
				"source-materialization-linked",
			]),
		);
		expect(projection).not.toHaveProperty("applicationDecisions");
		expect(projection).not.toHaveProperty("admissions");
		expect(
			JSON.stringify({
				status: projection.status,
				issues: projection.issues,
				audit: projection.audit,
				cursor: projection.cursor,
			}),
		).not.toMatch(
			/applicationAck|acknowledgement|liveGraphTruth|recordMutation|hydrate|hydration|commitBarrier|backend|adapter|sameEvaluationFeedback/i,
		);
	});

	it("treats a complete empty D591 materialization as ready empty bootstrap DATA", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const materialization = projectAgenticMemoryCommittedFactReadMaterialization(await log.read());

		const projection = projectAgenticMemoryMaterializedFactLogBootstrap(materialization);

		expect(materialization.status).toMatchObject({
			state: "empty",
			done: true,
			completePrefix: true,
		});
		expect(projection).toMatchObject({
			records: [],
			evidence: [],
			priorEvidence: { entries: [] },
			status: {
				state: "empty",
				readyForCallerWiring: true,
				sourceState: "empty",
				sourceDone: true,
				sourceCompletePrefix: true,
			},
		});
		expect(projection.issues).toEqual([]);
	});

	it("marks partial D591 materialization as not ready without hiding caller-wirable DATA", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const firstRecord = record({
			id: "record-d593-partial-a",
			fragment: fragment({ id: "fragment-d593-partial-a" }),
		});
		const secondRecord = record({
			id: "record-d593-partial-b",
			fragment: fragment({ id: "fragment-d593-partial-b" }),
		});
		await log.append(
			agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(firstRecord, {
					operation: "create",
					correlationId: "d593-partial-a",
				}),
				agenticMemoryCommittedRecordMaterialFact(secondRecord, {
					operation: "create",
					correlationId: "d593-partial-b",
				}),
			]),
		);
		const materialization = projectAgenticMemoryCommittedFactReadMaterialization(
			await log.read({ limit: 1 }),
		);

		const projection = projectAgenticMemoryMaterializedFactLogBootstrap(materialization);

		expect(materialization.status).toMatchObject({
			state: "partial",
			done: false,
			completePrefix: false,
		});
		expect(projection.records).toEqual([firstRecord]);
		expect(projection.status).toMatchObject({
			state: "partial",
			readyForCallerWiring: false,
			sourceDone: false,
			sourceCompletePrefix: false,
		});
		expect(projection.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "agentic-memory.materialized-fact-log-bootstrap.partial-read",
					severity: "warning",
				}),
			]),
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "partial-read-recorded" })]),
		);
	});

	it("keeps source-issue materialization DATA not ready for automatic bootstrap wiring", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d593-source-issue",
			fragment: fragment({ id: "fragment-d593-source-issue" }),
		});
		await log.append(
			agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committedRecord, {
					operation: "create",
					correlationId: "d593-source-issue",
				}),
			]),
		);
		const materialization = projectAgenticMemoryCommittedFactReadMaterialization(await log.read());
		const issue = {
			kind: "issue" as const,
			code: "agentic-memory.test.source-diagnostic",
			message: "source read diagnostic remains caller-visible",
			severity: "warning" as const,
		};

		const projection = projectAgenticMemoryMaterializedFactLogBootstrap({
			...materialization,
			issues: [issue],
		});

		expect(materialization.status).toMatchObject({
			state: "ready",
			done: true,
			completePrefix: true,
		});
		expect(projection.records).toEqual([committedRecord]);
		expect(projection.status).toMatchObject({
			state: "error",
			readyForCallerWiring: false,
			sourceDone: true,
			sourceCompletePrefix: true,
		});
		expect(projection.issues).toEqual(
			expect.arrayContaining([
				issue,
				expect.objectContaining({
					code: "agentic-memory.materialized-fact-log-bootstrap.source-issues",
					severity: "warning",
				}),
			]),
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ action: "caller-wiring-required" }),
				expect.objectContaining({ action: "issue-recorded" }),
			]),
		);
		expect(jsonForBoundaryText(projection)).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hydrate|hydration|restore|replay|sameEvaluationFeedback|commitBarrier/i,
		);
	});

	it("keeps malformed D591 materialization on the DATA error path", () => {
		const projection = projectAgenticMemoryMaterializedFactLogBootstrap({
			kind: "not-d591",
			records: [{ id: "", fragment: {} }],
			priorEvidence: { kind: "wrong", entries: [] },
			evidence: [{ kind: "not-evidence" }],
			status: {
				state: "ready",
				factLogCursor: { kind: "backend-row-id", position: 10 },
				done: true,
				completePrefix: true,
				cursor: {},
			},
			issues: [null],
			audit: [{ kind: "not-audit", action: "nope" }],
			cursor: {},
		});

		expect(projection.status.state).toBe("error");
		expect(projection.status.readyForCallerWiring).toBe(false);
		expect(projection.records).toEqual([]);
		expect(projection.priorEvidence.entries).toEqual([]);
		expect(projection.evidence).toEqual([]);
		expect(projection.issues.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"agentic-memory.materialized-fact-log-bootstrap.invalid-input",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-records",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-status",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-issues",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
			]),
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "issue-recorded" })]),
		);
	});

	it("keeps malformed but shaped D591 materialization consistency on the DATA error path", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const firstApplication = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d593-consistency-a", proposalId: "d593-consistency-a" })],
			applicationPolicy(),
		);
		const secondApplication = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "d593-consistency-b", proposalId: "d593-consistency-b" })],
			applicationPolicy(),
		);
		const [firstEvidence] = projectAgenticMemoryRecordApplicationEvidenceFacts(
			firstApplication.applicationDecisions,
		).evidenceFacts;
		const [secondEvidence] = projectAgenticMemoryRecordApplicationEvidenceFacts(
			secondApplication.applicationDecisions,
		).evidenceFacts;
		const base = projectAgenticMemoryCommittedFactReadMaterialization(await log.read());
		const malformed = {
			...base,
			priorEvidence: {
				kind: "agentic-memory-record-application-prior-evidence",
				entries: [firstEvidence!],
			},
			evidence: [secondEvidence!],
			status: {
				...base.status,
				state: "ready",
				done: true,
				completePrefix: true,
				cursor: {
					...base.status.cursor,
					factLogCursor: { ...base.status.factLogCursor, position: 7 },
				},
			},
			cursor: {
				...base.cursor,
				evidenceFacts: 1,
				materialization: {
					...base.cursor.materialization,
					facts: -1,
					issues: "bad",
				},
			},
			audit: [
				{
					kind: "agentic-memory-committed-fact-read-materialization-audit",
					action: "read-result-materialized",
					reason: { not: "a string" },
					factLogCursor: { kind: "backend-row-id", position: 1 },
				},
			],
		};

		const projection = projectAgenticMemoryMaterializedFactLogBootstrap(malformed);

		expect(projection.status.state).toBe("error");
		expect(projection.status.readyForCallerWiring).toBe(false);
		expect(projection.issues.map((item) => item.code)).toEqual(
			expect.arrayContaining([
				"agentic-memory.materialized-fact-log-bootstrap.invalid-cursor",
				"agentic-memory.materialized-fact-log-bootstrap.invalid-audit",
				"agentic-memory.materialized-fact-log-bootstrap.inconsistent-materialization",
			]),
		);
		expect(projection.input.sourceCursor.materialization).toMatchObject({
			facts: 0,
			issues: 0,
		});
		expect(projection.input.sourceAudit[0]).toMatchObject({
			kind: "agentic-memory-committed-fact-read-materialization-audit",
			action: "read-result-materialized",
		});
		expect(projection.input.sourceAudit[0]).not.toHaveProperty("reason");
		expect(projection.input.sourceAudit[0]).not.toHaveProperty("factLogCursor");
	});

	it("creates graph-visible ordinary DATA nodes and requires explicit downstream wiring", async () => {
		const g = graph();
		const log = memoryAgenticMemoryCommittedFactLog();
		const committedRecord = record({
			id: "record-d593-graph",
			fragment: fragment({ id: "fragment-d593-graph" }),
		});
		await log.append(
			agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committedRecord, {
					operation: "create",
					correlationId: "d593-graph",
				}),
			]),
		);
		const materializationValue = projectAgenticMemoryCommittedFactReadMaterialization(
			await log.read(),
		);
		const materialization = g.state(materializationValue, { name: "materialization" });
		const liveRecords = g.state<readonly AgenticMemoryRecord<string>[]>([], {
			name: "callerRecords",
		});
		const admissions = g.state(
			[
				admitted({
					admissionId: "d593-later-application",
					proposalId: "d593-later-application",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-d593-later-application",
							fragment: fragment({ id: "fragment-d593-later-application" }),
						}),
					},
				}),
			],
			{ name: "laterAdmissions" },
		);
		const policy = g.state(applicationPolicy(), { name: "laterPolicy" });
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "laterApplication",
			records: liveRecords,
			admissions,
			policy,
		});
		const bundle = agenticMemoryMaterializedFactLogBootstrapBundle(g, {
			name: "bootstrap",
			materialization,
		});
		const bootstrapInput = collect(bundle.bootstrapInput);
		const records = collect(bundle.records);
		const status = collect(bundle.status);
		const issues = collect(bundle.issues);
		const audit = collect(bundle.audit);
		const cursor = collect(bundle.cursor);
		const applied = collect(application.records);

		materialization.set(materializationValue);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "materialization", to: "bootstrap/projection" },
				{ from: "bootstrap/projection", to: "bootstrap/bootstrapInput" },
				{ from: "bootstrap/projection", to: "bootstrap/records" },
				{ from: "bootstrap/projection", to: "bootstrap/priorEvidence" },
				{ from: "bootstrap/projection", to: "bootstrap/evidence" },
				{ from: "bootstrap/projection", to: "bootstrap/status" },
				{ from: "bootstrap/projection", to: "bootstrap/issues" },
				{ from: "bootstrap/projection", to: "bootstrap/audit" },
				{ from: "bootstrap/projection", to: "bootstrap/cursor" },
			]),
		);
		expect(g.describe().edges).not.toContainEqual({
			from: "bootstrap/records",
			to: "callerRecords",
		});
		expect(data(records.messages).at(-1)).toEqual([committedRecord]);
		expect(data(bootstrapInput.messages).at(-1)).toMatchObject({
			kind: "agentic-memory-materialized-fact-log-bootstrap-input",
			records: [committedRecord],
		});
		expect(
			data<AgenticMemoryMaterializedFactLogBootstrapStatus>(status.messages).at(-1),
		).toMatchObject({
			state: "ready",
			readyForCallerWiring: true,
		});
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(data(audit.messages).at(-1)).toEqual(
			expect.arrayContaining([expect.objectContaining({ action: "caller-wiring-required" })]),
		);
		expect(data(cursor.messages).at(-1)).toMatchObject({
			records: 1,
			sourceDone: true,
			sourceCompletePrefix: true,
		});
		expect(liveRecords.cache).toEqual([]);
		expect(data<readonly AgenticMemoryRecord<string>[]>(applied.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-d593-later-application" }),
		]);

		liveRecords.set(data<readonly AgenticMemoryRecord<string>[]>(records.messages).at(-1)!);
		admissions.set(admissions.cache);

		expect(data<readonly AgenticMemoryRecord<string>[]>(applied.messages).at(-1)).toEqual([
			committedRecord,
			expect.objectContaining({ id: "record-d593-later-application" }),
		]);
	});
});

describe("AgenticMemory D588-D593 runtime fact-log persistence composition", () => {
	it("startup read materializes committed history as ordinary caller-wirable DATA", async () => {
		const committed = record({
			id: "record-runtime-startup",
			fragment: fragment({ id: "fragment-runtime-startup" }),
		});
		const applied = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "runtime-startup", proposalId: "runtime-startup" })],
			applicationPolicy(),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(
			applied.applicationDecisions,
		);
		const log = memoryAgenticMemoryCommittedFactLog();
		await log.append(
			agenticMemoryCommittedFactBatch([
				agenticMemoryCommittedRecordMaterialFact(committed),
				agenticMemoryCommittedApplicationEvidenceFact(evidence.evidenceFacts[0]!),
			]),
		);

		const startup = await agenticMemoryCommittedFactLogStartupRead(log, { evaluation: 7 });

		expect(startup).toMatchObject<Partial<AgenticMemoryCommittedFactLogStartupReadResult<string>>>({
			kind: "agentic-memory-committed-fact-log-startup-read-result",
			records: [committed],
			priorEvidence: evidence.priorEvidence,
			evidence: evidence.evidenceFacts,
			bootstrapStatus: {
				state: "ready",
				readyForCallerWiring: true,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			},
			cursor: {
				evaluation: 7,
				factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 2 },
			},
		});
		expect(startup.readResult.facts).toHaveLength(2);
		expect(startup.materialization.kind).toBe(
			"agentic-memory-committed-fact-read-materialization-projection",
		);
		expect(startup.bootstrap.kind).toBe(
			"agentic-memory-materialized-fact-log-bootstrap-projection",
		);
		expect(startup.audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(["read-result-linked", "materialization-linked", "bootstrap-linked"]),
		);
		expect(jsonForBoundaryText(startup)).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier/i,
		);
	});

	it("running append persists canonical batches and surfaces D589/D590 durability DATA only", async () => {
		const log = memoryAgenticMemoryCommittedFactLog();
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-runtime-append",
				fragment: fragment({ id: "fragment-runtime-append" }),
			}),
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);

		const append = await agenticMemoryCommittedFactLogAppendAttempt(log, batch, {
			evaluation: 3,
			downstreamAdvancePolicy:
				agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy("runtime-policy"),
		});
		const read = await log.read();

		expect(append).toMatchObject<Partial<AgenticMemoryCommittedFactLogAppendAttemptResult<string>>>(
			{
				kind: "agentic-memory-committed-fact-log-append-attempt-result",
				batch,
				commitResult: {
					status: "committed",
					facts: 1,
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
				},
				durabilityStatus: {
					state: "durable",
					commitStatus: "committed",
					downstreamAdvance: {
						allowed: true,
						policyId: "runtime-policy",
						reason: "fact-log-committed",
					},
				},
				cursor: {
					evaluation: 3,
					factLogCursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
				},
			},
		);
		expect(read.facts).toEqual([fact]);
		expect(append).not.toHaveProperty("records");
		expect(append).not.toHaveProperty("priorEvidence");
		expect(append).not.toHaveProperty("applicationAck");
		expect(JSON.stringify(append)).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier/i,
		);
	});

	it("does not mutate live records unless caller explicitly wires startup records into app inputs", async () => {
		const committed = record({
			id: "record-runtime-caller-wired",
			fragment: fragment({ id: "fragment-runtime-caller-wired" }),
		});
		const log = memoryAgenticMemoryCommittedFactLog();
		await log.append(
			agenticMemoryCommittedFactBatch([agenticMemoryCommittedRecordMaterialFact(committed)]),
		);
		const startup = await agenticMemoryCommittedFactLogStartupRead(log);
		const g = graph();
		const liveRecords = g.state<readonly AgenticMemoryRecord<string>[]>([], {
			name: "liveRecords",
		});
		const admissions = g.state(
			[admitted({ admissionId: "runtime-live", proposalId: "runtime-live" })],
			{ name: "admissions" },
		);
		const policy = g.state(applicationPolicy(), { name: "policy" });
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "runtimeApplication",
			records: liveRecords,
			admissions,
			policy,
		});
		const applied = collect(application.records);

		admissions.set(admissions.cache);

		expect(liveRecords.cache).toEqual([]);
		expect(data<readonly AgenticMemoryRecord<string>[]>(applied.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-new" }),
		]);

		liveRecords.set(startup.records);
		admissions.set(admissions.cache);

		expect(data<readonly AgenticMemoryRecord<string>[]>(applied.messages).at(-1)).toEqual([
			committed,
			expect.objectContaining({ id: "record-new" }),
		]);
	});

	it("keeps backend cursors diagnostic and uncertain append unresolved until explicit read", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-runtime-uncertain",
				fragment: fragment({ id: "fragment-runtime-uncertain" }),
			}),
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const backendCursor = agenticMemoryCommittedFactLogBackendCursor("sqlite-runtime", {
			rowid: "row-1",
		});
		const log = agenticMemoryCommittedFactLogBackendAdapter({
			append() {
				return {
					status: "uncertain",
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 0 },
					facts: 0,
					issues: [],
					audit: [],
					backendCursor,
				};
			},
			read() {
				return {
					facts: [fact],
					cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
					done: true,
					issues: [],
					audit: [],
					backendCursor,
				};
			},
		});

		const append = await agenticMemoryCommittedFactLogAppendAttempt(log, batch, {
			downstreamAdvancePolicy: agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy(),
		});
		const resolution = agenticMemoryDurabilityUncertainResolutionStatus(append.durability.result);
		const startup = await agenticMemoryCommittedFactLogStartupRead(log);

		expect(append.commitResult.status).toBe("uncertain");
		expect(append.durabilityStatus.state).toBe("uncertain");
		expect(append.durabilityStatus.downstreamAdvance).toMatchObject({
			allowed: false,
			reason: "uncertain-requires-read-resolution",
		});
		expect(resolution).toMatchObject({
			state: "requires-fact-log-read",
			reason: "uncertain-requires-read-idempotency-resolution",
		});
		expect(startup.records).toEqual([
			record({
				id: "record-runtime-uncertain",
				fragment: fragment({ id: "fragment-runtime-uncertain" }),
			}),
		]);
		expect(JSON.stringify(append.cursor.factLogCursor)).not.toContain("row-1");
		expect(JSON.stringify(startup.cursor.factLogCursor)).not.toContain("row-1");
		expect(jsonForBoundaryText({ append, startup })).not.toMatch(
			/applicationAck|liveGraphTruth|recordMutation|hotHydration|hydrate|hydration|restore|liveRefresh|commitBarrier/i,
		);
	});

	it("supports async fact-log adapters only through explicit helper boundaries", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({ id: "record-runtime-async", fragment: fragment({ id: "fragment-runtime-async" }) }),
		);
		const syncLog = memoryAgenticMemoryCommittedFactLog();
		const asyncLog = {
			append(batch) {
				return Promise.resolve(syncLog.append(batch));
			},
			read(opts) {
				return Promise.resolve(syncLog.read(opts));
			},
		} satisfies AgenticMemoryCommittedFactLog<string>;
		const batch = agenticMemoryCommittedFactBatch([fact]);

		const append = await agenticMemoryCommittedFactLogAppendAttempt(asyncLog, batch);
		const startup = await agenticMemoryCommittedFactLogStartupRead(asyncLog);

		expect(append.commitResult.status).toBe("committed");
		expect(startup.records).toEqual([
			record({ id: "record-runtime-async", fragment: fragment({ id: "fragment-runtime-async" }) }),
		]);
		expect(startup.bootstrapStatus.readyForCallerWiring).toBe(true);
		expect(startup.audit.map((entry) => entry.action)).toContain("startup-read-projected");
	});

	it("normalizes async malformed and mutable fact-log outputs before projection", async () => {
		const fact = agenticMemoryCommittedRecordMaterialFact(
			record({
				id: "record-runtime-normalized",
				fragment: fragment({ id: "fragment-runtime-normalized" }),
			}),
		);
		const batch = agenticMemoryCommittedFactBatch([fact]);
		const rawRead = {
			facts: [fact],
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			done: true,
			issues: [],
			audit: [],
			backendCursor: { rowid: "must-not-leak" },
		};
		const rawCommit = {
			status: "committed",
			cursor: { kind: "agentic-memory-fact-stream.cursor", position: 1 },
			facts: 1,
			issues: [],
			audit: [],
			backendCursor: { rowid: "must-not-leak" },
			applicationAck: true,
		};
		const log = {
			append() {
				return Promise.resolve(rawCommit);
			},
			read() {
				return Promise.resolve(rawRead);
			},
		} as AgenticMemoryCommittedFactLog<string>;

		const startup = await agenticMemoryCommittedFactLogStartupRead(log);
		const append = await agenticMemoryCommittedFactLogAppendAttempt(log, batch);
		rawRead.facts = [];
		rawCommit.status = "rejected";
		rawCommit.facts = 0;

		expect(startup.records).toEqual([
			record({
				id: "record-runtime-normalized",
				fragment: fragment({ id: "fragment-runtime-normalized" }),
			}),
		]);
		expect(startup.readResult).not.toHaveProperty("backendCursor");
		expect(append.commitResult).not.toHaveProperty("backendCursor");
		expect(append.commitResult).not.toHaveProperty("applicationAck");
		expect(append.commitResult.status).toBe("committed");
		expect(append.durabilityStatus.state).toBe("durable");
		expect(jsonForBoundaryText({ startup, append })).not.toContain("must-not-leak");

		const malformedLog = {
			append() {
				return Promise.resolve({ status: "committed", cursor: "backend-row", facts: 1 });
			},
			read() {
				return Promise.resolve({ facts: "not-an-array", done: true });
			},
		} as AgenticMemoryCommittedFactLog<string>;
		const malformedStartup = await agenticMemoryCommittedFactLogStartupRead(malformedLog);
		const malformedAppend = await agenticMemoryCommittedFactLogAppendAttempt(malformedLog, batch);

		expect(malformedStartup.readResult.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(["agentic-memory.fact-log-backend.invalid-read-facts"]),
		);
		expect(malformedStartup.bootstrapStatus.state).toBe("partial");
		expect(malformedAppend.commitResult.status).toBe("uncertain");
		expect(malformedAppend.durabilityStatus.state).toBe("uncertain");
	});
});

const record = <T = string>(
	patch: Partial<AgenticMemoryRecord<T>> = {},
): AgenticMemoryRecord<T> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	scope: { sessionId: "session-1", projectId: "project-1" },
	fragment: fragment<T>(),
	...patch,
});

let indexedDbSpecCounter = 0;

function indexedDbSpec(label: string) {
	indexedDbSpecCounter += 1;
	return {
		dbName: `graphrefly-agentic-memory-d594-${label}-${indexedDbSpecCounter}`,
		storeName: "fact-log",
	};
}

async function withIndexedDbMock(indexedDb: IDBFactory, fn: () => Promise<void>): Promise<void> {
	const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "indexedDB");
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: indexedDb,
	});
	try {
		await fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(globalThis, "indexedDB", descriptor);
		} else {
			delete (globalThis as { indexedDB?: unknown }).indexedDB;
		}
	}
}

function createMemoryIndexedDb(opts: { readonly failPut?: boolean } = {}): IDBFactory {
	type StoredDb = {
		readonly stores: Map<string, Map<string, Uint8Array>>;
		version: number;
	};
	const dbs = new Map<string, StoredDb>();

	function requestEvent(type: string): Event {
		return new Event(type);
	}

	function makeRequest<T = unknown>(): IDBRequest<T> {
		return {} as IDBRequest<T>;
	}

	function completeTransaction(tx: Partial<IDBTransaction>): void {
		tx.oncomplete?.call(tx as IDBTransaction, requestEvent("complete"));
	}

	function failTransaction(
		tx: Partial<IDBTransaction>,
		req: Partial<IDBRequest>,
		message: string,
	): void {
		const error = new Error(message) as DOMException;
		req.error = error;
		tx.error = error;
		req.onerror?.call(req as IDBRequest, requestEvent("error"));
		tx.onabort?.call(tx as IDBTransaction, requestEvent("abort"));
	}

	function fakeDb(name: string, stored: StoredDb): IDBDatabase {
		const db = {
			get version() {
				return stored.version;
			},
			objectStoreNames: {
				contains(storeName: string) {
					return stored.stores.has(storeName);
				},
			},
			createObjectStore(storeName: string) {
				if (!stored.stores.has(storeName)) stored.stores.set(storeName, new Map());
				return {} as IDBObjectStore;
			},
			transaction(storeName: string, mode: IDBTransactionMode = "readonly") {
				const store = stored.stores.get(storeName);
				if (store === undefined) {
					throw new Error(`missing object store: ${storeName}`);
				}
				const tx: Partial<IDBTransaction> = {};
				const objectStore = {
					get(key: IDBValidKey) {
						const req = makeRequest<Uint8Array | undefined>();
						queueMicrotask(() => {
							req.result = store.get(String(key));
							req.onsuccess?.call(req, requestEvent("success"));
						});
						return req;
					},
					put(value: Uint8Array, key?: IDBValidKey) {
						if (mode === "readonly") {
							throw new Error("mock IndexedDB readonly transaction cannot write");
						}
						const req = makeRequest<IDBValidKey>();
						queueMicrotask(() => {
							if (opts.failPut) {
								failTransaction(tx, req, "mock IndexedDB put failed");
								return;
							}
							const normalizedKey = String(key);
							store.set(normalizedKey, Uint8Array.from(value));
							req.result = normalizedKey;
							req.onsuccess?.call(req, requestEvent("success"));
							completeTransaction(tx);
						});
						return req;
					},
					getAllKeys() {
						const req = makeRequest<IDBValidKey[]>();
						queueMicrotask(() => {
							req.result = Array.from(store.keys());
							req.onsuccess?.call(req, requestEvent("success"));
						});
						return req;
					},
					delete(key: IDBValidKey) {
						if (mode === "readonly") {
							throw new Error("mock IndexedDB readonly transaction cannot delete");
						}
						const req = makeRequest<undefined>();
						queueMicrotask(() => {
							store.delete(String(key));
							req.onsuccess?.call(req, requestEvent("success"));
							completeTransaction(tx);
						});
						return req;
					},
				};
				tx.objectStore = () => objectStore as unknown as IDBObjectStore;
				return tx as IDBTransaction;
			},
			close() {
				/* no-op */
			},
		};
		Object.defineProperty(db, "name", { value: name });
		return db as IDBDatabase;
	}

	return {
		open(name: string, version?: number) {
			const req = {} as IDBOpenDBRequest;
			queueMicrotask(() => {
				let stored = dbs.get(name);
				if (stored === undefined) {
					stored = { stores: new Map(), version: version ?? 1 };
					dbs.set(name, stored);
					req.result = fakeDb(name, stored);
					req.onupgradeneeded?.call(req, requestEvent("upgradeneeded") as IDBVersionChangeEvent);
					req.onsuccess?.call(req, requestEvent("success"));
					return;
				}
				if (version !== undefined && version > stored.version) {
					stored.version = version;
					req.result = fakeDb(name, stored);
					req.onupgradeneeded?.call(req, requestEvent("upgradeneeded") as IDBVersionChangeEvent);
					req.onsuccess?.call(req, requestEvent("success"));
					return;
				}
				req.result = fakeDb(name, stored);
				req.onsuccess?.call(req, requestEvent("success"));
			});
			return req;
		},
	} as IDBFactory;
}

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

const jsonForBoundaryText = (value: unknown): string =>
	JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

const admitted = <T = string>(
	patch: Partial<AgenticMemoryRecordAdmission<T>> = {},
): AgenticMemoryRecordAdmission<T> => ({
	kind: "agentic-memory-record-admission",
	admissionId: "admission-1",
	proposalId: "proposal-1",
	state: "admitted",
	candidateMaterial: {
		kind: "agentic-memory-record-candidate-material",
		record: record({ id: "record-new", fragment: fragment({ id: "fragment-new" }) }),
		sourceRefs: [{ kind: "import", id: "import-1" }],
	},
	sourceRefs: [{ kind: "review", id: "review-1" }],
	policyRefs: [{ kind: "admission-policy", id: "policy-1" }],
	...patch,
});

const applicationPolicy = (
	patch: Partial<AgenticMemoryRecordApplicationPolicy> = {},
): AgenticMemoryRecordApplicationPolicy => ({
	kind: "agentic-memory-record-application-policy",
	policyId: "application-policy",
	...patch,
});

const applicationMaterialIdentity = <T = string>(
	operation: "create" | "replace" | "update",
	recordValue: AgenticMemoryRecord<T>,
	targetRecordId = recordValue.id,
): AgenticMemoryRecordApplicationMaterialIdentity => ({
	algorithm: AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
	key: textDecoder.decode(
		strictCanonicalJsonBytes({
			format: "graphrefly.agenticMemoryRecordApplicationMaterial",
			version: 1,
			operation,
			operationVersion: 1,
			targetRecordId,
			record: agenticMemoryRecordFrame(recordValue as AgenticMemoryRecord<string>),
		}),
	),
});

describe("AgenticMemory D586 complete-next-record materializer", () => {
	it("materializes create intents into proposal-compatible DATA with refs and coordinates preserved", () => {
		const sourceRefs = [{ kind: "planner", id: "planner-1" }];
		const policyRefs = [{ kind: "materializer-policy", id: "policy-1" }];
		const evidenceRefs = [{ kind: "retrieval-feedback", id: "feedback-1" }];
		const nextRecord = record({
			id: "record-created",
			fragment: fragment({ id: "fragment-created", sources: ["planner-1"] }),
		});
		const projection = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-create",
					operation: "create",
					operationVersion: 1,
					record: nextRecord,
					reason: "complete next record from planner",
					idempotencyKey: "idem-create",
					correlationId: "corr-create",
					sourceRefs,
					policyRefs,
					evidenceRefs,
					metadata: { stage: "materializer" },
				},
			],
			{
				materializerId: "materializer-1",
				sourceRefs: [{ kind: "host-event", id: "event-1" }],
				policyRefs: [{ kind: "workspace-policy", id: "workspace-policy-1" }],
				evaluation: 7,
			},
		);
		const proposal = projection.proposals[0];

		expect(projection).toMatchObject<Partial<AgenticMemoryRecordMaterializationProjection>>({
			kind: "agentic-memory-record-materialization-projection",
			status: { state: "ready" },
			cursor: { evaluation: 7, proposals: 1, candidateMaterials: 1, issues: 0 },
			issues: [],
		});
		expect(projection.candidateMaterials).toEqual([
			expect.objectContaining({
				kind: "agentic-memory-record-candidate-material",
				operation: "create",
				operationVersion: 1,
				record: nextRecord,
				sourceRefs: [
					{ kind: "host-event", id: "event-1" },
					{ kind: "planner", id: "planner-1" },
				],
				policyRefs: [
					{ kind: "workspace-policy", id: "workspace-policy-1" },
					{ kind: "materializer-policy", id: "policy-1" },
				],
				evidenceRefs,
				metadata: { stage: "materializer" },
			}),
		]);
		expect(proposal).toEqual(
			expect.objectContaining({
				kind: "agentic-memory-record-proposal",
				proposalId: compoundTupleKey("agentic-memory-record-proposal", [
					"materializer-1",
					"intent-create",
					"create",
					"record-created",
					"record-created",
				]),
				operation: "create",
				operationVersion: 1,
				reason: "complete next record from planner",
				proposalStatus: "materialized",
				idempotencyKey: "idem-create",
				correlationId: "corr-create",
				causationId: "intent-create",
			}),
		);
		expect(proposal?.candidateMaterial).toBe(projection.candidateMaterials[0]);
		expect(proposal?.evidenceRefs).toEqual(evidenceRefs);
	});

	it("keeps D574 materializer proposal ids collision-safe for open-string coordinates", () => {
		const leftRecord = record({
			id: "record:open::same",
			fragment: fragment({ id: "fragment:left" }),
		});
		const rightRecord = record({
			id: "record:open::same",
			fragment: fragment({ id: "fragment:right" }),
		});
		const left = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent::b",
					operation: "create",
					operationVersion: 1,
					record: leftRecord,
				},
			],
			{ materializerId: "materializer:a" },
		);
		const right = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "a::intent",
					operation: "create",
					operationVersion: 1,
					record: rightRecord,
				},
			],
			{ materializerId: "materializer" },
		);

		expect(left.proposals[0]?.proposalId).toBe(
			compoundTupleKey("agentic-memory-record-proposal", [
				"materializer:a",
				"intent::b",
				"create",
				"record:open::same",
				"record:open::same",
			]),
		);
		expect(right.proposals[0]?.proposalId).toBe(
			compoundTupleKey("agentic-memory-record-proposal", [
				"materializer",
				"a::intent",
				"create",
				"record:open::same",
				"record:open::same",
			]),
		);
		expect(left.proposals[0]?.proposalId).not.toBe(right.proposals[0]?.proposalId);
	});

	it("requires existing full-record replace and update targets before emitting proposals", () => {
		const current = [record({ id: "record-existing", fragment: fragment({ id: "fragment-old" }) })];
		const replacement = record({
			id: "record-existing",
			fragment: fragment({
				id: "fragment-replacement",
				parentFragmentId: "fragment-old",
				payload: "replacement",
			}),
		});
		const update = record({
			id: "record-existing",
			fragment: fragment({
				id: "fragment-update",
				parentFragmentId: "fragment-replacement",
				payload: "update",
			}),
		});
		const projection = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-replace",
					operation: "replace",
					operationVersion: 1,
					targetRecordId: "record-existing",
					record: replacement,
				},
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-update-missing",
					operation: "update",
					operationVersion: 1,
					record: update,
				},
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-update-mismatch",
					operation: "update",
					operationVersion: 1,
					targetRecordId: "record-existing",
					record: record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
				},
			],
			{ records: current },
		);

		expect(projection.proposals).toEqual([
			expect.objectContaining({
				operation: "replace",
				targetRecordId: "record-existing",
				candidateMaterial: expect.objectContaining({
					operation: "replace",
					operationVersion: 1,
					targetRecordId: "record-existing",
					record: replacement,
				}),
			}),
		]);
		expect(projection.issues.map((issue) => issue.refs)).toEqual([
			["update targetRecordId is required"],
			expect.arrayContaining(["update record.id must equal targetRecordId"]),
		]);
		expect(projection.status).toMatchObject({ state: "partial" });
	});

	it("uses sanitized helper-level refs for lineage and never leaks malformed option refs", () => {
		const current = [record({ id: "record-existing", fragment: fragment({ id: "fragment-old" }) })];
		const update = record({
			id: "record-existing",
			fragment: fragment({ id: "fragment-new", payload: "updated" }),
		});
		const lineageFromOptions = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-shared-lineage",
					operation: "update",
					operationVersion: 1,
					targetRecordId: "record-existing",
					record: update,
				},
			],
			{
				records: current,
				sourceRefs: [{ kind: "agentic-memory-fragment", id: "fragment-old" }],
			},
		);
		const malformedOptions = materializeAgenticMemoryRecordChanges(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "intent-bad-option-refs",
					operation: "create",
					operationVersion: 1,
					record: record({ id: "record-option", fragment: fragment({ id: "fragment-option" }) }),
				},
			],
			{ sourceRefs: [null] as never },
		);

		expect(lineageFromOptions.issues).toEqual([]);
		expect(lineageFromOptions.proposals).toEqual([
			expect.objectContaining({
				operation: "update",
				sourceRefs: [{ kind: "agentic-memory-fragment", id: "fragment-old" }],
			}),
		]);
		expect(malformedOptions.issues).toEqual([
			expect.objectContaining({ code: "agentic-memory.materializer.invalid-options" }),
		]);
		expect(malformedOptions.proposals).toEqual([
			expect.not.objectContaining({ sourceRefs: expect.anything() }),
		]);
	});

	it("suppresses duplicate identical intents and rejects divergent duplicates without a winner", () => {
		const nextRecord = record({ id: "record-dupe", fragment: fragment({ id: "fragment-dupe" }) });
		const divergentRecord = record({
			id: "record-divergent",
			fragment: fragment({ id: "fragment-divergent" }),
		});
		const projection = materializeAgenticMemoryRecordChanges([
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-identical",
				operation: "create",
				operationVersion: 1,
				record: nextRecord,
			},
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-identical",
				operation: "create",
				operationVersion: 1,
				record: nextRecord,
			},
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-divergent",
				operation: "create",
				operationVersion: 1,
				record: nextRecord,
			},
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-divergent",
				operation: "create",
				operationVersion: 1,
				record: divergentRecord,
			},
		]);

		expect(projection.proposals.map((item) => item.proposalId)).toEqual([
			compoundTupleKey("agentic-memory-record-proposal", [
				"agentic-memory-record-complete-next-record-materializer",
				"intent-identical",
				"create",
				"record-dupe",
				"record-dupe",
			]),
		]);
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.materializer.duplicate-intent-divergent",
				subjectId: "intent-divergent",
			}),
		]);
		expect(projection.cursor).toMatchObject({
			intents: 4,
			validIntents: 4,
			duplicateIntents: 1,
			divergentIntents: 1,
			proposals: 1,
		});
		expect(projection.audit.map((entry) => entry.action)).toEqual([
			"duplicate-suppressed",
			"divergent-intent",
			"proposal-materialized",
			"issue-recorded",
		]);
	});

	it("fails closed when different intents produce divergent material for one application coordinate", () => {
		const first = record({
			id: "record-coordinate",
			fragment: fragment({ id: "fragment-coordinate-a", payload: "first" }),
		});
		const second = record({
			id: "record-coordinate",
			fragment: fragment({ id: "fragment-coordinate-b", payload: "second" }),
		});
		const projection = materializeAgenticMemoryRecordChanges([
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-coordinate-a",
				operation: "create",
				operationVersion: 1,
				record: first,
			},
			{
				kind: "agentic-memory-record-materialization-intent",
				intentId: "intent-coordinate-b",
				operation: "create",
				operationVersion: 1,
				record: second,
			},
		]);

		expect(projection.proposals).toEqual([]);
		expect(projection.candidateMaterials).toEqual([]);
		expect(projection.status).toMatchObject({
			state: "error",
			cursor: { coordinateConflicts: 1, proposals: 0, issues: 1 },
		});
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.materializer.coordinate-conflict",
				subjectId: "record-coordinate",
				refs: [
					compoundTupleKey("agentic-memory-record-proposal", [
						"agentic-memory-record-complete-next-record-materializer",
						"intent-coordinate-a",
						"create",
						"record-coordinate",
						"record-coordinate",
					]),
					compoundTupleKey("agentic-memory-record-proposal", [
						"agentic-memory-record-complete-next-record-materializer",
						"intent-coordinate-b",
						"create",
						"record-coordinate",
						"record-coordinate",
					]),
				],
			}),
		]);
		expect(projection.audit.map((entry) => entry.action)).toEqual([
			"coordinate-conflict",
			"issue-recorded",
		]);
	});

	it("keeps malformed intents on the DATA issue path in graph bundles", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const intents = g.state(
			[
				{
					kind: "agentic-memory-record-materialization-intent",
					intentId: "bad-intent",
					operation: "patch",
					operationVersion: 1,
					record: record({ id: "record-bad", fragment: fragment({ id: "fragment-bad" }) }),
					patch: [{ op: "replace" }],
				},
			] as never,
			{ name: "intents" },
		);
		const bundle = agenticMemoryRecordMaterializerBundle(g, {
			name: "materializer",
			records,
			intents,
		});
		const projection = collect(bundle.projection);
		const proposals = collect(bundle.proposals);
		const candidateMaterials = collect(bundle.candidateMaterials);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expectTypeOf(bundle).toMatchTypeOf<AgenticMemoryRecordMaterializerBundle<string>>();
		intents.set(intents.cache);

		expect(projection.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(data<readonly AgenticMemoryRecordProposal[]>(proposals.messages).at(-1)).toEqual([]);
		expect(data(candidateMaterials.messages).at(-1)).toEqual([]);
		expect(data<AgenticMemoryRecordMaterializationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { proposals: 0, issues: 1 },
		});
		expect(
			data<readonly { refs?: readonly string[] }[]>(issues.messages).at(-1)?.[0]?.refs,
		).toEqual(
			expect.arrayContaining([
				"intent.patch is not graph-visible DATA",
				"intent.patch is not part of materialization intent",
				"intent.operation must be create, replace, or update",
			]),
		);
		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "materializer/projection" },
				{ from: "intents", to: "materializer/projection" },
				{ from: "materializer/projection", to: "materializer/proposals" },
				{ from: "materializer/projection", to: "materializer/candidateMaterials" },
				{ from: "materializer/projection", to: "materializer/status" },
				{ from: "materializer/projection", to: "materializer/issues" },
				{ from: "materializer/projection", to: "materializer/audit" },
				{ from: "materializer/projection", to: "materializer/cursor" },
			]),
		);
	});

	it("does not mutate inputs or expose storage, hydration, patch, merge, or commit handles", () => {
		const current = [record({ id: "record-existing", fragment: fragment({ id: "fragment-old" }) })];
		const intent = {
			kind: "agentic-memory-record-materialization-intent" as const,
			intentId: "intent-update",
			operation: "update" as const,
			operationVersion: 1 as const,
			targetRecordId: "record-existing",
			record: record({
				id: "record-existing",
				fragment: fragment({ id: "fragment-new", parentFragmentId: "fragment-old" }),
			}),
		};
		const before = structuredClone({
			current: current.map((item) => ({
				...item,
				fragment: { ...item.fragment, tNs: item.fragment.tNs.toString() },
			})),
			intent: {
				...intent,
				record: {
					...intent.record,
					fragment: { ...intent.record.fragment, tNs: intent.record.fragment.tNs.toString() },
				},
			},
		});
		const projection = materializeAgenticMemoryRecordChanges([intent], { records: current });
		const dtoText = JSON.stringify(projection, (_key, value: unknown) =>
			typeof value === "bigint" ? value.toString() : value,
		);

		expect({
			current: current.map((item) => ({
				...item,
				fragment: { ...item.fragment, tNs: item.fragment.tNs.toString() },
			})),
			intent: {
				...intent,
				record: {
					...intent.record,
					fragment: { ...intent.record.fragment, tNs: intent.record.fragment.tNs.toString() },
				},
			},
		}).toEqual(before);
		expect(dtoText).not.toMatch(
			/"(?:storage|storageHandle|storageKey|hydrate|hydration|restore|persist|commit|commitAck|ack|backend|adapter|patch|merge)"/i,
		);
		expect(projection.proposals[0]).toEqual(
			expect.objectContaining({
				operation: "update",
				targetRecordId: "record-existing",
				candidateMaterial: expect.objectContaining({
					record: expect.objectContaining({ id: "record-existing" }),
				}),
			}),
		);
	});
});

describe("agentic memory consolidation bundle (D171)", () => {
	it("projects external consolidation outcomes into result, draft, and command DATA facts", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[
				{
					id: "request-1",
					commandId: "cmd-1",
					recordIds: ["record-a", "record-b"],
					reason: "merge",
				},
			],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [
						record({
							id: "record-merged",
							artifactKind: "insight",
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
					provenance: "external-executor",
				},
			],
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const drafts = collect(bundle.proposedRecordDrafts);
		const proposals = collect(bundle.recordProposals);
		const commands = collect(bundle.commands);
		const results = collect(bundle.results);
		const status = collect(bundle.status);
		const errors = collect(bundle.errors);
		const draftId = compoundTupleKey("agentic-memory-record-draft", [
			"request-1",
			"outcome-1",
			"record-merged",
		]);
		const proposalId = compoundTupleKey("agentic-memory-record-proposal", [
			"request-1",
			"outcome-1",
			"record-merged",
		]);
		const consolidationRefs = [
			{ kind: "agentic-memory-consolidation-request", id: "request-1" },
			{ kind: "agentic-memory-consolidation-outcome", id: "outcome-1" },
			{ kind: "agentic-memory-consolidation-record-draft", id: draftId },
		];

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "consolidation/projection" },
				{ from: "requests", to: "consolidation/projection" },
				{ from: "outcomes", to: "consolidation/projection" },
				{ from: "consolidation/projection", to: "consolidation/results" },
				{ from: "consolidation/projection", to: "consolidation/proposedRecordDrafts" },
				{ from: "consolidation/projection", to: "consolidation/recordProposals" },
				{ from: "consolidation/projection", to: "consolidation/commands" },
			]),
		);
		expect(data(errors.messages).at(-1)).toEqual([]);
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: {
				validOutcomes: 1,
				invalidOutcomes: 0,
				proposedRecordDrafts: 1,
				recordProposals: 1,
			},
		});
		expect(data(drafts.messages).at(-1)).toEqual([
			expect.objectContaining({
				id: draftId,
				requestId: "request-1",
				outcomeId: "outcome-1",
				record: expect.objectContaining({ id: "record-merged" }),
				proposalId,
				candidateMaterial: expect.objectContaining({
					kind: "agentic-memory-record-candidate-material",
					operation: "create",
					operationVersion: 1,
					record: expect.objectContaining({ id: "record-merged" }),
					sourceRefs: consolidationRefs,
					evidenceRefs: consolidationRefs,
				}),
			}),
		]);
		expect(data<readonly AgenticMemoryRecordProposal<string>[]>(proposals.messages).at(-1)).toEqual(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId,
					operation: "create",
					operationVersion: 1,
					candidateMaterial: expect.objectContaining({
						kind: "agentic-memory-record-candidate-material",
						operation: "create",
						operationVersion: 1,
						record: expect.objectContaining({
							id: "record-merged",
							fragment: expect.objectContaining({ id: "merged", payload: "merged insight" }),
						}),
						sourceRefs: consolidationRefs,
						evidenceRefs: consolidationRefs,
					}),
					reason: "merge",
					proposalStatus: "consolidation-proposed",
					sourceRefs: consolidationRefs,
					evidenceRefs: consolidationRefs,
					idempotencyKey: proposalId,
					correlationId: "request-1",
					causationId: "outcome-1",
				},
			],
		);
		expect(data(results.messages).at(-1)).toEqual([
			expect.objectContaining({
				state: "proposed",
				proposedRecordIds: ["record-merged"],
				proposalIds: [proposalId],
			}),
		]);
		expect(data<readonly AgenticMemoryConsolidationCommand[]>(commands.messages).at(-1)).toEqual([
			{
				id: compoundTupleKey("agentic-memory-consolidation-command", [
					compoundTupleKey("agentic-memory-consolidation-result", ["request-1", "outcome-1"]),
					"proposeRecords",
				]),
				kind: "proposeRecords",
				requestId: "request-1",
				outcomeId: "outcome-1",
				draftIds: [draftId],
				proposalIds: [proposalId],
			},
		]);
	});

	it("composes consolidation proposals through admission and application into record truth", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a", "record-b"] }],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [
						record({
							id: "record-merged",
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const nextRecords = collect(bundle.records);
		const admitted = collect(bundle.admission.admitted);
		const decisions = collect(bundle.applicationDecisions);
		const status = collect(bundle.applicationStatus);
		const issues = collect(bundle.applicationIssues);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{
					from: "consolidationApplication/consolidation/recordProposals",
					to: "consolidationApplication/admission/projection",
				},
				{
					from: "consolidationApplication/admission/admissions",
					to: "consolidationApplication/application/projection",
				},
				{ from: "records", to: "consolidationApplication/application/projection" },
				{
					from: "consolidationApplication/application/projection",
					to: "consolidationApplication/application/records",
				},
			]),
		);
		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[expect.objectContaining({ proposalId: expect.stringContaining("record-merged") })],
		);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => r.id),
		).toEqual(["record-a", "record-b", "record-merged"]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => decision.state),
		).toEqual(["applied"]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { applied: 1, rejected: 0, skipped: 0 },
		});
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-a", "record-b"]);
	});

	it("composes consolidation replace proposals through D578 application", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a", payload: "old insight" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b", payload: "kept" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					applicationOperation: "replace",
					operationVersion: 1,
					targetRecordIds: ["record-a"],
					records: [
						record({
							id: "record-a",
							fragment: fragment({ id: "a-next", payload: "updated insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const drafts = collect(bundle.consolidation.proposedRecordDrafts);
		const proposals = collect(bundle.consolidation.recordProposals);
		const nextRecords = collect(bundle.records);
		const decisions = collect(bundle.applicationDecisions);
		const issues = collect(bundle.applicationIssues);

		expect(
			data<readonly AgenticMemoryConsolidationRecordDraft<string>[]>(drafts.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				applicationOperation: "replace",
				operationVersion: 1,
				targetRecordId: "record-a",
				candidateMaterial: expect.objectContaining({
					operation: "replace",
					operationVersion: 1,
					targetRecordId: "record-a",
					sourceRefs: expect.arrayContaining([
						{ kind: "agentic-memory-record", id: "record-a" },
						{ kind: "agentic-memory-fragment", id: "a" },
					]),
				}),
			}),
		]);
		expect(data<readonly AgenticMemoryRecordProposal<string>[]>(proposals.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					operation: "replace",
					operationVersion: 1,
					targetRecordId: "record-a",
				}),
			],
		);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => [r.id, r.fragment.id, r.fragment.payload]),
		).toEqual([
			["record-a", "a-next", "updated insight"],
			["record-b", "b", "kept"],
		]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				operation: "replace",
				reasonCode: "applied-replace",
				state: "applied",
				targetRecordId: "record-a",
			}),
		]);
		expect(data(issues.messages).at(-1)).toEqual([]);
	});

	it("composes consolidation update proposals through D580 application", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a", payload: "old insight" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b", payload: "kept" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					applicationOperation: "update",
					operationVersion: 1,
					targetRecordIds: ["record-a"],
					records: [
						record({
							id: "record-a",
							fragment: fragment({ id: "a-next", payload: "updated insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const drafts = collect(bundle.consolidation.proposedRecordDrafts);
		const proposals = collect(bundle.consolidation.recordProposals);
		const nextRecords = collect(bundle.records);
		const decisions = collect(bundle.applicationDecisions);
		const issues = collect(bundle.applicationIssues);

		expect(
			data<readonly AgenticMemoryConsolidationRecordDraft<string>[]>(drafts.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				applicationOperation: "update",
				operationVersion: 1,
				targetRecordId: "record-a",
				candidateMaterial: expect.objectContaining({
					operation: "update",
					operationVersion: 1,
					targetRecordId: "record-a",
				}),
			}),
		]);
		expect(data<readonly AgenticMemoryRecordProposal<string>[]>(proposals.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					operation: "update",
					operationVersion: 1,
					targetRecordId: "record-a",
				}),
			],
		);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => [r.id, r.fragment.id, r.fragment.payload]),
		).toEqual([
			["record-a", "a-next", "updated insight"],
			["record-b", "b", "kept"],
		]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				operation: "update",
				reasonCode: "applied-update",
				state: "applied",
				targetRecordId: "record-a",
			}),
		]);
		expect(data(issues.messages).at(-1)).toEqual([]);
	});

	it("does not apply consolidation proposals that admission rejects", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [
						record({
							id: "record-merged",
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
				},
			],
			{ name: "outcomes" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "rejected",
			},
			{ name: "admissionPolicy" },
		);
		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "applicationPolicy" },
		);
		const bundle = agenticMemoryConsolidationApplicationBundle(g, {
			name: "consolidationApplication",
			records,
			requests,
			outcomes,
			admissionPolicy,
			applicationPolicy: applicationPolicyNode,
		});
		const nextRecords = collect(bundle.records);
		const admissions = collect(bundle.admission.admissions);
		const decisions = collect(bundle.applicationDecisions);
		const status = collect(bundle.applicationStatus);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admissions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "rejected" })]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((r) => r.id),
		).toEqual(["record-a"]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => decision.state),
		).toEqual(["skipped"]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { applied: 0, skipped: 1 },
		});
	});

	it("keeps invalid consolidation outcomes on the DATA error path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state(
			[
				{ id: "missing", requestId: "missing-request", kind: "failed", message: "nope" },
				{
					id: "bad-record",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [record({ id: "", fragment: fragment({ id: "" }) })],
				},
			] as never,
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["missing-request-ref", "invalid-proposed-record"]);
		expect(data<AgenticMemoryConsolidationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validOutcomes: 0, invalidOutcomes: 2 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects malformed consolidation replace outcomes before proposal application", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					applicationOperation: "replace",
					records: [record({ id: "record-a", fragment: fragment({ id: "a-next" }) })],
				},
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [record({ id: "record-b", fragment: fragment({ id: "b" }) })],
				},
				{
					id: "outcome-2",
					requestId: "request-1",
					kind: "proposedRecords",
					applicationOperation: "update",
					records: [record({ id: "record-a", fragment: fragment({ id: "a-next" }) })],
				},
			],
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const errors = collect(bundle.errors);
		const proposals = collect(bundle.recordProposals);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-proposed-record", "duplicate-outcome-id", "invalid-proposed-record"]);
		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.validationErrors),
		).toEqual([
			["replace outcome.targetRecordIds must align with records"],
			["duplicate outcome id 'outcome-1'"],
			["update outcome.targetRecordIds must align with records"],
		]);
		expect(data<readonly AgenticMemoryRecordProposal[]>(proposals.messages).at(-1)).toEqual([]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects duplicate proposed record ids and hostile outcome arrays as DATA errors", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = [
			{
				id: "dupe-records",
				requestId: "request-1",
				kind: "proposedRecords",
				records: [
					record({ id: "record-merged", fragment: fragment({ id: "merged-a" }) }),
					record({ id: "record-merged", fragment: fragment({ id: "merged-b" }) }),
				],
			},
			{
				id: "unreadable",
				requestId: "request-1",
				kind: "failed",
				message: "unreachable",
			},
		] as unknown[];
		Object.defineProperty(outcomes, "1", {
			get() {
				throw new Error("outcome getter exploded");
			},
		});
		const outcomeNode = g.state(outcomes as never, { name: "outcomes" });
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes: outcomeNode,
		});
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const proposals = collect(bundle.recordProposals);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-proposed-record", "invalid-outcome"]);
		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages).at(-1)?.[0]
				?.validationErrors,
		).toEqual(["records[1]: duplicate proposed record id 'record-merged'"]);
		expect(data<AgenticMemoryConsolidationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validOutcomes: 0, invalidOutcomes: 2, proposedRecordDrafts: 0, recordProposals: 0 },
		});
		expect(data<readonly AgenticMemoryRecordProposal[]>(proposals.messages).at(-1)).toEqual([]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory admission policy source projection (D583)", () => {
	it("projects static policy DATA while preserving sourceRefs, policyRefs, and metadata", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy",
			policyId: "static-policy",
			defaultState: "admitted",
			requireSourceRefs: true,
			sourceRefs: [{ kind: "workspace-policy", id: "workspace-1" }],
			policyRefs: [{ kind: "human-review", id: "review-1" }],
			metadata: { revision: 2, owner: "memory" },
		});

		expect(projection).toMatchObject<Partial<AgenticMemoryRecordAdmissionPolicySourceProjection>>({
			kind: "agentic-memory-record-admission-policy-source-projection",
			admissionPolicy: {
				kind: "agentic-memory-record-admission-policy",
				policyId: "static-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
				metadata: { revision: 2, owner: "memory" },
			},
			status: { state: "ready" },
			issues: [],
			cursor: { validCandidates: 1, selectedCandidates: 1 },
		});
		expect(projection.admissionPolicy.sourceRefs).toEqual(
			expect.arrayContaining([{ kind: "workspace-policy", id: "workspace-1" }]),
		);
		expect(projection.admissionPolicy.policyRefs).toEqual(
			expect.arrayContaining([
				{ kind: "human-review", id: "review-1" },
				{ kind: "agentic-memory-record-admission-policy", id: "static-policy" },
			]),
		);
	});

	it("turns malformed policy source material into DATA issues, not protocol errors", () => {
		const g = graph();
		const policySources = g.state(
			[
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "workspace-source",
					sourceKind: "workspace",
					priority: 0,
					material: {
						kind: "agentic-memory-record-admission-policy-material",
						admissionPolicy: {
							kind: "agentic-memory-record-admission-policy",
							policyId: "",
							defaultState: "maybe",
							storageHandle: "nope",
						},
					},
				},
			],
			{ name: "policySources" },
		);
		const bundle = agenticMemoryRecordAdmissionPolicySourceBundle(g, {
			name: "policySource",
			policySources,
		});
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);
		const selectedPolicy = collect(bundle.admissionPolicy);

		expect(
			data<readonly { readonly code: string; readonly refs?: readonly string[] }[]>(
				issues.messages,
			).at(-1),
		).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.candidate-invalid",
				refs: expect.arrayContaining([
					"admissionPolicy.storageHandle is not graph-visible DATA",
					"admissionPolicy.policyId must be non-empty",
					"admissionPolicy.defaultState must be admitted, rejected, or needs-review",
				]),
			}),
		]);
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validCandidates: 0, invalidCandidates: 1, selectedCandidates: 0 },
		});
		expect(data<AgenticMemoryRecordAdmissionPolicy>(selectedPolicy.messages).at(-1)).toEqual({
			kind: "agentic-memory-record-admission-policy",
			policyId: "invalid-admission-policy-source",
			defaultState: "rejected",
			policyRefs: [{ kind: "agentic-memory-record-admission-policy-source", id: "invalid" }],
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects accessor-backed metadata without executing getters", () => {
		let executed = false;
		const metadata = {};
		Object.defineProperty(metadata, "secret", {
			get() {
				executed = true;
				throw new Error("metadata getter should not execute");
			},
			enumerable: true,
		});

		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy",
			policyId: "hostile-metadata-policy",
			metadata,
		});

		expect(executed).toBe(false);
		expect(projection.status.state).toBe("error");
		expect(projection.admissionPolicy.policyId).toBe("invalid-admission-policy-source");
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.candidate-invalid",
				refs: expect.arrayContaining(["admissionPolicy.metadata.secret must be a data property"]),
			}),
		]);
	});

	it("rejects unsafe priority integers before selection and audit output", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource([
			{
				kind: "agentic-memory-record-admission-policy-source",
				sourceId: "unsafe-priority",
				sourceKind: "workspace",
				priority: Number.MAX_SAFE_INTEGER + 1,
				material: {
					kind: "agentic-memory-record-admission-policy",
					policyId: "unsafe-priority-policy",
				},
			},
		]);

		expect(projection.status.state).toBe("error");
		expect(projection.admissionPolicy.policyId).toBe("invalid-admission-policy-source");
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.candidate-invalid",
				refs: expect.arrayContaining([
					"policySource.priority must be a finite safe integer when present",
				]),
			}),
		]);
	});

	it("selects by explicit priority deterministically and records inspectable audit", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy-selection-input",
			sourceRefs: [{ kind: "workspace-policy-selection", id: "selection-source" }],
			policyRefs: [{ kind: "workspace-policy-selection-policy", id: "selection-policy" }],
			metadata: { selector: "workspace-order" },
			sources: [
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "workspace",
					sourceKind: "workspace",
					priority: 20,
					material: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "workspace-policy",
						defaultState: "needs-review",
					},
				},
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "planner",
					sourceKind: "planner",
					priority: 10,
					material: {
						kind: "agentic-memory-record-admission-policy-material",
						admissionPolicy: {
							kind: "agentic-memory-record-admission-policy",
							policyId: "planner-policy",
							defaultState: "admitted",
						},
						policyRefs: [{ kind: "planner-policy-material", id: "planner-material" }],
					},
					sourceRefs: [{ kind: "planner", id: "plan-1" }],
				},
			],
		});

		expect(projection.admissionPolicy.policyId).toBe("planner-policy");
		expect(projection.admissionPolicy.defaultState).toBe("admitted");
		expect(projection.admissionPolicy.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "planner", id: "plan-1" },
				{ kind: "workspace-policy-selection", id: "selection-source" },
			]),
		);
		expect(projection.admissionPolicy.policyRefs).toEqual(
			expect.arrayContaining([
				{ kind: "planner-policy-material", id: "planner-material" },
				{ kind: "workspace-policy-selection-policy", id: "selection-policy" },
			]),
		);
		expect(projection.audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "candidate-selected",
					sourceId: "planner",
					policyId: "planner-policy",
					priority: 10,
					reason: "lowest-priority",
					metadata: { selector: "workspace-order" },
				}),
			]),
		);
		expect(projection.cursor).toMatchObject({
			sources: 2,
			candidates: 2,
			validCandidates: 2,
			selectedCandidates: 1,
		});
	});

	it("keeps NUL-containing refs distinct while deduping provenance", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy-selection-input",
			sourceRefs: [
				{ kind: "a\u0000b", id: "c" },
				{ kind: "a", id: "b\u0000c" },
				{ kind: "a\u0000b", id: "c" },
			],
			sources: [
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "nul-source",
					sourceKind: "workspace",
					priority: 0,
					material: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "nul-policy",
					},
				},
			],
		});

		expect(projection.admissionPolicy.sourceRefs).toEqual([
			{ kind: "a\u0000b", id: "c" },
			{ kind: "a", id: "b\u0000c" },
		]);
	});

	it("blocks duplicate candidate ids instead of selecting a hidden winner", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy-selection-input",
			candidates: [
				{
					kind: "agentic-memory-record-admission-policy-candidate",
					candidateId: "same-candidate",
					sourceId: "source-a",
					sourceKind: "workspace",
					priority: 0,
					admissionPolicy: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "policy-a",
					},
				},
				{
					kind: "agentic-memory-record-admission-policy-candidate",
					candidateId: "same-candidate",
					sourceId: "source-b",
					sourceKind: "planner",
					priority: 10,
					admissionPolicy: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "policy-b",
					},
				},
			],
		});

		expect(projection.status.state).toBe("blocked");
		expect(projection.admissionPolicy.policyId).toBe("invalid-admission-policy-source");
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.duplicate-candidate",
				refs: expect.arrayContaining(["same-candidate", "source-a", "source-b"]),
			}),
		]);
		expect(projection.audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "selection-blocked",
					candidateId: "same-candidate",
					reason: "duplicate-candidate",
				}),
			]),
		);
	});

	it("does not count candidate-only arrays as policy sources", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource([
			{
				kind: "agentic-memory-record-admission-policy-candidate",
				candidateId: "candidate-only",
				sourceId: "planner",
				sourceKind: "planner",
				priority: 0,
				admissionPolicy: {
					kind: "agentic-memory-record-admission-policy",
					policyId: "candidate-only-policy",
				},
			},
		]);

		expect(projection.status.state).toBe("ready");
		expect(projection.cursor).toMatchObject({
			sources: 0,
			candidates: 1,
			validCandidates: 1,
			selectedCandidates: 1,
		});
		expect(projection.admissionPolicy.policyId).toBe("candidate-only-policy");
	});

	it("keeps accessor-backed source entries isolated as DATA issues", () => {
		const sources = [
			{
				kind: "agentic-memory-record-admission-policy-source",
				sourceId: "good-source",
				sourceKind: "workspace",
				priority: 1,
				material: {
					kind: "agentic-memory-record-admission-policy",
					policyId: "good-policy",
					defaultState: "admitted",
				},
			},
		] as unknown[];
		Object.defineProperty(sources, "1", {
			get() {
				throw new Error("source getter should not execute");
			},
			enumerable: true,
		});
		sources.length = 2;

		const projection = projectAgenticMemoryRecordAdmissionPolicySource(sources);

		expect(projection.admissionPolicy.policyId).toBe("good-policy");
		expect(projection.status.state).toBe("partial");
		expect(projection.cursor).toMatchObject({
			candidates: 2,
			validCandidates: 1,
			invalidCandidates: 1,
			selectedCandidates: 1,
		});
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.candidate-invalid",
				message: "policySource[1] must be a data property",
			}),
		]);
	});

	it("rejects accessor-backed nested policy material before selecting it", () => {
		const hostilePolicy = {
			kind: "agentic-memory-record-admission-policy",
		};
		Object.defineProperty(hostilePolicy, "policyId", {
			get() {
				throw new Error("policy getter should not execute");
			},
			enumerable: true,
		});
		const projection = projectAgenticMemoryRecordAdmissionPolicySource([
			{
				kind: "agentic-memory-record-admission-policy-source",
				sourceId: "hostile-source",
				sourceKind: "planner",
				priority: 0,
				material: hostilePolicy,
			},
		]);

		expect(projection.status.state).toBe("error");
		expect(projection.admissionPolicy.policyId).toBe("invalid-admission-policy-source");
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.candidate-invalid",
				refs: expect.arrayContaining(["policyMaterial.policyId must be a data property"]),
			}),
		]);
	});

	it("blocks ambiguous same-priority selection without choosing a hidden winner", () => {
		const projection = projectAgenticMemoryRecordAdmissionPolicySource({
			kind: "agentic-memory-record-admission-policy-selection-input",
			sources: [
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "workspace",
					sourceKind: "workspace",
					priority: 1,
					material: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "workspace-policy",
					},
				},
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "review",
					sourceKind: "human-review",
					priority: 1,
					material: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "review-policy",
					},
				},
			],
		});

		expect(projection.status.state).toBe("blocked");
		expect(projection.admissionPolicy.policyId).toBe("invalid-admission-policy-source");
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.admission-policy-source.ambiguous-selection",
			}),
		]);
		expect(projection.audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "selection-blocked",
					reason: "ambiguous-priority",
				}),
			]),
		);
	});

	it("creates an inspectable graph bundle without emitting proposal admissions", () => {
		const g = graph();
		const policySources = g.state(
			[
				{
					kind: "agentic-memory-record-admission-policy-source",
					sourceId: "static-source",
					sourceKind: "static",
					priority: 0,
					material: {
						kind: "agentic-memory-record-admission-policy",
						policyId: "static-policy",
						defaultState: "admitted",
					},
				},
			] as const,
			{ name: "policySources" },
		);
		const bundle = agenticMemoryRecordAdmissionPolicySourceBundle(g, {
			name: "policySource",
			policySources,
		});
		const selectedPolicy = collect(bundle.admissionPolicy);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "policySources", to: "policySource/projection" },
				{ from: "policySource/projection", to: "policySource/admissionPolicy" },
				{ from: "policySource/projection", to: "policySource/status" },
				{ from: "policySource/projection", to: "policySource/issues" },
				{ from: "policySource/projection", to: "policySource/audit" },
				{ from: "policySource/projection", to: "policySource/cursor" },
			]),
		);
		expect(Object.hasOwn(bundle, "admissions")).toBe(false);
		expect(Object.hasOwn(bundle, "records")).toBe(false);
		expect(data<AgenticMemoryRecordAdmissionPolicy>(selectedPolicy.messages).at(-1)).toMatchObject({
			policyId: "static-policy",
			defaultState: "admitted",
		});
	});
});

describe("agentic memory record proposal admission (D572/D573)", () => {
	it("admits proposal facts without applying AgenticMemoryRecord truth", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-new",
							fragment: fragment({ id: "new", payload: "new insight" }),
						}),
					},
					reason: "human-approved import",
					sourceRefs: [{ kind: "review", id: "review-1" }],
					policyRefs: [{ kind: "policy", id: "mapper-1" }],
					idempotencyKey: "idem-1",
					correlationId: "corr-1",
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
				policyRefs: [{ kind: "policy", id: "admission-policy" }],
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		const status = collect(bundle.status);
		const audit = collect(bundle.audit);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "admission/projection" },
				{ from: "proposals", to: "admission/projection" },
				{ from: "policy", to: "admission/projection" },
				{ from: "admission/projection", to: "admission/admitted" },
				{ from: "admission/projection", to: "admission/audit" },
			]),
		);
		expect(Object.hasOwn(bundle, "records")).toBe(false);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { admitted: 1, rejected: 0, needsReview: 0, invalidProposals: 0 },
		});
		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					kind: "agentic-memory-record-admission",
					admissionId: 'admission:["admission-policy","proposal-1"]',
					proposalId: "proposal-1",
					state: "admitted",
					candidateMaterial: expect.objectContaining({
						record: expect.objectContaining({ id: "record-new" }),
					}),
					sourceRefs: expect.arrayContaining([{ kind: "review", id: "review-1" }]),
					policyRefs: expect.arrayContaining([
						{ kind: "agentic-memory-record-admission-policy", id: "admission-policy" },
					]),
					idempotencyKey: "idem-1",
					correlationId: "corr-1",
				}),
			],
		);
		expect(data(audit.messages).at(-1)).toEqual([
			expect.objectContaining({
				kind: "agentic-memory-record-admission-audit",
				proposalId: "proposal-1",
				state: "admitted",
			}),
		]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("rejects duplicate candidate ids and routes missing provenance to needs-review", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "duplicate",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-existing",
							fragment: fragment({ id: "replacement" }),
						}),
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "missing-source",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-new",
							fragment: fragment({ id: "new" }),
						}),
					},
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const rejected = collect(bundle.rejected);
		const needsReview = collect(bundle.needsReview);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(rejected.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					proposalId: "duplicate",
					state: "rejected",
					reason: "candidate record id already exists",
				}),
			],
		);
		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(needsReview.messages).at(-1),
		).toEqual([
			expect.objectContaining({
				proposalId: "missing-source",
				state: "needs-review",
				reason: "policy requires sourceRefs",
			}),
		]);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { admitted: 0, rejected: 1, needsReview: 1 },
		});
	});

	it("keeps malformed proposals on the DATA issue path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "bad-candidate",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "", fragment: fragment({ id: "" }) }),
				},
				sourceRefs: [{ kind: "import", id: "import-1" }],
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "unreadable",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "unreadable", fragment: fragment({ id: "unreadable" }) }),
				},
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "runtime-field",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({
						id: "runtime-field",
						fragment: fragment({ id: "runtime-field" }),
					}),
					attribution: {
						fragmentId: "runtime-field",
						recordId: "runtime-field",
						permission: "nope",
						graph: "nope",
					},
				},
				sourceRefs: [
					{
						kind: "import",
						id: "import-1",
						callback: () => undefined,
						metadata: { note: "invalid ref field" },
					},
				],
				storageKey: "private-storage-key",
				metadata: { ok: true },
			},
		] as unknown[];
		Object.defineProperty(proposals, "1", {
			get() {
				throw new Error("proposal getter exploded");
			},
		});
		const proposalNode = g.state(proposals as never, { name: "proposals" });
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{ kind: "agentic-memory-record-admission-policy", policyId: "admission-policy" },
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals: proposalNode,
			policy,
		});
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		const latestIssues = data<
			readonly {
				readonly code: string;
				readonly details?: unknown;
				readonly refs?: readonly string[];
			}[]
		>(issues.messages).at(-1);
		expect(latestIssues?.map((issue) => issue.code)).toEqual([
			"agentic-memory.proposal.invalid",
			"agentic-memory.proposal.invalid",
			"agentic-memory.proposal.invalid",
		]);
		expect(latestIssues?.every((issue) => !Object.hasOwn(issue, "details"))).toBe(true);
		expect(latestIssues?.[2]?.refs).toEqual(
			expect.arrayContaining([
				"proposal.storageKey is not graph-visible DATA",
				"proposal.sourceRefs: [0] has unexpected fields callback",
				"candidateMaterial: candidateMaterial.attribution.permission is not graph-visible DATA",
				"candidateMaterial: candidateMaterial.attribution.graph is not graph-visible DATA",
			]),
		);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validProposals: 0, invalidProposals: 3 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps malformed admission policies on the DATA issue path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{ name: "proposals" },
		);
		const hostilePolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "hostile-policy",
		};
		Object.defineProperty(hostilePolicy, "sourceRefs", {
			get() {
				throw new Error("policy getter exploded");
			},
			enumerable: true,
		});
		const policy = g.state(hostilePolicy as never, { name: "policy" });
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const rejected = collect(bundle.rejected);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(rejected.messages).at(-1)).toEqual(
			[
				expect.objectContaining({
					proposalId: "proposal-1",
					state: "rejected",
					reason: "policy:invalid-policy",
				}),
			],
		);
		const latestIssues = data<readonly { readonly code: string; readonly details?: unknown }[]>(
			issues.messages,
		).at(-1);
		expect(latestIssues).toEqual([
			expect.objectContaining({ code: "agentic-memory.admission-policy.invalid" }),
		]);
		expect(latestIssues?.every((issue) => !Object.hasOwn(issue, "details"))).toBe(true);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 0, invalidPolicies: 1, rejected: 1 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("exposes a deterministic pure proposal admission helper", () => {
		const proposals: readonly AgenticMemoryRecordProposal<string>[] = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal:a",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "record:a", fragment: fragment({ id: "fragment:a" }) }),
					sourceRefs: [{ kind: "candidate", id: "source:a" }],
				},
				sourceRefs: [{ kind: "proposal", id: "source:b" }],
				policyRefs: [{ kind: "proposal-policy", id: "policy:a" }],
				evidenceRefs: [{ kind: "evidence", id: "evidence:a" }],
				idempotencyKey: "idem:a",
				correlationId: "corr:a",
			},
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal:b",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({ id: "record:b", fragment: fragment({ id: "fragment:b" }) }),
				},
				sourceRefs: [{ kind: "proposal", id: "source:c" }],
			},
		];
		const policy: AgenticMemoryProposalAdmissionPolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "policy:a",
			defaultState: "admitted",
			requireSourceRefs: true,
			policyRefs: [{ kind: "policy", id: "policy:b" }],
		};

		const snapshot = admitAgenticMemoryRecordProposals(proposals, policy, {
			records: [record({ id: "record:b", fragment: fragment({ id: "existing-b" }) })],
			evaluation: 7,
		});

		expect(snapshot.admissions.map((admission) => admission.proposalId)).toEqual([
			"proposal:a",
			"proposal:b",
		]);
		expect(snapshot.admitted).toEqual([
			expect.objectContaining<Partial<AgenticMemoryProposalAdmissionDecision<string>>>({
				admissionId: 'admission:["policy:a","proposal:a"]',
				state: "admitted",
				idempotencyKey: "idem:a",
				correlationId: "corr:a",
				sourceRefs: [
					{ kind: "candidate", id: "source:a" },
					{ kind: "proposal", id: "source:b" },
				],
				evidenceRefs: [{ kind: "evidence", id: "evidence:a" }],
			}),
		]);
		expect(snapshot.rejected).toEqual([
			expect.objectContaining({
				admissionId: 'admission:["policy:a","proposal:b"]',
				proposalId: "proposal:b",
				state: "rejected",
				reason: "candidate record id already exists",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "ready",
			cursor: { evaluation: 7, admitted: 1, rejected: 1, needsReview: 0, issues: 0 },
		});
		expect(snapshot.audit.map((entry) => entry.admissionId)).toEqual([
			'admission:["policy:a","proposal:a"]',
			'admission:["policy:a","proposal:b"]',
		]);
	});

	it("freezes malformed proposal input snapshots", () => {
		const snapshot = admitAgenticMemoryRecordProposals("not-proposals", {
			kind: "agentic-memory-record-admission-policy",
			policyId: "policy:a",
			defaultState: "admitted",
		});

		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { invalidProposals: 1, validProposals: 0 },
		});
		expect(Object.isFrozen(snapshot.admissions)).toBe(true);
		expect(Object.isFrozen(snapshot.admitted)).toBe(true);
		expect(Object.isFrozen(snapshot.rejected)).toBe(true);
		expect(Object.isFrozen(snapshot.needsReview)).toBe(true);
		expect(Object.isFrozen(snapshot.issues)).toBe(true);
		expect(Object.isFrozen(snapshot.audit)).toBe(true);
	});

	it("reports malformed helper records as DATA issues without throwing", () => {
		const hostileRecord = Object.defineProperty({}, "id", {
			get() {
				throw new Error("hostile id");
			},
		}) as AgenticMemoryRecord<string>;

		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal:a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record:a", fragment: fragment({ id: "fragment:a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import:a" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy:a",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ records: [hostileRecord] },
		);

		expect(snapshot.admitted).toEqual([expect.objectContaining({ proposalId: "proposal:a" })]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.record.invalid",
				message: "agenticMemoryBundle: record access failed: hostile id",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { admitted: 1, issues: 1 },
		});
	});

	it("fails closed when admission policy material is missing", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
				},
			],
			undefined,
		);

		expect(snapshot.rejected).toEqual([
			expect.objectContaining({
				proposalId: "proposal-1",
				state: "rejected",
				admissionId: 'admission:["invalid-policy","proposal-1"]',
			}),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({ code: "agentic-memory.admission-policy.invalid" }),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { invalidPolicies: 1, rejected: 1, admitted: 0 },
		});
	});

	it("fails closed when proposal and candidate target ids conflict", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					targetRecordId: "record-target-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
						targetRecordId: "record-target-b",
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy-1",
				defaultState: "admitted",
			},
		);

		expect(snapshot.admissions).toEqual([]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.proposal.invalid",
				refs: expect.arrayContaining([
					"proposal.targetRecordId conflicts with candidateMaterial.targetRecordId",
				]),
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { validProposals: 0, invalidProposals: 1, admitted: 0 },
		});
	});

	it("rejects duplicate target record ids within one proposal batch", () => {
		const snapshot = admitAgenticMemoryRecordProposals(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "first",
					targetRecordId: "record-target",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "candidate-a", fragment: fragment({ id: "candidate-a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-a" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "second",
					targetRecordId: "record-target",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "candidate-b", fragment: fragment({ id: "candidate-b" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-b" }],
				},
			],
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "policy-1",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
		);

		expect(snapshot.admitted).toEqual([
			expect.objectContaining({ proposalId: "first", targetRecordId: "record-target" }),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.proposal.duplicate-target-record-id",
				subjectId: "second",
				refs: ["record-target"],
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 1, admitted: 1 },
		});
	});

	it("snapshots refs and preserves colon-distinct policy refs", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const sourceRef = { kind: "review", id: "review-1", metadata: { rank: 1 } };
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-1",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-new", fragment: fragment({ id: "new" }) }),
					},
					sourceRefs: [sourceRef],
					policyRefs: [
						{ kind: "a:b", id: "c" },
						{ kind: "a", id: "b:c" },
					],
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		sourceRef.metadata.rank = 99;

		const admission = data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(
			-1,
		)?.[0];
		expect(admission?.sourceRefs).toEqual([
			{ kind: "review", id: "review-1", metadata: { rank: 1 } },
		]);
		expect(admission?.policyRefs).toEqual(
			expect.arrayContaining([
				{ kind: "a:b", id: "c" },
				{ kind: "a", id: "b:c" },
				{ kind: "agentic-memory-record-admission-policy", id: "admission-policy" },
			]),
		);
	});

	it("preserves candidateMaterial attribution through bundle and pure admission", () => {
		const attribution: AgenticMemoryContextAttribution = {
			kind: "agentic-memory-context-attribution",
			fragmentId: "new",
			recordId: "record-new",
			queryId: "query-1",
			rank: 3,
			score: 12.5,
			truncated: true,
			truncation: {
				originalChars: 100,
				packedChars: 40,
				omittedChars: 60,
				originalCost: 50,
				packedCost: 20,
				omittedCost: 30,
				reason: "budget",
				metadata: { mode: "fixture" },
			},
			sourceRefs: [{ kind: "context-entry", id: "context-1", metadata: { rank: 3 } }],
			policyRefs: [{ kind: "context-policy", id: "policy-1" }],
			metadata: { nested: { retained: true } },
		};
		const proposals: readonly AgenticMemoryRecordProposal<string>[] = [
			{
				kind: "agentic-memory-record-proposal",
				proposalId: "proposal-1",
				candidateMaterial: {
					kind: "agentic-memory-record-candidate-material",
					record: record({
						id: "record-new",
						scope: { projectId: "project-1" },
						fragment: fragment({ id: "new", payload: "new insight" }),
					}),
					attribution,
					sourceRefs: [{ kind: "candidate-source", id: "candidate-source-1" }],
					policyRefs: [{ kind: "candidate-policy", id: "candidate-policy-1" }],
					evidenceRefs: [{ kind: "candidate-evidence", id: "candidate-evidence-1" }],
					metadata: { candidate: { ok: true } },
				},
				sourceRefs: [{ kind: "proposal-source", id: "proposal-source-1" }],
			},
		];
		const policy: AgenticMemoryProposalAdmissionPolicy = {
			kind: "agentic-memory-record-admission-policy",
			policyId: "admission-policy",
			defaultState: "admitted",
		};
		const helperSnapshot = admitAgenticMemoryRecordProposals(proposals, policy);
		expect(helperSnapshot.admitted[0]?.candidateMaterial.attribution).toEqual(attribution);
		expect(helperSnapshot.admitted[0]?.candidateMaterial.record.scope).toEqual({
			projectId: "project-1",
		});
		expect(Object.isFrozen(helperSnapshot.admitted[0]?.candidateMaterial.attribution)).toBe(true);
		expect(
			Object.isFrozen(helperSnapshot.admitted[0]?.candidateMaterial.attribution?.metadata?.nested),
		).toBe(true);

		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposalNode = g.state(proposals, { name: "proposals" });
		const policyNode = g.state(policy, { name: "policy" });
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals: proposalNode,
			policy: policyNode,
		});
		const admitted = collect(bundle.admitted);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)?.[0]
				?.candidateMaterial,
		).toEqual(
			expect.objectContaining({
				attribution,
				sourceRefs: [{ kind: "candidate-source", id: "candidate-source-1" }],
				policyRefs: [{ kind: "candidate-policy", id: "candidate-policy-1" }],
				evidenceRefs: [{ kind: "candidate-evidence", id: "candidate-evidence-1" }],
				metadata: { candidate: { ok: true } },
			}),
		);
	});

	it("rejects duplicate candidate record ids within one proposal batch", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "first",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-dupe", fragment: fragment({ id: "dupe-a" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-a" }],
				},
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "second",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-dupe", fragment: fragment({ id: "dupe-b" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-b" }],
				},
			],
			{ name: "proposals" },
		);
		const policy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
				requireSourceRefs: true,
			},
			{ name: "policy" },
		);
		const bundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy,
		});
		const admitted = collect(bundle.admitted);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryRecordAdmission<string>[]>(admitted.messages).at(-1)).toEqual(
			[expect.objectContaining({ proposalId: "first", state: "admitted" })],
		);
		expect(
			data<readonly { readonly code: string }[]>(issues.messages)
				.at(-1)
				?.map((issue) => issue.code),
		).toEqual(["agentic-memory.proposal.duplicate-candidate-record-id"]);
		expect(data<AgenticMemoryRecordAdmissionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validProposals: 1, invalidProposals: 1, admitted: 1 },
		});
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory record application projector (D577)", () => {
	it("applies admitted create proposals and emits a full next records snapshot", () => {
		const current = [record({ id: "record-existing", fragment: fragment({ id: "existing" }) })];
		const admission = admitted({
			admissionId: "admission-create",
			proposalId: "proposal-create",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-created",
					fragment: fragment({ id: "created", payload: "created insight" }),
				}),
				metadata: { nested: { ok: true } },
			},
			idempotencyKey: "idem-create",
		});

		const snapshot = applyAgenticMemoryRecordAdmissions([admission], applicationPolicy(), {
			records: current,
			evaluation: 9,
		});

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing", "record-created"]);
		expect(snapshot.appliedRecords.map((item) => item.id)).toEqual(["record-created"]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining<Partial<AgenticMemoryRecordApplicationDecision<string>>>({
				applicationId:
					'agentic-memory-record-application:["application-policy","admission-create"]',
				admissionId: "admission-create",
				proposalId: "proposal-create",
				state: "applied",
				operation: "create",
				operationVersion: 1,
				reasonCode: "applied-create",
				record: expect.objectContaining({ id: "record-created" }),
				idempotencyKey: "idem-create",
			}),
		]);
		expect(snapshot.status).toMatchObject({
			state: "ready",
			cursor: { evaluation: 9, applied: 1, skipped: 0, rejected: 0, issues: 0 },
		});
		expect(snapshot.issues).toEqual([]);
		expect(snapshot.audit).toEqual([
			expect.objectContaining({
				operation: "create",
				operationVersion: 1,
				reasonCode: "applied-create",
			}),
		]);
		const createIdentity = snapshot.applicationDecisions[0]?.materialIdentity;
		expect(createIdentity).toMatchObject({
			algorithm: AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
		});
		expect(JSON.parse(createIdentity?.key ?? "{}")).toMatchObject({
			format: "graphrefly.agenticMemoryRecordApplicationMaterial",
			version: 1,
			operation: "create",
			operationVersion: 1,
			targetRecordId: "record-created",
			record: { record: { id: "record-created", fragment: { tNs: "10" } } },
		});
		expect(snapshot.audit[0]?.materialIdentity).toEqual(createIdentity);
		expect(Object.isFrozen(snapshot.records)).toBe(true);
		expect(Object.isFrozen(snapshot.appliedRecords)).toBe(true);
		expect(Object.isFrozen(snapshot.applicationDecisions)).toBe(true);
		expect(Object.isFrozen(snapshot.applicationDecisions[0]?.candidateMaterial)).toBe(true);
		expect(Object.isFrozen(snapshot.applicationDecisions[0]?.materialIdentity)).toBe(true);
		expect(Object.isFrozen(snapshot.operationStatuses)).toBe(true);
		expect(Object.isFrozen(snapshot.operationStatuses[0]?.cursor)).toBe(true);
		expect(Object.isFrozen(snapshot.audit[0])).toBe(true);
		expect(current.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("applies admitted full-record replace candidates in-place with explicit lineage", () => {
		const current = [
			record({
				id: "record-a",
				fragment: fragment({ id: "fragment-a", payload: "old", tags: ["old"] }),
			}),
			record({ id: "record-b", fragment: fragment({ id: "fragment-b" }) }),
		];
		const replacement = record({
			id: "record-a",
			artifactKind: "procedure",
			fragment: fragment({
				id: "fragment-a-v2",
				payload: "new",
				tags: ["new"],
				parentFragmentId: "fragment-a",
			}),
		});

		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-replace",
					proposalId: "proposal-replace",
					operation: "replace",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						operation: "replace",
						record: replacement,
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(
			snapshot.records.map((item) => [item.id, item.fragment.id, item.fragment.payload]),
		).toEqual([
			["record-a", "fragment-a-v2", "new"],
			["record-b", "fragment-b", "payload"],
		]);
		expect(snapshot.appliedRecords).toEqual([expect.objectContaining({ id: "record-a" })]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining<Partial<AgenticMemoryRecordApplicationDecision<string>>>({
				state: "applied",
				operation: "replace",
				operationVersion: 1,
				reasonCode: "applied-replace",
				targetRecordId: "record-a",
				record: expect.objectContaining({
					fragment: expect.objectContaining({ id: "fragment-a-v2" }),
				}),
			}),
		]);
		expect(snapshot.audit).toEqual([
			expect.objectContaining({
				operation: "replace",
				operationVersion: 1,
				reasonCode: "applied-replace",
				targetRecordId: "record-a",
			}),
		]);
		const replaceIdentity = snapshot.applicationDecisions[0]?.materialIdentity;
		expect(JSON.parse(replaceIdentity?.key ?? "{}")).toMatchObject({
			operation: "replace",
			targetRecordId: "record-a",
			record: { record: { id: "record-a", fragment: { id: "fragment-a-v2" } } },
		});
		expect(snapshot.audit[0]?.materialIdentity).toEqual(replaceIdentity);
		expect(snapshot.issues).toEqual([]);
		expect(current.map((item) => [item.id, item.fragment.id])).toEqual([
			["record-a", "fragment-a"],
			["record-b", "fragment-b"],
		]);
	});

	it("applies D580 admitted complete-next-record update candidates in-place", () => {
		const current = [
			record({
				id: "record-a",
				fragment: fragment({ id: "fragment-a", payload: "old", tags: ["old"] }),
			}),
			record({ id: "record-b", fragment: fragment({ id: "fragment-b" }) }),
		];
		const next = record({
			id: "record-a",
			kind: "procedural",
			artifactKind: "procedure",
			fragment: fragment({
				id: "fragment-a-v2",
				payload: "updated",
				tags: ["updated"],
				parentFragmentId: "fragment-a",
			}),
		});

		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-update",
					proposalId: "proposal-update",
					operation: "update",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						operation: "update",
						operationVersion: 1,
						record: next,
					},
				}),
			],
			applicationPolicy(),
			{ records: current, evaluation: 13 },
		);

		expect(
			snapshot.records.map((item) => [item.id, item.fragment.id, item.fragment.payload]),
		).toEqual([
			["record-a", "fragment-a-v2", "updated"],
			["record-b", "fragment-b", "payload"],
		]);
		expect(snapshot.appliedRecords).toEqual([expect.objectContaining({ id: "record-a" })]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining<Partial<AgenticMemoryRecordApplicationDecision<string>>>({
				state: "applied",
				operation: "update",
				operationVersion: 1,
				reasonCode: "applied-update",
				targetRecordId: "record-a",
				record: expect.objectContaining({
					fragment: expect.objectContaining({ id: "fragment-a-v2" }),
				}),
			}),
		]);
		const updateIdentity = snapshot.applicationDecisions[0]?.materialIdentity;
		expect(JSON.parse(updateIdentity?.key ?? "{}")).toMatchObject({
			operation: "update",
			operationVersion: 1,
			targetRecordId: "record-a",
			record: { record: { id: "record-a", fragment: { id: "fragment-a-v2" } } },
		});
		expect(snapshot.audit).toEqual([
			expect.objectContaining({
				operation: "update",
				operationVersion: 1,
				reasonCode: "applied-update",
				targetRecordId: "record-a",
				materialIdentity: updateIdentity,
			}),
		]);
		expect(snapshot.operationStatuses).toEqual([
			expect.objectContaining({
				operation: "update",
				state: "ready",
				cursor: expect.objectContaining({ evaluation: 13, applied: 1, decisions: 1 }),
			}),
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("rejects invalid replace targets as DATA issues without protocol ERROR", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "replace-missing-target-id",
					proposalId: "replace-missing-target-id",
					operation: "replace",
				}),
				admitted({
					admissionId: "replace-missing-target",
					proposalId: "replace-missing-target",
					operation: "replace",
					targetRecordId: "record-missing",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-missing",
							fragment: fragment({ id: "fragment-missing", parentFragmentId: "fragment-existing" }),
						}),
					},
				}),
				admitted({
					admissionId: "replace-id-mismatch",
					proposalId: "replace-id-mismatch",
					operation: "replace",
					targetRecordId: "record-existing",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["replace-missing-target-id", "rejected", "target-record-id-required"],
			["replace-missing-target", "rejected", "target-record-missing"],
			["replace-id-mismatch", "rejected", "candidate-record-id-mismatch"],
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.target-record-id-required",
			"agentic-memory.application.target-record-missing",
			"agentic-memory.application.candidate-record-id-mismatch",
		]);
		expect(snapshot.status).toMatchObject({ state: "partial", cursor: { rejected: 3, issues: 3 } });
	});

	it("rejects invalid D580 update targets as DATA issues without protocol ERROR", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "update-missing-target-id",
					proposalId: "update-missing-target-id",
					operation: "update",
				}),
				admitted({
					admissionId: "update-missing-target",
					proposalId: "update-missing-target",
					operation: "update",
					targetRecordId: "record-missing",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-missing",
							fragment: fragment({ id: "fragment-missing", parentFragmentId: "fragment-existing" }),
						}),
					},
				}),
				admitted({
					admissionId: "update-id-mismatch",
					proposalId: "update-id-mismatch",
					operation: "update",
					targetRecordId: "record-existing",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.operation,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["update-missing-target-id", "update", "rejected", "target-record-id-required"],
			["update-missing-target", "update", "rejected", "target-record-missing"],
			["update-id-mismatch", "update", "rejected", "candidate-record-id-mismatch"],
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.target-record-id-required",
			"agentic-memory.application.target-record-missing",
			"agentic-memory.application.candidate-record-id-mismatch",
		]);
		expect(snapshot.issues.every((issue) => issue.details?.operation === "update")).toBe(true);
		expect(snapshot.status).toMatchObject({ state: "partial", cursor: { rejected: 3, issues: 3 } });
	});

	it("enforces D578 replacement fragment id equivalence, conflicts, and lineage", () => {
		const current = [
			record({ id: "record-a", fragment: fragment({ id: "fragment-a", payload: "same" }) }),
			record({ id: "record-b", fragment: fragment({ id: "fragment-b", payload: "other" }) }),
		];
		const sameFragmentEquivalent = admitted({
			admissionId: "same-fragment-equivalent",
			proposalId: "same-fragment-equivalent",
			operation: "replace",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-a",
					fragment: fragment({ id: "fragment-a", payload: "same" }),
				}),
				evidenceRefs: [{ kind: "memory-fragment", id: "fragment-a" }],
			},
		});
		const sameFragmentChanged = admitted({
			admissionId: "same-fragment-changed",
			proposalId: "same-fragment-changed",
			operation: "replace",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-a",
					fragment: fragment({ id: "fragment-a", payload: "changed" }),
				}),
				evidenceRefs: [{ kind: "memory-fragment", id: "fragment-a" }],
			},
		});
		const conflictingNewFragment = admitted({
			admissionId: "conflicting-fragment",
			proposalId: "conflicting-fragment",
			operation: "replace",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-a", fragment: fragment({ id: "fragment-b" }) }),
				evidenceRefs: [{ kind: "agentic-memory-record", id: "record-a" }],
			},
		});
		const missingLineage = admitted({
			admissionId: "missing-lineage",
			proposalId: "missing-lineage",
			operation: "replace",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
			},
		});
		const sourceRefLineage = admitted({
			admissionId: "source-ref-lineage",
			proposalId: "source-ref-lineage",
			operation: "replace",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
				sourceRefs: [{ kind: "agentic-memory-record", id: "record-a" }],
				evidenceRefs: [{ kind: "memory-fragment", id: "fragment-a" }],
			},
		});

		const equivalent = applyAgenticMemoryRecordAdmissions(
			[sameFragmentEquivalent],
			applicationPolicy(),
			{
				records: current,
			},
		);
		const rejected = applyAgenticMemoryRecordAdmissions(
			[sameFragmentChanged, conflictingNewFragment, missingLineage],
			applicationPolicy(),
			{ records: current },
		);
		const acceptedWithRefs = applyAgenticMemoryRecordAdmissions(
			[sourceRefLineage],
			applicationPolicy(),
			{
				records: current,
			},
		);

		expect(equivalent.applicationDecisions).toEqual([
			expect.objectContaining({ state: "applied", reasonCode: "applied-replace" }),
		]);
		expect(rejected.applicationDecisions.map((decision) => decision.reasonCode)).toEqual([
			"fragment-id-reused-with-different-material",
			"fragment-id-conflict",
			"replace-lineage-missing",
		]);
		expect(rejected.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.fragment-id-reused-with-different-material",
			"agentic-memory.application.fragment-id-conflict",
			"agentic-memory.application.replace-lineage-missing",
		]);
		expect(acceptedWithRefs.records.map((item) => [item.id, item.fragment.id])).toEqual([
			["record-a", "fragment-a-v2"],
			["record-b", "fragment-b"],
		]);
	});

	it("enforces D580 update lineage and prior-fragment material rules", () => {
		const current = [
			record({ id: "record-a", fragment: fragment({ id: "fragment-a", payload: "same" }) }),
			record({ id: "record-b", fragment: fragment({ id: "fragment-b", payload: "other" }) }),
		];
		const sameFragmentChanged = admitted({
			admissionId: "update-same-fragment-changed",
			proposalId: "update-same-fragment-changed",
			operation: "update",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-a",
					fragment: fragment({ id: "fragment-a", payload: "changed" }),
				}),
				evidenceRefs: [{ kind: "memory-fragment", id: "fragment-a" }],
			},
		});
		const missingLineage = admitted({
			admissionId: "update-missing-lineage",
			proposalId: "update-missing-lineage",
			operation: "update",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
			},
		});
		const sourceRefLineage = admitted({
			admissionId: "update-source-ref-lineage",
			proposalId: "update-source-ref-lineage",
			operation: "update",
			targetRecordId: "record-a",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
				sourceRefs: [{ kind: "agentic-memory-record", id: "record-a" }],
			},
		});

		const rejected = applyAgenticMemoryRecordAdmissions(
			[sameFragmentChanged, missingLineage],
			applicationPolicy(),
			{ records: current },
		);
		const accepted = applyAgenticMemoryRecordAdmissions([sourceRefLineage], applicationPolicy(), {
			records: current,
		});

		expect(rejected.applicationDecisions.map((decision) => decision.reasonCode)).toEqual([
			"fragment-id-reused-with-different-material",
			"update-lineage-missing",
		]);
		expect(rejected.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.fragment-id-reused-with-different-material",
			"agentic-memory.application.update-lineage-missing",
		]);
		expect(accepted.records.map((item) => [item.id, item.fragment.id])).toEqual([
			["record-a", "fragment-a-v2"],
			["record-b", "fragment-b"],
		]);
	});

	it("keeps create and replace idempotency evidence operation-versioned", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const replaceAdmission = admitted({
			admissionId: "replace-replay",
			proposalId: "replace-replay",
			operation: "replace",
			targetRecordId: "record-existing",
			idempotencyKey: "idem-replace",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-existing",
					fragment: fragment({ id: "fragment-existing-v2", parentFragmentId: "fragment-existing" }),
				}),
			},
		});
		const replaceRecord = replaceAdmission.candidateMaterial.record;
		const matchingReplacePriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "replace-replay",
				proposalId: "replace-replay",
				operation: "replace",
				operationVersion: 1,
				idempotencyKey: "idem-replace",
				recordId: "record-existing",
				fragmentId: "fragment-existing-v2",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity("replace", replaceRecord, "record-existing"),
			},
		];
		const conflictingReplacePriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "replace-conflict",
				proposalId: "replace-conflict",
				operation: "replace",
				operationVersion: 1,
				idempotencyKey: "idem-conflict",
				recordId: "record-existing",
				fragmentId: "fragment-other",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity(
					"replace",
					record({ id: "record-existing", fragment: fragment({ id: "fragment-other" }) }),
					"record-existing",
				),
			},
		];
		const createPriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "replace-create-priorEvidence",
				proposalId: "replace-create-priorEvidence",
				operation: "create",
				operationVersion: 1,
				idempotencyKey: "idem-cross-operation",
				recordId: "record-existing",
				fragmentId: "fragment-existing-v2",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity("create", replaceRecord, "record-existing"),
			},
		];

		const matching = applyAgenticMemoryRecordAdmissions([replaceAdmission], applicationPolicy(), {
			records: current,
			priorEvidence: matchingReplacePriorEvidence,
		});
		const conflict = applyAgenticMemoryRecordAdmissions(
			[
				{
					...replaceAdmission,
					admissionId: "replace-conflict",
					proposalId: "replace-conflict",
					idempotencyKey: "idem-conflict",
				},
			],
			applicationPolicy(),
			{ records: current, priorEvidence: conflictingReplacePriorEvidence },
		);
		const crossOperation = applyAgenticMemoryRecordAdmissions(
			[
				{
					...replaceAdmission,
					admissionId: "replace-create-priorEvidence",
					proposalId: "replace-create-priorEvidence",
					idempotencyKey: "idem-cross-operation",
				},
			],
			applicationPolicy(),
			{ records: current, priorEvidence: createPriorEvidence },
		);

		expect(matching.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(conflict.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "idempotency-conflict" }),
		]);
		expect(crossOperation.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "idempotency-conflict" }),
		]);
		expect(crossOperation.applicationDecisions[0]).toMatchObject({
			operation: "replace",
			operationVersion: 1,
		});
	});

	it("skips matching replace replay when current truth already equals candidate", () => {
		const current = [
			record({
				id: "record-advanced",
				fragment: fragment({ id: "fragment-advanced-v2", payload: "new truth" }),
			}),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "replace-replay-advanced",
					proposalId: "replace-replay-advanced",
					operation: "replace",
					operationVersion: 1,
					targetRecordId: "record-advanced",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: current[0] as AgenticMemoryRecord<string>,
						sourceRefs: [{ kind: "agentic-memory-fragment", id: "fragment-advanced-v1" }],
					},
				}),
			],
			applicationPolicy(),
			{
				records: current,
				priorEvidence: [
					{
						kind: "agentic-memory-record-application-evidence",
						admissionId: "replace-replay-advanced",
						proposalId: "replace-replay-advanced",
						operation: "replace",
						operationVersion: 1,
						recordId: "record-advanced",
						fragmentId: "fragment-advanced-v2",
						targetRecordId: "record-advanced",
						materialIdentity: applicationMaterialIdentity(
							"replace",
							current[0] as AgenticMemoryRecord<string>,
							"record-advanced",
						),
					},
				],
			},
		);

		expect(snapshot.records).toEqual(current);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("keeps D580 update idempotency evidence operation-versioned", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const updateAdmission = admitted({
			admissionId: "update-replay",
			proposalId: "update-replay",
			operation: "update",
			targetRecordId: "record-existing",
			idempotencyKey: "idem-update",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-existing",
					fragment: fragment({ id: "fragment-existing-v2", parentFragmentId: "fragment-existing" }),
				}),
			},
		});
		const updateRecord = updateAdmission.candidateMaterial.record;
		const matchingUpdatePriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "update-replay",
				proposalId: "update-replay",
				operation: "update",
				operationVersion: 1,
				idempotencyKey: "idem-update",
				recordId: "record-existing",
				fragmentId: "fragment-existing-v2",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity("update", updateRecord, "record-existing"),
			},
		];
		const conflictingUpdatePriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "update-conflict",
				proposalId: "update-conflict",
				operation: "update",
				operationVersion: 1,
				idempotencyKey: "idem-update-conflict",
				recordId: "record-existing",
				fragmentId: "fragment-existing-v2",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity(
					"update",
					record({
						id: "record-existing",
						fragment: fragment({ id: "fragment-existing-v2", payload: "different" }),
					}),
					"record-existing",
				),
			},
		];
		const replacePriorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "update-replace-priorEvidence",
				proposalId: "update-replace-priorEvidence",
				operation: "replace",
				operationVersion: 1,
				idempotencyKey: "idem-cross-operation-update",
				recordId: "record-existing",
				fragmentId: "fragment-existing-v2",
				targetRecordId: "record-existing",
				materialIdentity: applicationMaterialIdentity("replace", updateRecord, "record-existing"),
			},
		];

		const matching = applyAgenticMemoryRecordAdmissions([updateAdmission], applicationPolicy(), {
			records: current,
			priorEvidence: matchingUpdatePriorEvidence,
		});
		const conflict = applyAgenticMemoryRecordAdmissions(
			[
				{
					...updateAdmission,
					admissionId: "update-conflict",
					proposalId: "update-conflict",
					idempotencyKey: "idem-update-conflict",
				},
			],
			applicationPolicy(),
			{ records: current, priorEvidence: conflictingUpdatePriorEvidence },
		);
		const crossOperation = applyAgenticMemoryRecordAdmissions(
			[
				{
					...updateAdmission,
					admissionId: "update-replace-priorEvidence",
					proposalId: "update-replace-priorEvidence",
					idempotencyKey: "idem-cross-operation-update",
				},
			],
			applicationPolicy(),
			{ records: current, priorEvidence: replacePriorEvidence },
		);

		expect(matching.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(conflict.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "idempotency-conflict" }),
		]);
		expect(crossOperation.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "idempotency-conflict" }),
		]);
		expect(crossOperation.applicationDecisions[0]).toMatchObject({
			operation: "update",
			operationVersion: 1,
		});
	});

	it("skips D580 update replay when current truth already equals candidate", () => {
		const current = [
			record({
				id: "record-updated",
				fragment: fragment({ id: "fragment-updated-v2", payload: "updated truth" }),
			}),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "update-replay-advanced",
					proposalId: "update-replay-advanced",
					operation: "update",
					operationVersion: 1,
					targetRecordId: "record-updated",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: current[0] as AgenticMemoryRecord<string>,
						sourceRefs: [{ kind: "agentic-memory-fragment", id: "fragment-updated-v1" }],
					},
				}),
			],
			applicationPolicy(),
			{
				records: current,
				priorEvidence: [
					{
						kind: "agentic-memory-record-application-evidence",
						admissionId: "update-replay-advanced",
						proposalId: "update-replay-advanced",
						operation: "update",
						operationVersion: 1,
						recordId: "record-updated",
						fragmentId: "fragment-updated-v2",
						targetRecordId: "record-updated",
						materialIdentity: applicationMaterialIdentity(
							"update",
							current[0] as AgenticMemoryRecord<string>,
							"record-updated",
						),
					},
				],
			},
		);

		expect(snapshot.records).toEqual(current);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("skips same-evaluation duplicate D580 update application evidence", () => {
		const current = [record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) })];
		const updateAdmission = admitted({
			admissionId: "update-current",
			proposalId: "update-current",
			operation: "update",
			targetRecordId: "record-a",
			idempotencyKey: "idem-update-current",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-a",
					fragment: fragment({ id: "fragment-a-v2", parentFragmentId: "fragment-a" }),
				}),
			},
		});
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				updateAdmission,
				{
					...updateAdmission,
					proposalId: "update-current-repeat",
				},
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => [item.id, item.fragment.id])).toEqual([
			["record-a", "fragment-a-v2"],
		]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["update-current", "applied", "applied-update"],
			["update-current-repeat", "skipped", "already-applied"],
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("rejects unsupported operations as application DATA issues", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				{
					...admitted({ admissionId: "admission-delete", proposalId: "proposal-delete" }),
					operation: "delete",
				} as never,
				{
					...admitted({ admissionId: "admission-v2", proposalId: "proposal-v2" }),
					operationVersion: 2,
				} as never,
			],
			applicationPolicy(),
		);

		expect(snapshot.applicationDecisions.map((decision) => decision.reasonCode)).toEqual([
			"unsupported-operation",
			"unsupported-operation",
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.unsupported-operation",
			"agentic-memory.application.unsupported-operation",
		]);
		expect(snapshot.status).toMatchObject({ state: "partial", cursor: { rejected: 2, issues: 2 } });
	});

	it("validates replace invariants before matching idempotency replay", () => {
		const current = [record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) })];
		const priorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "replace-replay-invalid",
				proposalId: "replace-replay-invalid",
				operation: "replace",
				operationVersion: 1,
				recordId: "record-a",
				fragmentId: "fragment-a-v2",
				targetRecordId: "record-a",
				materialIdentity: applicationMaterialIdentity(
					"replace",
					record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
					"record-a",
				),
			},
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "replace-replay-invalid",
					proposalId: "replace-replay-invalid",
					operation: "replace",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current, priorEvidence },
		);

		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "replace-lineage-missing" }),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({ code: "agentic-memory.application.replace-lineage-missing" }),
		]);
	});

	it("validates update invariants before matching idempotency replay", () => {
		const current = [record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) })];
		const priorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "update-replay-invalid",
				proposalId: "update-replay-invalid",
				operation: "update",
				operationVersion: 1,
				recordId: "record-a",
				fragmentId: "fragment-a-v2",
				targetRecordId: "record-a",
				materialIdentity: applicationMaterialIdentity(
					"update",
					record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
					"record-a",
				),
			},
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "update-replay-invalid",
					proposalId: "update-replay-invalid",
					operation: "update",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-a", fragment: fragment({ id: "fragment-a-v2" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current, priorEvidence },
		);

		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({ state: "rejected", reasonCode: "update-lineage-missing" }),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({ code: "agentic-memory.application.update-lineage-missing" }),
		]);
	});

	it("keeps replaced-away fragment ids reserved for later same-evaluation creates", () => {
		const current = [record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) })];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "replace-a",
					proposalId: "replace-a",
					operation: "replace",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-a",
							fragment: fragment({ id: "fragment-a-v2", parentFragmentId: "fragment-a" }),
						}),
					},
				}),
				admitted({
					admissionId: "create-with-old-fragment",
					proposalId: "create-with-old-fragment",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-b", fragment: fragment({ id: "fragment-a" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => [item.id, item.fragment.id])).toEqual([
			["record-a", "fragment-a-v2"],
		]);
		expect(snapshot.applicationDecisions.map((decision) => decision.reasonCode)).toEqual([
			"applied-replace",
			"fragment-id-conflict",
		]);
	});

	it("exposes graph-visible topology and projection subnodes", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[admitted({ admissionId: "admission-create" })],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const priorEvidence = g.state<readonly AgenticMemoryRecordApplicationEvidence[]>([], {
			name: "priorEvidence",
		});
		const bundle = agenticMemoryRecordApplicationBundle(g, {
			name: "application",
			records,
			admissions,
			policy,
			priorEvidence,
		});
		const nextRecords = collect(bundle.records);
		const appliedRecords = collect(bundle.appliedRecords);
		const status = collect(bundle.status);
		const operationStatuses = collect(bundle.operationStatuses);
		const decisions = collect(bundle.applicationDecisions);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "application/projection" },
				{ from: "admissions", to: "application/projection" },
				{ from: "policy", to: "application/projection" },
				{ from: "priorEvidence", to: "application/projection" },
				{ from: "application/projection", to: "application/records" },
				{ from: "application/projection", to: "application/appliedRecords" },
				{ from: "application/projection", to: "application/applicationDecisions" },
				{ from: "application/projection", to: "application/status" },
				{ from: "application/projection", to: "application/operationStatuses" },
			]),
		);
		expect(data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-new" }),
		]);
		expect(data<readonly AgenticMemoryRecord<string>[]>(appliedRecords.messages).at(-1)).toEqual([
			expect.objectContaining({ id: "record-new" }),
		]);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "applied" })]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { applied: 1 },
		});
		expect(data(operationStatuses.messages).at(-1)).toEqual([
			expect.objectContaining({ operation: "create", state: "ready" }),
		]);
	});

	it("projects applied application decisions into appendable evidence with coordinates preserved", () => {
		const sourceRefs = [{ kind: "review", id: "review-application" }];
		const policyRefs = [{ kind: "application-policy", id: "application-policy" }];
		const evidenceRefs = [{ kind: "prior-fact", id: "prior-fact" }];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-evidence",
					proposalId: "proposal-evidence",
					idempotencyKey: "idem-evidence",
					targetRecordId: "record-new",
					sourceRefs,
					policyRefs,
					evidenceRefs,
				}),
			],
			applicationPolicy({ sourceRefs, policyRefs }),
		);

		const projection = projectAgenticMemoryRecordApplicationEvidenceFacts(
			snapshot.applicationDecisions,
		);

		expect(projection.evidenceFacts).toEqual([
			expect.objectContaining<Partial<AgenticMemoryRecordApplicationEvidence>>({
				kind: "agentic-memory-record-application-evidence",
				applicationId: snapshot.applicationDecisions[0]?.applicationId,
				admissionId: "admission-evidence",
				proposalId: "proposal-evidence",
				operation: "create",
				operationVersion: 1,
				idempotencyKey: "idem-evidence",
				recordId: "record-new",
				fragmentId: "fragment-new",
				targetRecordId: "record-new",
				materialIdentity: snapshot.applicationDecisions[0]?.materialIdentity,
				sourceRefs: expect.arrayContaining(sourceRefs),
				policyRefs: expect.arrayContaining(policyRefs),
				evidenceRefs,
			}),
		]);
		expect(projection.priorEvidence).toMatchObject({
			kind: "agentic-memory-record-application-prior-evidence",
			entries: projection.evidenceFacts,
		});
		expect(projection.status).toMatchObject({
			state: "ready",
			cursor: {
				applicationDecisions: 1,
				appliedDecisions: 1,
				evidenceFacts: 1,
				validEvidenceFacts: 1,
			},
		});
	});

	it("keeps skipped and rejected application decisions out of evidence truth", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "decision-skipped",
					proposalId: "decision-skipped",
					state: "rejected",
				}),
				admitted({
					admissionId: "decision-rejected",
					proposalId: "decision-rejected",
					targetRecordId: "different-target",
				}),
			],
			applicationPolicy(),
		);

		const projection = projectAgenticMemoryRecordApplicationEvidenceFacts(
			snapshot.applicationDecisions,
		);

		expect(snapshot.applicationDecisions.map((decision) => decision.state)).toEqual([
			"skipped",
			"rejected",
		]);
		expect(projection.evidenceFacts).toEqual([]);
		expect(projection.audit.map((entry) => entry.action)).toEqual([
			"decision-skipped",
			"decision-skipped",
		]);
		expect(projection.status).toMatchObject({
			state: "blocked",
			cursor: { skippedDecisions: 1, rejectedDecisions: 1, validEvidenceFacts: 0 },
		});
	});

	it("rejects malformed skipped or rejected decisions before audit projection", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "malformed-skipped",
					proposalId: "malformed-skipped",
					state: "rejected",
				}),
				admitted({
					admissionId: "malformed-rejected",
					proposalId: "malformed-rejected",
					targetRecordId: "different-target",
				}),
			],
			applicationPolicy(),
		);
		const [skipped, rejected] = snapshot.applicationDecisions;
		const projection = projectAgenticMemoryRecordApplicationEvidenceFacts([
			{ ...skipped, candidateMaterial: undefined },
			{ ...rejected, operationVersion: 2 },
		] as unknown as readonly AgenticMemoryRecordApplicationDecision[]);

		expect(projection.evidenceFacts).toEqual([]);
		expect(projection.audit.map((entry) => entry.action)).toEqual([
			"issue-recorded",
			"issue-recorded",
		]);
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-evidence-facts.invalid-decision",
				refs: expect.arrayContaining(["decision.candidateMaterial must be an object"]),
			}),
			expect.objectContaining({
				code: "agentic-memory.application-evidence-facts.invalid-decision",
				refs: expect.arrayContaining(["decision.operationVersion must be 1"]),
			}),
		]);
		expect(projection.status).toMatchObject({
			state: "error",
			cursor: {
				applicationDecisions: 2,
				skippedDecisions: 0,
				rejectedDecisions: 0,
				validEvidenceFacts: 0,
				invalidEvidenceFacts: 2,
			},
		});
	});

	it("rejects malformed applied decisions before projecting evidence facts", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "malformed-decision", proposalId: "malformed-decision" })],
			applicationPolicy(),
		);
		const applied = snapshot.applicationDecisions[0] as AgenticMemoryRecordApplicationDecision;
		const projection = projectAgenticMemoryRecordApplicationEvidenceFacts([
			{ ...applied, record: undefined },
			{
				...applied,
				admissionId: "malformed-decision-divergent-record",
				record: record({
					id: "record-new",
					fragment: fragment({ id: "fragment-new", payload: "divergent" }),
				}),
			},
		]);

		expect(projection.evidenceFacts).toEqual([]);
		expect(projection.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-evidence-facts.invalid-decision",
				refs: expect.arrayContaining(["decision.record must be present for applied decisions"]),
			}),
			expect.objectContaining({
				code: "agentic-memory.application-evidence-facts.invalid-decision",
				refs: expect.arrayContaining(["decision.record must match decision.materialIdentity"]),
			}),
		]);
		expect(projection.status).toMatchObject({
			state: "error",
			cursor: { appliedDecisions: 2, validEvidenceFacts: 0, invalidEvidenceFacts: 2 },
		});
	});

	it("projects prior evidence facts for application helper consumption and future idempotency", () => {
		const first = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "future-admission", proposalId: "future-proposal" })],
			applicationPolicy(),
		);
		const evidence = projectAgenticMemoryRecordApplicationEvidenceFacts(first.applicationDecisions);
		const prior = projectAgenticMemoryRecordApplicationPriorEvidence(evidence.evidenceFacts);
		const second = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "future-admission", proposalId: "future-proposal" })],
			applicationPolicy(),
			{ priorEvidence: prior.priorEvidence },
		);

		expect(prior.priorEvidence.entries).toHaveLength(1);
		expect(second.records).toEqual([]);
		expect(second.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(second.issues).toEqual([]);
	});

	it("snapshots prior evidence and wrapper metadata as strict DATA", () => {
		const evidenceMetadata = { nested: { value: "before" } };
		const wrapperMetadata = { wrapper: { value: "before" } };
		const projection = projectAgenticMemoryRecordApplicationPriorEvidence(
			[
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "metadata-evidence",
					proposalId: "metadata-evidence",
					operation: "create",
					operationVersion: 1,
					recordId: "record-metadata",
					fragmentId: "fragment-metadata",
					targetRecordId: "record-metadata",
					materialIdentity: applicationMaterialIdentity(
						"create",
						record({ id: "record-metadata", fragment: fragment({ id: "fragment-metadata" }) }),
					),
					metadata: evidenceMetadata,
				},
			],
			{ metadata: wrapperMetadata },
		);

		evidenceMetadata.nested.value = "after";
		wrapperMetadata.wrapper.value = "after";
		expect(projection.priorEvidence.entries[0]?.metadata).toEqual({
			nested: { value: "before" },
		});
		expect(projection.priorEvidence.metadata).toEqual({
			wrapper: { value: "before" },
		});
		expect(Object.isFrozen(projection.priorEvidence.entries[0]?.metadata)).toBe(true);
		expect(Object.isFrozen(projection.priorEvidence.entries[0]?.metadata?.nested)).toBe(true);
		expect(Object.isFrozen(projection.priorEvidence.metadata)).toBe(true);
		expect(Object.isFrozen(projection.priorEvidence.metadata?.wrapper)).toBe(true);
	});

	it("preserves prior evidence wrapper provenance unless options override it", () => {
		const sourceRefs = [{ kind: "history-source", id: "history-source" }];
		const policyRefs = [{ kind: "history-policy", id: "history-policy" }];
		const wrapperMetadata = { wrapper: { value: "from-wrapper" } };
		const evidenceFact: AgenticMemoryRecordApplicationEvidence = {
			kind: "agentic-memory-record-application-evidence",
			admissionId: "wrapper-evidence",
			proposalId: "wrapper-evidence",
			operation: "create",
			operationVersion: 1,
			recordId: "record-wrapper",
			fragmentId: "fragment-wrapper",
			targetRecordId: "record-wrapper",
			materialIdentity: applicationMaterialIdentity(
				"create",
				record({ id: "record-wrapper", fragment: fragment({ id: "fragment-wrapper" }) }),
			),
		};
		const projection = projectAgenticMemoryRecordApplicationPriorEvidence({
			kind: "agentic-memory-record-application-prior-evidence",
			entries: [evidenceFact],
			sourceRefs,
			policyRefs,
			metadata: wrapperMetadata,
		});
		const overridden = projectAgenticMemoryRecordApplicationPriorEvidence(
			{
				kind: "agentic-memory-record-application-prior-evidence",
				entries: [evidenceFact],
				sourceRefs,
				policyRefs,
				metadata: wrapperMetadata,
			},
			{
				sourceRefs: [{ kind: "override-source", id: "override-source" }],
				metadata: { wrapper: { value: "from-options" } },
			},
		);

		wrapperMetadata.wrapper.value = "mutated";
		expect(projection.priorEvidence).toMatchObject({
			sourceRefs,
			policyRefs,
			metadata: { wrapper: { value: "from-wrapper" } },
		});
		expect(Object.isFrozen(projection.priorEvidence.metadata?.wrapper)).toBe(true);
		expect(overridden.priorEvidence).toMatchObject({
			sourceRefs: [{ kind: "override-source", id: "override-source" }],
			policyRefs,
			metadata: { wrapper: { value: "from-options" } },
		});
	});

	it("reports malformed prior evidence projection as DATA issues without protocol ERROR", () => {
		const g = graph();
		const evidenceFacts = g.state<readonly AgenticMemoryRecordApplicationEvidence[]>(
			[
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "bad-evidence",
					operation: "create",
					operationVersion: 1,
					recordId: "record-bad",
					fragmentId: "fragment-bad",
					targetRecordId: "record-bad",
					materialIdentity: { algorithm: "unsupported", key: "not-json" } as never,
				},
			],
			{ name: "history/evidenceFacts" },
		);
		const bundle = agenticMemoryRecordApplicationPriorEvidenceBundle(g, {
			name: "history/prior",
			evidenceFacts,
		});
		const projection = collect(bundle.projection);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(
			data<AgenticMemoryRecordApplicationPriorEvidenceProjection>(projection.messages).at(-1),
		).toMatchObject({
			kind: "agentic-memory-record-application-prior-evidence-projection",
			priorEvidence: { entries: [] },
		});
		expect(data(status.messages).at(-1)).toMatchObject({ state: "error" });
		expect(data(issues.messages).at(-1)).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-prior-evidence.invalid-entry",
			}),
		]);
		expect(projection.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps current application decisions out of same-evaluation prior evidence wiring", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[admitted({ admissionId: "same-evaluation", proposalId: "same-evaluation" })],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "application",
			records,
			admissions,
			policy,
		});
		const evidence = agenticMemoryRecordApplicationEvidenceFactsBundle(g, {
			name: "history/evidenceFacts",
			applicationDecisions: application.applicationDecisions,
		});
		const evidenceFacts = collect(evidence.evidenceFacts);
		const decisions = collect(application.applicationDecisions);

		const edges = g.describe().edges;
		expect(edges).toEqual(
			expect.arrayContaining([
				{ from: "application/projection", to: "application/applicationDecisions" },
				{
					from: "application/applicationDecisions",
					to: "history/evidenceFacts/projection",
				},
				{ from: "history/evidenceFacts/projection", to: "history/evidenceFacts/evidenceFacts" },
				{ from: "history/evidenceFacts/projection", to: "history/evidenceFacts/priorEvidence" },
			]),
		);
		expect(edges).not.toEqual(
			expect.arrayContaining([
				{ from: "history/evidenceFacts/priorEvidence", to: "application/projection" },
				{ from: "history/evidenceFacts/evidenceFacts", to: "application/projection" },
			]),
		);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "applied" })]);
		expect(
			data<readonly AgenticMemoryRecordApplicationEvidence[]>(evidenceFacts.messages).at(-1),
		).toEqual([expect.objectContaining({ admissionId: "same-evaluation" })]);
	});

	it("names current evidence facts as future-only and feeds restored evidence into a later evaluation", () => {
		const firstApplication = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "boundary-1", proposalId: "boundary-1" })],
			applicationPolicy(),
		);
		const currentEvaluationEvidenceFacts = projectAgenticMemoryRecordApplicationEvidenceFacts(
			firstApplication.applicationDecisions,
			{ metadata: { boundary: "current-evaluation-append-material" } },
		).evidenceFacts;
		const evidenceFrame = frameAgenticMemoryApplicationEvidence(currentEvaluationEvidenceFacts, {
			metadata: { boundary: "explicit-host-storage-event" },
		});
		const restoredPriorEvidence = decodeAgenticMemoryApplicationEvidenceStoreFrame(evidenceFrame);
		const nextEvaluationPriorEvidence = projectAgenticMemoryRecordApplicationPriorEvidence(
			restoredPriorEvidence,
			{ evaluation: 2 },
		).priorEvidence;
		const laterApplication = applyAgenticMemoryRecordAdmissions(
			[admitted({ admissionId: "boundary-1", proposalId: "boundary-1" })],
			applicationPolicy(),
			{ priorEvidence: nextEvaluationPriorEvidence },
		);

		expect(currentEvaluationEvidenceFacts).toEqual([
			expect.objectContaining({
				kind: "agentic-memory-record-application-evidence",
				admissionId: "boundary-1",
			}),
		]);
		expect(restoredPriorEvidence.entries).toEqual(currentEvaluationEvidenceFacts);
		expect(nextEvaluationPriorEvidence.entries).toEqual(currentEvaluationEvidenceFacts);
		expect(firstApplication.applicationDecisions).toEqual([
			expect.objectContaining({ state: "applied", reasonCode: "applied-create" }),
		]);
		expect(laterApplication.applicationDecisions).toEqual([
			expect.objectContaining({ state: "skipped", reasonCode: "already-applied" }),
		]);
		expect(firstApplication.cursor.priorEvidenceEntries).toBe(0);
	});

	it("exposes explicit prior-evidence projection edges for later application inputs", () => {
		const g = graph();
		const evidenceFacts = g.state<readonly AgenticMemoryRecordApplicationEvidence[]>(
			[
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "prior-edge",
					proposalId: "prior-edge",
					operation: "create",
					operationVersion: 1,
					recordId: "record-new",
					fragmentId: "fragment-new",
					targetRecordId: "record-new",
					materialIdentity: applicationMaterialIdentity(
						"create",
						record({ id: "record-new", fragment: fragment({ id: "fragment-new" }) }),
					),
				},
			],
			{ name: "persisted/evidenceFacts" },
		);
		const prior = agenticMemoryRecordApplicationPriorEvidenceBundle(g, {
			name: "history/prior",
			evidenceFacts,
		});
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[admitted({ admissionId: "prior-edge", proposalId: "prior-edge" })],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "later/application",
			records,
			admissions,
			policy,
			priorEvidence: prior.priorEvidence,
		});
		const decisions = collect(application.applicationDecisions);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "persisted/evidenceFacts", to: "history/prior/projection" },
				{ from: "history/prior/projection", to: "history/prior/priorEvidence" },
				{ from: "history/prior/priorEvidence", to: "later/application/projection" },
			]),
		);
		expect(application.input.priorEvidence).toBe(prior.priorEvidence);
		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages).at(-1),
		).toEqual([expect.objectContaining({ state: "skipped", reasonCode: "already-applied" })]);
	});

	it("keeps admission as proposal-only until the application projector consumes it", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-existing", fragment: fragment({ id: "existing" }) })],
			{ name: "records" },
		);
		const proposals = g.state<readonly AgenticMemoryRecordProposal<string>[]>(
			[
				{
					kind: "agentic-memory-record-proposal",
					proposalId: "proposal-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-created", fragment: fragment({ id: "created" }) }),
					},
					sourceRefs: [{ kind: "import", id: "import-1" }],
				},
			],
			{ name: "proposals" },
		);
		const admissionPolicy = g.state<AgenticMemoryRecordAdmissionPolicy>(
			{
				kind: "agentic-memory-record-admission-policy",
				policyId: "admission-policy",
				defaultState: "admitted",
			},
			{ name: "admission-policy" },
		);
		const admissionBundle = agenticMemoryRecordAdmissionBundle(g, {
			name: "admission",
			records,
			proposals,
			policy: admissionPolicy,
		});
		const admittedFacts = collect(admissionBundle.admitted);

		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
		expect(Object.hasOwn(admissionBundle, "records")).toBe(false);

		const applicationPolicyNode = g.state<AgenticMemoryRecordApplicationPolicy>(
			applicationPolicy(),
			{ name: "application-policy" },
		);
		const application = agenticMemoryRecordApplicationBundle(g, {
			name: "application",
			records,
			admissions: admissionBundle.admitted,
			policy: applicationPolicyNode,
		});
		const nextRecords = collect(application.records);

		expect(
			data<readonly AgenticMemoryRecordAdmission<string>[]>(admittedFacts.messages)
				.at(-1)
				?.map((item) => item.proposalId),
		).toEqual(["proposal-create"]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(nextRecords.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["record-existing", "record-created"]);
		expect(records.cache?.map((item) => item.id)).toEqual(["record-existing"]);
	});

	it("skips rejected and needs-review admissions without protocol ERROR", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const admissions = g.state<readonly AgenticMemoryRecordAdmission<string>[]>(
			[
				admitted({
					admissionId: "admission-rejected",
					proposalId: "proposal-rejected",
					state: "rejected",
				}),
				admitted({
					admissionId: "admission-review",
					proposalId: "proposal-review",
					state: "needs-review",
				}),
			],
			{ name: "admissions" },
		);
		const policy = g.state<AgenticMemoryRecordApplicationPolicy>(applicationPolicy(), {
			name: "policy",
		});
		const bundle = agenticMemoryRecordApplicationBundle(g, { records, admissions, policy });
		const decisions = collect(bundle.applicationDecisions);
		const issues = collect(bundle.issues);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryRecordApplicationDecision<string>[]>(decisions.messages)
				.at(-1)
				?.map((decision) => [decision.proposalId, decision.state, decision.reasonCode]),
		).toEqual([
			["proposal-rejected", "skipped", "skipped-non-admitted"],
			["proposal-review", "skipped", "skipped-non-admitted"],
		]);
		expect(data(issues.messages).at(-1)).toEqual([]);
		expect(data<AgenticMemoryRecordApplicationStatus>(status.messages).at(-1)).toMatchObject({
			state: "blocked",
			cursor: { applied: 0, skipped: 2, rejected: 0, issues: 0 },
		});
		expect(decisions.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(issues.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("reports invalid policy, priorEvidence, admission, and candidate material as DATA issues", () => {
		const hostilePriorEvidence = {
			kind: "agentic-memory-record-application-prior-evidence",
			entries: [
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "admission-1",
					recordId: "record-new",
					fragmentId: "fragment-new",
					storageKey: "nope",
				},
			],
			providerHandle: "nope",
		};
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				{
					kind: "agentic-memory-record-admission",
					admissionId: "bad-admission",
					proposalId: "proposal-1",
					state: "admitted",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "bad-record", fragment: fragment({ id: "bad-record" }) }),
						attribution: { graph: "nope" },
					},
				},
			],
			{
				kind: "agentic-memory-record-application-policy",
				policyId: "bad-policy",
				requireAdmittedState: false,
				rejectDuplicateRecordIds: false,
				rejectDuplicateFragmentIds: false,
				storageKey: "nope",
			},
			{ priorEvidence: hostilePriorEvidence as never },
		);

		expect(snapshot.records).toEqual([]);
		expect(snapshot.appliedRecords).toEqual([]);
		expect(snapshot.applicationDecisions).toEqual([]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application-policy.invalid",
			"agentic-memory.application-prior-evidence.invalid",
			"agentic-memory.application.invalid-admission",
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { applied: 0, validAdmissions: 0, invalidAdmissions: 1 },
		});
	});

	it("rejects malformed replace application prior evidence as DATA issues", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions([], applicationPolicy(), {
			priorEvidence: [
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "replace-priorEvidence-missing-target",
					operation: "replace",
					operationVersion: 1,
					recordId: "record-a",
					fragmentId: "fragment-a",
					materialIdentity: applicationMaterialIdentity(
						"replace",
						record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) }),
						"record-a",
					),
				},
				{
					kind: "agentic-memory-record-application-evidence",
					admissionId: "replace-priorEvidence-target-mismatch",
					operation: "replace",
					operationVersion: 1,
					recordId: "record-a",
					fragmentId: "fragment-a",
					targetRecordId: "record-b",
					materialIdentity: applicationMaterialIdentity(
						"replace",
						record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) }),
						"record-b",
					),
				},
			],
		});

		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application-prior-evidence.invalid-entry",
			"agentic-memory.application-prior-evidence.invalid-entry",
		]);
		expect(snapshot.issues.map((issue) => issue.refs)).toEqual([
			["replace evidence.targetRecordId must be present"],
			["evidence.targetRecordId must equal recordId when present"],
		]);
	});

	it("rejects missing, unsupported, or empty priorEvidence material identity as DATA issues", () => {
		const baseEvidence = {
			kind: "agentic-memory-record-application-evidence",
			admissionId: "priorEvidence-material",
			proposalId: "priorEvidence-material",
			operation: "create",
			operationVersion: 1,
			recordId: "record-priorEvidence-material",
			fragmentId: "fragment-priorEvidence-material",
			targetRecordId: "record-priorEvidence-material",
		} as const;
		const snapshot = applyAgenticMemoryRecordAdmissions([], applicationPolicy(), {
			priorEvidence: [
				baseEvidence,
				{
					...baseEvidence,
					admissionId: "priorEvidence-material-algorithm",
					materialIdentity: { algorithm: "unsupported", key: "non-empty" },
				},
				{
					...baseEvidence,
					admissionId: "priorEvidence-material-empty",
					materialIdentity: {
						algorithm: AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
						key: "",
					},
				},
				{
					...baseEvidence,
					admissionId: "priorEvidence-material-extra",
					materialIdentity: {
						...applicationMaterialIdentity(
							"create",
							record({
								id: "record-priorEvidence-material",
								fragment: fragment({ id: "fragment-priorEvidence-material" }),
							}),
						),
						patch: "nope",
					},
				},
				{
					...baseEvidence,
					admissionId: "priorEvidence-material-mismatch",
					materialIdentity: applicationMaterialIdentity(
						"create",
						record({
							id: "record-other",
							fragment: fragment({ id: "fragment-priorEvidence-material" }),
						}),
					),
				},
			],
		});

		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application-prior-evidence.invalid-entry",
			"agentic-memory.application-prior-evidence.invalid-entry",
			"agentic-memory.application-prior-evidence.invalid-entry",
			"agentic-memory.application-prior-evidence.invalid-entry",
			"agentic-memory.application-prior-evidence.invalid-entry",
		]);
		expect(snapshot.issues.flatMap((issue) => issue.refs ?? [])).toEqual(
			expect.arrayContaining([
				"evidence.materialIdentity must be an object",
				`evidence.materialIdentity.algorithm must be ${AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM}`,
				"evidence.materialIdentity.key must be a non-empty string",
				"evidence.materialIdentity has unexpected fields: patch",
				"evidence.materialIdentity.patch is not graph-visible DATA",
				"evidence.materialIdentity.key frame record.id must match evidence.recordId",
			]),
		);
	});

	it("does not let stale application history wrappers drive prior evidence replay", () => {
		const admission = admitted({ admissionId: "stale-wrapper", proposalId: "stale-wrapper" });
		const candidate = admission.candidateMaterial.record;
		const snapshot = applyAgenticMemoryRecordAdmissions([admission], applicationPolicy(), {
			priorEvidence: {
				kind: "agentic-memory-record-application-history",
				entries: [
					{
						kind: "agentic-memory-record-application-evidence",
						admissionId: "stale-wrapper",
						proposalId: "stale-wrapper",
						operation: "create",
						operationVersion: 1,
						recordId: candidate.id,
						fragmentId: candidate.fragment.id,
						targetRecordId: candidate.id,
						materialIdentity: applicationMaterialIdentity("create", candidate),
					},
				],
			} as never,
		});

		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({ state: "applied", reasonCode: "applied-create" }),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-prior-evidence.invalid",
				refs: ["priorEvidence.kind must be agentic-memory-record-application-prior-evidence"],
			}),
		]);
		expect(snapshot.cursor).toMatchObject({
			applied: 1,
			priorEvidenceEntries: 1,
			invalidPriorEvidenceEntries: 1,
		});
	});

	it("rejects non-strict JSON candidate payload while keeping it on the DATA issue path", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "non-strict-payload",
					proposalId: "non-strict-payload",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-non-strict",
							fragment: fragment({
								id: "fragment-non-strict",
								payload: 1n as never,
							}),
						}),
					},
				}),
			],
			applicationPolicy(),
		);

		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({
				state: "rejected",
				reasonCode: "material-identity-invalid",
			}),
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application.material-identity-invalid",
			}),
		]);
	});

	it("snapshots strict JSON candidate payloads before exposing material identity-backed facts", () => {
		const payload = { nested: { value: "before" } };
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "object-payload",
					proposalId: "object-payload",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-object-payload",
							fragment: fragment({
								id: "fragment-object-payload",
								payload,
							}),
						}),
					},
				}),
			],
			applicationPolicy(),
		);

		payload.nested.value = "after";
		const appliedPayload = snapshot.records[0]?.fragment.payload as
			| { readonly nested: { readonly value: string } }
			| undefined;
		expect(appliedPayload).toEqual({ nested: { value: "before" } });
		expect(Object.isFrozen(appliedPayload)).toBe(true);
		expect(Object.isFrozen(appliedPayload?.nested)).toBe(true);
		expect(
			JSON.parse(snapshot.applicationDecisions[0]?.materialIdentity?.key ?? "{}").record.record
				.fragment.payload,
		).toEqual({ nested: { value: "before" } });
	});

	it("keeps hostile priorEvidence getters and unsafe input lengths on the DATA issue path", () => {
		const hostilePriorEvidence = {
			kind: "agentic-memory-record-application-prior-evidence",
			entries: [],
		};
		Object.defineProperty(hostilePriorEvidence, "entries", {
			get() {
				throw new Error("priorEvidence getter exploded");
			},
			enumerable: true,
		});
		const hostileAdmissions = new Proxy([], {
			get(target, prop, receiver) {
				if (prop === "length") throw new Error("admissions length exploded");
				return Reflect.get(target, prop, receiver);
			},
		});
		const hostileRecords = new Proxy([], {
			get(target, prop, receiver) {
				if (prop === "length") throw new Error("records length exploded");
				return Reflect.get(target, prop, receiver);
			},
		});

		const snapshot = applyAgenticMemoryRecordAdmissions(hostileAdmissions, applicationPolicy(), {
			records: hostileRecords,
			priorEvidence: hostilePriorEvidence,
		});

		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.record.invalid",
			"agentic-memory.application-prior-evidence.invalid",
			"agentic-memory.application.invalid-admissions-input",
		]);
		expect(snapshot.status).toMatchObject({
			state: "error",
			cursor: { records: 0, admissions: 0, invalidAdmissions: 1, invalidPriorEvidenceEntries: 1 },
		});
	});

	it("rejects create target mismatches and duplicate record or fragment ids as DATA issues", () => {
		const current = [
			record({ id: "record-existing", fragment: fragment({ id: "fragment-existing" }) }),
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "target-update",
					proposalId: "target-update",
					targetRecordId: "other-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-target", fragment: fragment({ id: "fragment-target" }) }),
					},
				}),
				admitted({
					admissionId: "duplicate-record",
					proposalId: "duplicate-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-existing", fragment: fragment({ id: "fragment-new" }) }),
					},
				}),
				admitted({
					admissionId: "duplicate-fragment",
					proposalId: "duplicate-fragment",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-with-duplicate-fragment",
							fragment: fragment({ id: "fragment-existing" }),
						}),
					},
				}),
				admitted({
					admissionId: "first-create",
					proposalId: "first-create",
					idempotencyKey: "first-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-created", fragment: fragment({ id: "created" }) }),
					},
				}),
				admitted({
					admissionId: "second-create",
					proposalId: "second-create",
					idempotencyKey: "second-create",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-created",
							fragment: fragment({ id: "created-again" }),
						}),
					},
				}),
			],
			applicationPolicy(),
			{ records: current },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing", "record-created"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["target-update", "rejected", "target-record-id-mismatch"],
			["duplicate-record", "rejected", "record-id-conflict"],
			["duplicate-fragment", "rejected", "fragment-id-conflict"],
			["first-create", "applied", "applied-create"],
			["second-create", "rejected", "record-id-conflict"],
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.target-record-id-mismatch",
			"agentic-memory.application.record-id-conflict",
			"agentic-memory.application.fragment-id-conflict",
			"agentic-memory.application.record-id-conflict",
		]);
		expect(snapshot.status).toMatchObject({
			state: "partial",
			cursor: { applied: 1, rejected: 4, issues: 4 },
		});
	});

	it("does not let policy markers disable D577 create-only duplicate gates", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "duplicate-record",
					proposalId: "duplicate-record",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-existing",
							fragment: fragment({ id: "fragment-existing" }),
						}),
					},
				}),
			],
			{
				kind: "agentic-memory-record-application-policy",
				policyId: "application-policy",
				rejectDuplicateRecordIds: false,
				rejectDuplicateFragmentIds: false,
			},
			{
				records: [
					record({
						id: "record-existing",
						fragment: fragment({ id: "fragment-existing" }),
					}),
				],
			},
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-existing"]);
		expect(snapshot.applicationDecisions).toEqual([]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application-policy.invalid",
				refs: expect.arrayContaining([
					"policy.rejectDuplicateRecordIds must be true when present",
					"policy.rejectDuplicateFragmentIds must be true when present",
				]),
			}),
		]);
		expect(snapshot.status).toMatchObject({ state: "error" });
	});

	it("skips matching idempotency replay and rejects conflicting reuse", () => {
		const priorEvidence: readonly AgenticMemoryRecordApplicationEvidence[] = [
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-mixed",
				proposalId: "proposal-mixed",
				operation: "create",
				operationVersion: 1,
				recordId: "record-mixed",
				fragmentId: "fragment-mixed",
				targetRecordId: "record-mixed",
				materialIdentity: applicationMaterialIdentity(
					"create",
					record({ id: "record-mixed", fragment: fragment({ id: "fragment-mixed" }) }),
				),
			},
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-mixed-conflict",
				proposalId: "proposal-mixed-conflict",
				operation: "create",
				operationVersion: 1,
				idempotencyKey: "idem-mixed",
				recordId: "record-mixed-conflict",
				fragmentId: "fragment-mixed-conflict",
				targetRecordId: "record-mixed-conflict",
				materialIdentity: applicationMaterialIdentity(
					"create",
					record({
						id: "record-mixed-conflict",
						fragment: fragment({ id: "fragment-mixed-conflict" }),
					}),
				),
			},
			{
				kind: "agentic-memory-record-application-evidence",
				admissionId: "admission-priorEvidence",
				proposalId: "proposal-priorEvidence",
				operation: "create",
				operationVersion: 1,
				idempotencyKey: "idem-priorEvidence",
				recordId: "record-priorEvidence",
				fragmentId: "fragment-priorEvidence",
				targetRecordId: "record-priorEvidence",
				materialIdentity: applicationMaterialIdentity(
					"create",
					record({
						id: "record-priorEvidence",
						fragment: fragment({ id: "fragment-priorEvidence" }),
					}),
				),
			},
		];
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-mixed",
					proposalId: "proposal-mixed",
					idempotencyKey: "idem-mixed",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-mixed", fragment: fragment({ id: "fragment-mixed" }) }),
					},
				}),
				admitted({
					admissionId: "admission-priorEvidence",
					proposalId: "proposal-priorEvidence",
					operation: "create",
					operationVersion: 1,
					idempotencyKey: "idem-priorEvidence",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-priorEvidence",
							fragment: fragment({ id: "fragment-priorEvidence" }),
						}),
					},
				}),
				admitted({
					admissionId: "admission-conflict",
					proposalId: "proposal-conflict",
					idempotencyKey: "idem-priorEvidence",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
					},
				}),
				admitted({
					admissionId: "admission-current",
					proposalId: "proposal-current",
					idempotencyKey: "idem-current",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-current",
							fragment: fragment({ id: "fragment-current" }),
						}),
					},
				}),
				admitted({
					admissionId: "admission-current",
					proposalId: "proposal-current-repeat",
					idempotencyKey: "idem-current",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-current",
							fragment: fragment({ id: "fragment-current" }),
						}),
					},
				}),
			],
			applicationPolicy(),
			{ priorEvidence },
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-current"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["proposal-mixed", "rejected", "idempotency-conflict"],
			["proposal-priorEvidence", "skipped", "already-applied"],
			["proposal-conflict", "rejected", "idempotency-conflict"],
			["proposal-current", "applied", "applied-create"],
			["proposal-current-repeat", "skipped", "already-applied"],
		]);
		expect(snapshot.issues).toEqual([
			expect.objectContaining({
				code: "agentic-memory.application.idempotency-conflict",
				subjectId: "admission-mixed",
			}),
			expect.objectContaining({
				code: "agentic-memory.application.idempotency-conflict",
				subjectId: "admission-conflict",
			}),
		]);
	});

	it("rejects same-coordinate idempotency evidence when full candidate material differs", () => {
		const sameIdsDifferentPayload = admitted({
			admissionId: "same-coordinate-payload",
			proposalId: "same-coordinate-payload",
			idempotencyKey: "idem-same-coordinate-payload",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-same-coordinate",
					fragment: fragment({ id: "fragment-same-coordinate", payload: "new payload" }),
				}),
			},
		});
		const sameIdsDifferentKind = admitted({
			admissionId: "same-coordinate-kind",
			proposalId: "same-coordinate-kind",
			idempotencyKey: "idem-same-coordinate-kind",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({
					id: "record-kind-coordinate",
					kind: "procedural",
					artifactKind: "procedure",
					fragment: fragment({ id: "fragment-kind-coordinate" }),
				}),
			},
		});

		const snapshot = applyAgenticMemoryRecordAdmissions(
			[sameIdsDifferentPayload, sameIdsDifferentKind],
			applicationPolicy(),
			{
				priorEvidence: [
					{
						kind: "agentic-memory-record-application-evidence",
						admissionId: "same-coordinate-payload",
						proposalId: "same-coordinate-payload",
						operation: "create",
						operationVersion: 1,
						idempotencyKey: "idem-same-coordinate-payload",
						recordId: "record-same-coordinate",
						fragmentId: "fragment-same-coordinate",
						targetRecordId: "record-same-coordinate",
						materialIdentity: applicationMaterialIdentity(
							"create",
							record({
								id: "record-same-coordinate",
								fragment: fragment({
									id: "fragment-same-coordinate",
									payload: "old payload",
								}),
							}),
						),
					},
					{
						kind: "agentic-memory-record-application-evidence",
						admissionId: "same-coordinate-kind",
						proposalId: "same-coordinate-kind",
						operation: "create",
						operationVersion: 1,
						idempotencyKey: "idem-same-coordinate-kind",
						recordId: "record-kind-coordinate",
						fragmentId: "fragment-kind-coordinate",
						targetRecordId: "record-kind-coordinate",
						materialIdentity: applicationMaterialIdentity(
							"create",
							record({
								id: "record-kind-coordinate",
								kind: "semantic",
								artifactKind: "insight",
								fragment: fragment({ id: "fragment-kind-coordinate" }),
							}),
						),
					},
				],
			},
		);

		expect(snapshot.applicationDecisions.map((decision) => decision.reasonCode)).toEqual([
			"idempotency-conflict",
			"idempotency-conflict",
		]);
		expect(snapshot.issues.map((issue) => issue.code)).toEqual([
			"agentic-memory.application.idempotency-conflict",
			"agentic-memory.application.idempotency-conflict",
		]);
	});

	it("keeps create, replace, and update material identities distinct and reports operation statuses", () => {
		const current = [record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) })];
		const createSnapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "create-same-ids",
					proposalId: "create-same-ids",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-x", fragment: fragment({ id: "fragment-x" }) }),
					},
				}),
			],
			applicationPolicy(),
		);
		const mixedSnapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "replace-a",
					proposalId: "replace-a",
					operation: "replace",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-a",
							fragment: fragment({
								id: "fragment-a-v2",
								parentFragmentId: "fragment-a",
							}),
						}),
					},
				}),
				admitted({
					admissionId: "update-a",
					proposalId: "update-a",
					operation: "update",
					targetRecordId: "record-a",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({
							id: "record-a",
							fragment: fragment({
								id: "fragment-a-v3",
								parentFragmentId: "fragment-a-v2",
							}),
						}),
					},
				}),
				admitted({
					admissionId: "create-b",
					proposalId: "create-b",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-b", fragment: fragment({ id: "fragment-b" }) }),
					},
				}),
			],
			applicationPolicy(),
			{ records: current, evaluation: 12 },
		);

		expect(createSnapshot.applicationDecisions[0]?.materialIdentity?.key).not.toEqual(
			applicationMaterialIdentity(
				"replace",
				record({ id: "record-x", fragment: fragment({ id: "fragment-x" }) }),
				"record-x",
			).key,
		);
		expect(createSnapshot.applicationDecisions[0]?.materialIdentity?.key).not.toEqual(
			applicationMaterialIdentity(
				"update",
				record({ id: "record-x", fragment: fragment({ id: "fragment-x" }) }),
				"record-x",
			).key,
		);
		expect(mixedSnapshot.operationStatuses).toEqual([
			expect.objectContaining({
				operation: "create",
				state: "ready",
				cursor: expect.objectContaining({ evaluation: 12, applied: 1, decisions: 1 }),
			}),
			expect.objectContaining({
				operation: "replace",
				state: "ready",
				cursor: expect.objectContaining({ evaluation: 12, applied: 1, decisions: 1 }),
			}),
			expect.objectContaining({
				operation: "update",
				state: "ready",
				cursor: expect.objectContaining({ evaluation: 12, applied: 1, decisions: 1 }),
			}),
		]);
		expect(mixedSnapshot.status).toMatchObject({ state: "ready", cursor: { applied: 3 } });
	});

	it("does not index skipped decisions as same-evaluation application evidence", () => {
		const snapshot = applyAgenticMemoryRecordAdmissions(
			[
				admitted({
					admissionId: "admission-replay",
					proposalId: "proposal-skipped",
					state: "needs-review",
					idempotencyKey: "idem-replay",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-replay", fragment: fragment({ id: "fragment-replay" }) }),
					},
				}),
				admitted({
					admissionId: "admission-replay",
					proposalId: "proposal-applied",
					idempotencyKey: "idem-replay",
					candidateMaterial: {
						kind: "agentic-memory-record-candidate-material",
						record: record({ id: "record-replay", fragment: fragment({ id: "fragment-replay" }) }),
					},
				}),
			],
			applicationPolicy(),
		);

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-replay"]);
		expect(
			snapshot.applicationDecisions.map((decision) => [
				decision.proposalId,
				decision.state,
				decision.reasonCode,
			]),
		).toEqual([
			["proposal-skipped", "skipped", "skipped-non-admitted"],
			["proposal-applied", "applied", "applied-create"],
		]);
		expect(snapshot.issues).toEqual([]);
	});

	it("scopes application prior evidence by applicationId when present", () => {
		const admission = admitted({
			admissionId: "admission-scoped",
			proposalId: "proposal-scoped",
			idempotencyKey: "idem-scoped",
			candidateMaterial: {
				kind: "agentic-memory-record-candidate-material",
				record: record({ id: "record-scoped", fragment: fragment({ id: "fragment-scoped" }) }),
			},
		});
		const snapshot = applyAgenticMemoryRecordAdmissions([admission], applicationPolicy(), {
			priorEvidence: [
				{
					kind: "agentic-memory-record-application-evidence",
					applicationId: "other-application",
					admissionId: "admission-scoped",
					proposalId: "proposal-scoped",
					operation: "create",
					operationVersion: 1,
					idempotencyKey: "idem-scoped",
					recordId: "record-other",
					fragmentId: "fragment-other",
					targetRecordId: "record-other",
					materialIdentity: applicationMaterialIdentity(
						"create",
						record({ id: "record-other", fragment: fragment({ id: "fragment-other" }) }),
					),
				},
			],
		});

		expect(snapshot.records.map((item) => item.id)).toEqual(["record-scoped"]);
		expect(snapshot.applicationDecisions).toEqual([
			expect.objectContaining({
				applicationId:
					'agentic-memory-record-application:["application-policy","admission-scoped"]',
				state: "applied",
				reasonCode: "applied-create",
			}),
		]);
		expect(snapshot.issues).toEqual([]);
	});
});

describe("agentic memory context packing (D168)", () => {
	const contextFact = (): AgenticMemoryContext<string> => ({
		state: "ready",
		query: {},
		entries: [
			{
				fragmentId: "f1",
				payload: "one",
				confidence: 0.9,
				tags: ["a"],
				sources: [],
				record: {
					recordId: "r1",
					kind: "semantic",
					persistenceLevel: "project",
					artifactKind: "insight",
					scope: { projectId: "project-1" },
				},
				attribution: {
					kind: "agentic-memory-context-attribution",
					fragmentId: "f1",
					recordId: "r1",
					queryId: "query-1",
					rank: 1,
					score: 0.42,
					truncated: true,
					truncation: {
						originalChars: 10,
						packedChars: 3,
						omittedChars: 7,
						reason: "budget",
						metadata: { lane: "fixture" },
					},
					sourceRefs: [{ kind: "retrieval", id: "retrieval-1", metadata: { rank: 1 } }],
					policyRefs: [{ kind: "policy", id: "packing-policy" }],
					metadata: { nested: { ok: true } },
				},
				fragment: fragment({ id: "f1", payload: "one" }),
			},
			{
				fragmentId: "f2",
				payload: "two",
				confidence: 0.8,
				tags: ["a"],
				sources: [],
				attribution: { fragmentId: "f2", rank: 2 },
				fragment: fragment({ id: "f2", payload: "two" }),
			},
			{
				fragmentId: "f3",
				payload: "three",
				confidence: 0.7,
				tags: ["a"],
				sources: [],
				fragment: fragment({ id: "f3", payload: "three" }),
			},
		],
		cursor: { evaluation: 1, validFragments: 3, invalidFragments: 0, resultCount: 3 },
		errors: [],
		retrievalErrors: [],
		contextReady: true,
	});

	it("packs explicit text in context order with maxEntries/maxChars/maxCost and metadata inclusion", () => {
		const g = graph();
		const context = g.state(contextFact(), { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[
				{ fragmentId: "f1", text: "aaa", cost: 1, metadata: { role: "evidence" } },
				{ fragmentId: "f2", text: "bbbb", cost: 3, metadata: { role: "procedure" } },
			],
			{ name: "texts" },
		);
		const policy = g.state<AgenticMemoryContextPackingPolicy>(
			{ maxEntries: 2, maxChars: 9, maxCost: 4, includeMetadata: true },
			{ name: "policy" },
		);
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "context", to: "packing/projection" },
				{ from: "texts", to: "packing/projection" },
				{ from: "policy", to: "packing/projection" },
				{ from: "packing/projection", to: "packing/packedContext" },
				{ from: "packing/projection", to: "packing/status" },
				{ from: "packing/projection", to: "packing/errors" },
				{ from: "packing/projection", to: "packing/cursor" },
			]),
		);
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)).toMatchObject({
			text: "aaa\n\nbbbb",
			totalChars: 9,
			totalCost: 4,
			truncated: true,
			entries: [
				{
					fragmentId: "f1",
					metadata: { role: "evidence" },
					record: { recordId: "r1", scope: { projectId: "project-1" } },
					attribution: {
						kind: "agentic-memory-context-attribution",
						fragmentId: "f1",
						recordId: "r1",
						queryId: "query-1",
						rank: 1,
						score: 0.42,
						truncated: true,
						truncation: {
							originalChars: 10,
							packedChars: 3,
							omittedChars: 7,
							reason: "budget",
							metadata: { lane: "fixture" },
						},
						sourceRefs: [{ kind: "retrieval", id: "retrieval-1", metadata: { rank: 1 } }],
						policyRefs: [{ kind: "policy", id: "packing-policy" }],
						metadata: { nested: { ok: true } },
					},
				},
				{
					fragmentId: "f2",
					metadata: { role: "procedure" },
					attribution: { fragmentId: "f2", rank: 2 },
				},
			],
		});
		const latestPacked = data<AgenticMemoryPackedContext>(packed.messages).at(-1);
		expect(Object.isFrozen(latestPacked?.entries)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0])).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution?.truncation)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.attribution?.metadata?.nested)).toBe(true);
		expect(Object.isFrozen(latestPacked?.entries[0]?.metadata)).toBe(true);
		expect(data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(-1)).toEqual([
			expect.objectContaining({ code: "missing-text", fragmentId: "f3" }),
		]);
		expect(data<AgenticMemoryContextPackingStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { packedEntries: 2, omittedEntries: 1, totalChars: 9, totalCost: 4 },
		});

		policy.set({ maxEntries: 1, includeMetadata: true });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxChars: 6 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxCost: 3 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
	});

	it("turns malformed context and text metadata into DATA errors", () => {
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [null, { fragmentId: "" }, { fragmentId: "f1", record: { recordId: "r1" } }],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[{ fragmentId: "f1", text: "ok", metadata: ["not", "a", "record"] as never }],
			{ name: "texts" },
		);
		const policy = g.state({ includeMetadata: true }, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-context", "invalid-context", "invalid-context", "invalid-text"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects invalid context attribution as DATA errors", () => {
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution: {
							fragmentId: "wrong-fragment",
							recordId: "wrong-record",
							rank: 0,
							score: Number.POSITIVE_INFINITY,
							truncated: false,
							truncation: new Date("2026-07-03T00:00:00.000Z"),
							sourceRefs: [{ kind: "source", id: "source-1", providerHandle: "nope" }],
							metadata: { bad: undefined },
							graph: "nope",
						},
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(-1)?.[0],
		).not.toHaveProperty("value");
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution.graph is not graph-visible DATA",
				"attribution.fragmentId must match the containing fragmentId",
				"attribution.recordId must match the containing record.recordId",
				"attribution.rank must be a 1-based safe integer when present",
				"attribution.score must be a finite number when present",
				"attribution.truncation must be a plain data object",
				"attribution.truncation requires attribution.truncated to be true or omitted",
				"attribution.sourceRefs: [0] has unexpected fields providerHandle",
				"attribution.sourceRefs: [0].providerHandle is not graph-visible DATA",
				"attribution.metadata must be a strict JSON object",
			]),
		);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects non-data attribution fact refs as DATA errors", () => {
		const sourceRefs = [{ kind: "source", id: "source-1" }] as Array<Record<PropertyKey, unknown>>;
		sourceRefs[Symbol("array-secret") as never] = true;
		Object.defineProperty(sourceRefs, "graph", {
			value: "nope",
			enumerable: true,
		});
		const policyRef = { kind: "policy" } as Record<PropertyKey, unknown>;
		policyRef[Symbol("ref-secret")] = true;
		Object.defineProperty(policyRef, "id", {
			get() {
				throw new Error("id getter should not run");
			},
			enumerable: true,
		});
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution: {
							fragmentId: "f1",
							recordId: "r1",
							sourceRefs,
							policyRefs: [policyRef],
						},
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const errors = collect(bundle.errors);

		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution.sourceRefs: refs must not carry symbol keys",
				"attribution.sourceRefs: refs.graph must be an indexed data property",
				"attribution.policyRefs: [0] must not carry symbol keys",
				"attribution.policyRefs: [0].id must be a data property",
			]),
		);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("rejects non-data attribution containers as DATA errors", () => {
		const symbolKey = Symbol("secret");
		const attribution = { fragmentId: "f1" } as Record<PropertyKey, unknown>;
		attribution[symbolKey] = true;
		Object.defineProperty(attribution, "rank", {
			get: () => 1,
			enumerable: true,
		});
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [
					{
						...contextFact().entries[0],
						attribution,
					},
				],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state({}, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const errors = collect(bundle.errors);

		const validationErrors = data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(
			-1,
		)?.[0]?.validationErrors;
		expect(validationErrors).toEqual(
			expect.arrayContaining([
				"attribution must not carry symbol keys",
				"attribution.rank must be a data property",
			]),
		);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps throwing context and policy getters on the DATA error path", () => {
		const g = graph();
		const hostileContext = { entries: [{ fragmentId: "f1" }] };
		Object.defineProperty(hostileContext, "query", {
			get() {
				throw new Error("query boom");
			},
			enumerable: true,
		});
		const hostilePolicy = {};
		Object.defineProperty(hostilePolicy, "maxChars", {
			get() {
				throw new Error("policy boom");
			},
			enumerable: true,
		});
		const context = g.state(hostileContext as never, { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state<AgenticMemoryContextPackingPolicy>(hostilePolicy as never, {
			name: "policy",
		});
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-policy"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);

		policy.set({ includeMetadata: true });
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.text).toBe("ok");
	});
});

describe("agentic memory duplicate fragment ownership (D169)", () => {
	it("excludes duplicate fragment records from retrieval, context, metadata, and downstream bundles", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "same", payload: "kept" }) }),
				record({ id: "record-b", fragment: fragment({ id: "same", payload: "dropped" }) }),
			],
			{ name: "records" },
		);
		const query = g.state({}, { name: "query" });
		const memory = agenticMemoryBundle(g, { name: "memory", records, query });
		const drafts = g.state<readonly AgenticMemoryKgAssertionDraft[]>(
			[
				{
					id: "assert-kept",
					recordId: "record-a",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "kept" },
				},
				{
					id: "assert-dropped",
					recordId: "record-b",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "dropped" },
				},
			],
			{ name: "drafts" },
		);
		const kg = agenticMemoryKgProjectionBundle(g, { name: "kg", records, drafts });
		const commands = g.state<readonly AgenticMemoryRetentionCommand[]>(
			[
				{ id: "archive-dropped", kind: "archive", recordId: "record-b" },
				{ id: "consolidate-dropped", kind: "requestConsolidation", recordIds: ["record-b"] },
			],
			{ name: "commands" },
		);
		const retention = agenticMemoryRetentionBundle(g, { name: "retention", records, commands });
		const projected = collect(memory.fragments);
		const ranked = collect(memory.ranked);
		const context = collect(memory.context);
		const sources = collect(memory.sources);
		const kgAssertions = collect(kg.assertions);
		const kgErrors = collect(kg.errors);
		const active = collect(retention.activeRecords);
		const retentionErrors = collect(retention.errors);

		query.set({});

		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => [entry.fragmentId, entry.payload, entry.record?.recordId]),
		).toEqual([["same", "kept", "record-a"]]);
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toMatchObject([
			{ fragmentId: "same", record: { recordId: "record-a" } },
		]);
		expect(
			data<readonly unknown[]>(kgAssertions.messages)
				.at(-1)
				?.map((item) => (item as { id: string }).id),
		).toEqual(["assert-kept"]);
		expect(
			data<readonly AgenticMemoryKgProjectionError[]>(kgErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref"]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(active.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["record-a"]);
		expect(
			data<readonly AgenticMemoryRetentionError[]>(retentionErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref", "missing-record-ref"]);
	});
});
