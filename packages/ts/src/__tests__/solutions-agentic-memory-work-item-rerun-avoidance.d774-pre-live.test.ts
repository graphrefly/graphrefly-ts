import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D774_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD774Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d774-implementation-manifest.js";
import {
	createD774InjectedBaselineForTest,
	persistD774InjectedBundleForTest,
	persistD774QualificationBundle,
	runD774InjectedNoNetworkQualification,
	validateD774QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d774-pre-live-qualification.js";
import {
	createD774ProviderResultEnvelope,
	createD774RouteAuthority,
	D774_ROUTE_PROPOSAL_SCHEMA,
	lowerD774ProviderChatRequest,
	validateD774ProviderResultEnvelope,
	validateD774RouteEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d774-provider-result-route-authority.js";

let qualificationPromise: ReturnType<typeof runD774InjectedNoNetworkQualification> | undefined;

async function bundle() {
	qualificationPromise ??= runD774InjectedNoNetworkQualification(
		createD774InjectedBaselineForTest(),
	);
	return structuredClone(await qualificationPromise);
}

function providerBody(): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			model: "deepseek/deepseek-v3.1-terminus",
			messages: [{ role: "user", content: "bounded D774 fixture" }],
			tools: [
				{ type: "function", function: { name: "read_file", parameters: {} } },
				{ type: "function", function: { name: "replace_exact", parameters: {} } },
				{ type: "function", function: { name: "workspace_diff", parameters: {} } },
				{ type: "function", function: { name: "focused_validation", parameters: {} } },
			],
			tool_choice: "required",
			provider: { order: ["DeepInfra"], allow_fallbacks: false },
			reasoning: { effort: "high" },
			stream: false,
		}),
	);
}

