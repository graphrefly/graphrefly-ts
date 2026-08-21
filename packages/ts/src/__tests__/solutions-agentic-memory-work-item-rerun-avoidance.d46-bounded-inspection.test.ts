import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D44_BUGGY_ADMISSION_BLOCK,
	D44_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.js";
import {
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "../../evals/empirical-memory-rerun-avoidance/d45-graph-tool-qualification.js";
import {
	admitD46EffectResult,
	createD46BoundedInspectionAuthority,
	D46_MAX_PROJECTED_BYTES,
	D46_MAX_SOURCE_BYTES,
	D46_MAX_WINDOWS,
	lowerD46ProviderEffect,
	projectD46BoundedInspection,
	readD46ToolArguments,
	takeD46AdmittedEffect,
	validateD46CanonicalEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-authority.js";
import {
	persistD46Qualification,
	runD46InjectedNoNetworkQualification,
	validateD46QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
let qualificationPromise: ReturnType<typeof runD46InjectedNoNetworkQualification> | undefined;
const qualification = () =>
	(qualificationPromise ??= runD46InjectedNoNetworkQualification({ repositoryRoot }));

describe("graphrefly-ts:D46 Graph-owned bounded inspection projection", () => {
	it("derives a bounded public-context projection that contains the frozen target span", async () => {
		const fixed = await readFile(resolve(repositoryRoot, D45_WRITABLE_PATH), "utf8");
		const buggy = fixed.replace(D44_FIXED_ADMISSION_BLOCK, D44_BUGGY_ADMISSION_BLOCK);
		const projection = projectD46BoundedInspection({
			path: D45_WRITABLE_PATH,
			content: buggy,
			publicContext: `${D45_TASK_MATERIAL.systemInstruction}\n${D45_TASK_MATERIAL.taskStatement}\n${D45_TASK_MATERIAL.armContexts.cold}`,
		});
		expect(projection.sourceBytes).toBeGreaterThan(100_000);
		expect(projection.projectedBytes).toBeLessThanOrEqual(D46_MAX_PROJECTED_BYTES);
		expect(projection.windows.length).toBeLessThanOrEqual(D46_MAX_WINDOWS);
		expect(projection.content).toContain(D44_BUGGY_ADMISSION_BLOCK);
		expect(projection.content).not.toBe(buggy);
		for (let index = 1; index < projection.windows.length; index += 1)
			expect(projection.windows[index]!.startLine).toBeGreaterThan(
				projection.windows[index - 1]!.endLine,
			);
		const fallback = projectD46BoundedInspection({
			path: "bounded.ts",
			content: "first\nsecond\nthird",
			publicContext: "zzzz-no-source-match",
		});
		expect(fallback.windows).toHaveLength(1);
		expect(() =>
			projectD46BoundedInspection({
				path: "over-bound.ts",
				content: "x".repeat(D46_MAX_SOURCE_BYTES + 1),
				publicContext: "public context",
			}),
		).toThrow(/source bound/);
	});

	it("runs and atomically persists all six no-network arms without durable raw material", async () => {
		const bundle = validateD46QualificationBundle(await qualification());
		expect(bundle.qualification.exactSixArmsCompleted).toBe(true);
		expect(bundle.qualification.evaluableArms).toBe(6);
		expect(bundle.qualification.boundedReadFacts).toBe(24);
		expect(bundle.qualification.providerCalls).toBe(31);
		expect(bundle.qualification.exactD710RetryIdentity).toBe(true);
		expect(
			bundle.evidence.d45Evidence.facts
				.filter(
					(fact) =>
						fact.factKind === "effect-admitted" && fact.effect.effectKind === "provider-proposal",
				)
				.map((fact) =>
					fact.factKind === "effect-admitted" ? fact.effect.elapsedReservationMs : 0,
				),
		).toEqual(Array(31).fill(600_000));
		expect(bundle.partialEvidence.d45PartialEvidence.terminalCauseCode).toBe(
			"provider-interrupted",
		);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(JSON.stringify(bundle)).not.toContain(D44_BUGGY_ADMISSION_BLOCK);
		expect(JSON.stringify(bundle)).not.toContain(D44_FIXED_ADMISSION_BLOCK);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d46-persistence-"));
		try {
			const receipt = await persistD46Qualification({ directory: root, bundle });
			expect(receipt.bundleArtifactDigest).toBe(receipt.commitArtifactDigest);
			await expect(persistD46Qualification({ directory: root, bundle })).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);

	it("fails closed on stale workspace and replays while keeping D45 authority opaque", () => {
		const authority = createD46BoundedInspectionAuthority();
		expect(Object.keys(authority)).toEqual(["revision"]);
		const workspaceStateDigest = empiricalStrictJsonDigest("workspace/current");
		const materialization = takeD46AdmittedEffect(authority)!;
		admitD46EffectResult(authority, materialization, {
			effectKind: "local-effect",
			outcome: "success",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("materialized"),
			workspaceStateDigest,
			criteria: null,
		});
		const proposal = takeD46AdmittedEffect(authority)!;
		const wire = lowerD46ProviderEffect(authority, proposal);
		admitD46EffectResult(authority, proposal, {
			effectKind: "provider-proposal",
			outcome: "success",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: wire.wireDigest,
			retryClass: null,
			proposal: { toolCalls: [{ toolRef: "read-file", path: D45_WRITABLE_PATH }] },
		});
		const freshness = takeD46AdmittedEffect(authority)!;
		admitD46EffectResult(authority, freshness, {
			effectKind: "workspace-freshness",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest("fresh"),
			observedWorkspaceStateDigest: workspaceStateDigest,
		});
		const read = takeD46AdmittedEffect(authority)!;
		expect(readD46ToolArguments(authority, read)).toEqual({
			toolRef: "read-file",
			path: D45_WRITABLE_PATH,
		});
		const content = "proposal provenance\ncanonical admission\nworker claim";
		const executorEvidenceDigest = empiricalStrictJsonDigest({
			request: read.requestDigest,
			contentDigest: empiricalStrictJsonDigest(content),
		});
		const accessorResult = Object.defineProperty({}, "effectKind", {
			enumerable: true,
			get: () => "tool-action",
		});
		expect(() => admitD46EffectResult(authority, read, accessorResult as never)).toThrow(
			/own data property/,
		);
		expect(() =>
			admitD46EffectResult(authority, read, {
				effectKind: "tool-action",
				status: "success",
				causeCode: null,
				elapsedMs: 1,
				evidenceDigest: executorEvidenceDigest,
				workspaceStateBeforeDigest: empiricalStrictJsonDigest("workspace/stale"),
				workspaceStateAfterDigest: empiricalStrictJsonDigest("workspace/stale"),
				content,
			}),
		).toThrow(/stale workspace state/);
		admitD46EffectResult(authority, read, {
			effectKind: "tool-action",
			status: "success",
			causeCode: null,
			elapsedMs: 1,
			evidenceDigest: executorEvidenceDigest,
			workspaceStateBeforeDigest: workspaceStateDigest,
			workspaceStateAfterDigest: workspaceStateDigest,
			content,
		});
		expect(() => admitD46EffectResult(authority, read, {} as never)).toThrow(/active admission/);
	});

	it("rejects a recomputed projection substitution that no longer matches its D45 tool fact", async () => {
		const evidence = structuredClone((await qualification()).evidence);
		const first = evidence.sliceFacts[0]!;
		const forgedDigest = `sha256:${"f".repeat(64)}`;
		const forgedFactMaterial = { ...first, projectedDigest: forgedDigest };
		const { factDigest: _factDigest, ...factMaterial } = forgedFactMaterial;
		const forgedFact = {
			...factMaterial,
			factDigest: empiricalStrictJsonDigest(factMaterial),
		};
		const forgedMaterial = {
			...evidence,
			sliceFacts: [forgedFact, ...evidence.sliceFacts.slice(1)],
		};
		const { evidenceDigest: _evidenceDigest, ...material } = forgedMaterial;
		const forged = {
			...material,
			evidenceDigest: empiricalStrictJsonDigest(material),
		};
		expect(() => validateD46CanonicalEvidence(forged)).toThrow(/fact failed replay/);
		const accessor = structuredClone((await qualification()).evidence) as unknown as Record<
			string,
			unknown
		>;
		accessor.rawContent = "forbidden";
		expect(() => validateD46CanonicalEvidence(accessor as never)).toThrow(/unexpected keys/);
	}, 180_000);
});