describe("D774 provider envelope and phase lowering pre-live", () => {
	it("freezes the exact decision-bearing implementation closure", async () => {
		expect(await measureD774Implementation()).toBe(D774_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("qualifies all six arms with exact route bijection and unchanged retry identity", async () => {
		const result = await bundle();
		const validated = validateD774QualificationBundle(structuredClone(result));
		expect(validated.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(validated.routeEvidence.coverageComplete).toBe(true);
		expect(validated.routeEvidence.facts).toHaveLength(
			validated.qualification.providerCalls as number,
		);
		expect(new Set(validated.routeEvidence.facts.map((fact) => fact.requestDigest)).size).toBe(
			validated.routeEvidence.facts.length,
		);
		expect(
			validated.terminalHttpGraphEvidence.effectRuns
				.flatMap((run) => run.facts)
				.some(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "provider-request" &&
						fact.result.failureProvenance === "http-terminal",
				),
		).toBe(true);
		expect(
			validated.hiddenFailureGraphEvidence.effectRuns
				.flatMap((run) => run.facts)
				.some(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "hidden-verifier" &&
						fact.result.status === "failed",
				),
		).toBe(true);
		for (const phase of [
			"exact-mutation",
			"workspace-diff",
			"focused-validation",
			"hidden-verifier",
		] as const)
			expect(validated.routeEvidence.facts.some((fact) => fact.nextRequiredPhase === phase)).toBe(
				true,
			);
		const retried = validated.routeEvidence.facts.filter((fact) => fact.attemptOrdinal === 2);
		expect(retried).toHaveLength(3);
		for (const retry of retried) {
			const first = validated.routeEvidence.facts.find(
				(fact) =>
					fact.logicalRequestDigest === retry.logicalRequestDigest && fact.attemptOrdinal === 1,
			);
			expect(first?.loweredBodyDigest).toBe(retry.loweredBodyDigest);
			expect(first?.contextDigest).toBe(retry.contextDigest);
		}
	}, 30_000);

	it("mechanically lowers every Graph phase and rejects accessor or wrong binding before transport", async () => {
		const result = await bundle();
		for (const routeFact of result.routeEvidence.facts.filter(
			(fact) => fact.nextRequiredPhase !== null,
		)) {
			const graphFact = result.graphEvidence.effectRuns
				.flatMap((run) => run.facts)
				.find(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.request.requestDigest === routeFact.requestDigest,
				);
			const admission = result.graphEvidence.ledger.effectAdmissions.find(
				(value) => value.decisionDigest === routeFact.admissionDigest,
			);
			if (graphFact?.kind !== "graph-effect-result-admitted" || admission === undefined)
				throw new TypeError("D774 test fixture lacks Graph coordinates");
			const lowered = lowerD774ProviderChatRequest({
				effectRequest: graphFact.request,
				admission,
				body: providerBody(),
			});
			expect(lowered.proposal.requiredToolName).toBe(routeFact.requiredToolName);
			expect(lowered.proposal.requiredDisposition).toBe(routeFact.requiredDisposition);
		}
		const first = result.graphEvidence.effectRuns[0]!.facts.find(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request",
		);
		if (first?.kind !== "graph-effect-result-admitted")
			throw new TypeError("missing provider fact");
		const admission = result.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === first.admissionDigest,
		)!;
		const accessorInput = Object.create(null) as Record<string, unknown>;
		Object.defineProperties(accessorInput, {
			effectRequest: { enumerable: true, value: first.request },
			admission: { enumerable: true, value: admission },
			body: { enumerable: true, get: () => providerBody() },
		});
		expect(() => lowerD774ProviderChatRequest(accessorInput as never)).toThrow(/own data/);
		const contextual = result.graphEvidence.effectRuns
			.flatMap((run) => run.facts)
			.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request" &&
					fact.request.completionContext !== undefined,
			);
		if (contextual?.kind !== "graph-effect-result-admitted")
			throw new TypeError("D774 contextual fixture is missing");
		const contextualAdmission = result.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === contextual.admissionDigest,
		)!;
		const { contextDigest: _contextDigest, ...contextMaterial } =
			contextual.request.completionContext!;
		const substitutedContextMaterial = strictSnapshot({
			...contextMaterial,
			workspaceStateDigest: empiricalStrictJsonDigest({ substituted: "workspace" }),
		});
		const substitutedContext = strictSnapshot({
			...substitutedContextMaterial,
			contextDigest: empiricalStrictJsonDigest(substitutedContextMaterial),
		});
		const { requestDigest: _requestDigest, ...requestMaterial } = contextual.request;
		const substitutedRequestMaterial = strictSnapshot({
			...requestMaterial,
			completionContext: substitutedContext,
		});
		const substitutedRequest = strictSnapshot({
			...substitutedRequestMaterial,
			requestDigest: empiricalStrictJsonDigest(substitutedRequestMaterial),
		});
		expect(() =>
			lowerD774ProviderChatRequest({
				effectRequest: substitutedRequest as never,
				admission: contextualAdmission,
				body: providerBody(),
			}),
		).toThrow(/request\/state/);
	}, 30_000);

	it("rejects proposal omission, duplicate/replay, and canonical bijection substitution", async () => {
		const result = await bundle();
		const routeFact = result.routeEvidence.facts[0]!;
		const graphFact = result.graphEvidence.effectRuns
			.flatMap((run) => run.facts)
			.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.requestDigest === routeFact.requestDigest,
			);
		if (graphFact?.kind !== "graph-effect-result-admitted")
			throw new TypeError("missing provider fact");
		expect(() =>
			createD774ProviderResultEnvelope({
				effectRequest: graphFact.request,
				routeProposal: null,
				execution: {
					result: graphFact.result,
					actualCostMicrousd: graphFact.actualCostMicrousd,
					actualElapsedMs: graphFact.actualElapsedMs,
				},
			}),
		).toThrow(/cardinality/);

		const providerFacts = result.graphEvidence.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request"
					? [fact as unknown as Readonly<Record<string, unknown>>]
					: [],
			),
		);
		const duplicatedMaterial = strictSnapshot({
			schemaVersion: result.routeEvidence.schemaVersion,
			facts: [...result.routeEvidence.facts, routeFact],
			providerResultCount: result.routeEvidence.providerResultCount,
			coverageComplete: false,
		});
		const duplicated = {
			...duplicatedMaterial,
			evidenceDigest: empiricalStrictJsonDigest(duplicatedMaterial),
		};
		expect(() => validateD774RouteEvidence(duplicated, providerFacts)).toThrow();
		const { factDigest: _factDigest, ...factMaterial } = routeFact;
		const substitutedFactMaterial = strictSnapshot({
			...factMaterial,
			reconciliationDigest: empiricalStrictJsonDigest({ substituted: "reconciliation" }),
		});
		const substitutedFact = strictSnapshot({
			...substitutedFactMaterial,
			factDigest: empiricalStrictJsonDigest(substitutedFactMaterial),
		});
		const substitutedEvidenceMaterial = strictSnapshot({
			...result.routeEvidence,
			facts: [substitutedFact, ...result.routeEvidence.facts.slice(1)],
		});
		const { evidenceDigest: _evidenceDigest, ...evidenceWithoutDigest } =
			substitutedEvidenceMaterial;
		const substitutedEvidence = strictSnapshot({
			...evidenceWithoutDigest,
			evidenceDigest: empiricalStrictJsonDigest(evidenceWithoutDigest),
		});
		expect(() =>
			validateD774RouteEvidence(
				substitutedEvidence,
				providerFacts,
				undefined,
				result.graphEvidence.ledger.effectReconciliations,
			),
		).toThrow(/usage reconciliation/);

		const proposalMaterial = strictSnapshot({
			schemaVersion: D774_ROUTE_PROPOSAL_SCHEMA,
			runSequence: routeFact.runSequence,
			effectSequence: routeFact.effectSequence,
			requestDigest: routeFact.requestDigest,
			logicalRequestDigest: routeFact.logicalRequestDigest,
			attemptOrdinal: routeFact.attemptOrdinal,
			admissionDigest: routeFact.admissionDigest,
			contextDigest: routeFact.contextDigest,
			nextRequiredPhase: routeFact.nextRequiredPhase,
			requiredDisposition: routeFact.requiredDisposition,
			requiredToolName: routeFact.requiredToolName,
			inputBodyDigest: routeFact.inputBodyDigest,
			loweredBodyDigest: routeFact.loweredBodyDigest,
			modelVisibleMessagesDigest: routeFact.modelVisibleMessagesDigest,
		});
		const proposal = Object.freeze({
			...proposalMaterial,
			proposalDigest: empiricalStrictJsonDigest(proposalMaterial),
		});
		const admission = result.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === routeFact.admissionDigest,
		)!;
		const substitutedProposalMaterial = strictSnapshot({
			...proposalMaterial,
			admissionDigest: empiricalStrictJsonDigest({ substituted: "admission" }),
		});
		const substitutedProposal = strictSnapshot({
			...substitutedProposalMaterial,
			proposalDigest: empiricalStrictJsonDigest(substitutedProposalMaterial),
		});
		const substitutedEnvelope = createD774ProviderResultEnvelope({
			effectRequest: graphFact.request,
			routeProposal: substitutedProposal,
			execution: {
				result: graphFact.result,
				actualCostMicrousd: graphFact.actualCostMicrousd,
				actualElapsedMs: graphFact.actualElapsedMs,
			},
		});
		expect(() =>
			validateD774ProviderResultEnvelope(substitutedEnvelope, graphFact.request, admission),
		).toThrow(/Graph admission/);
		const reconciliation = result.graphEvidence.ledger.effectReconciliations.find(
			(value) => value.admissionDigest === routeFact.admissionDigest,
		)!;
		const authority = createD774RouteAuthority();
		const admit = () =>
			authority.admit({
				proposal,
				request: graphFact.request,
				admission,
				result: graphFact.result,
				resultFactDigest: graphFact.factDigest,
				reconciliation,
			});
		expect(admit).not.toThrow();
		expect(admit).toThrow(/replayed/);
	}, 30_000);

	it("keeps injected evidence out of production persistence and cleans every injected atomic fault", async () => {
		const result = await bundle();
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d774-")));
		await chmod(root, 0o700);
		try {
			await expect(
				persistD774QualificationBundle({ privateRoot: root, bundle: result }),
			).rejects.toThrow(/rejects injected baseline/);
			for (const stage of ["after-claim", "after-write", "after-rename", "after-marker"] as const) {
				await expect(
					persistD774InjectedBundleForTest({ privateRoot: root, bundle: result }, stage),
				).rejects.toThrow(/injected/);
				expect(await readdir(root)).toEqual([]);
			}
			const receipt = await persistD774InjectedBundleForTest({ privateRoot: root, bundle: result });
			expect(receipt.baselineBasis).toBe("injected-test");
			expect((await lstat(join(root, receipt.generationRef))).mode & 0o777).toBe(0o700);
			expect(
				(await lstat(join(root, receipt.generationRef, "artifacts", "bundle.v1.json"))).mode &
					0o777,
			).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
