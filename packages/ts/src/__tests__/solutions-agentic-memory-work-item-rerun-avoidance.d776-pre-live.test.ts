import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D776_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD776Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d776-implementation-manifest.js";
import {
	createD776InjectedBaselineForTest,
	persistD776InjectedBundleForTest,
	persistD776QualificationBundle,
	runD776InjectedNoNetworkQualification,
	validateD776QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d776-pre-live-qualification.js";
import {
	createD776ProviderResultEnvelope,
	createD776RouteAuthority,
	D776_ROUTE_PROPOSAL_SCHEMA,
	lowerD776ProviderChatRequest,
	validateD776ProviderResultEnvelope,
	validateD776RouteEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d776-provider-result-route-authority.js";

let qualificationPromise: ReturnType<typeof runD776InjectedNoNetworkQualification> | undefined;

async function bundle() {
	qualificationPromise ??= runD776InjectedNoNetworkQualification(
		createD776InjectedBaselineForTest(),
	);
	return structuredClone(await qualificationPromise);
}

function providerBodyWithTools(toolNames: readonly string[]): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			model: "deepseek/deepseek-v3.1-terminus",
			messages: [{ role: "user", content: "bounded D776 fixture" }],
			tools: toolNames.map((name) => ({
				type: "function",
				function: { name, parameters: {} },
			})),
			tool_choice: "required",
			provider: { order: ["DeepInfra"], allow_fallbacks: false },
			reasoning: { effort: "high" },
			stream: false,
		}),
	);
}

function providerBody(): Uint8Array {
	return providerBodyWithTools([
		"read_file",
		"replace_exact",
		"workspace_diff",
		"focused_validation",
	]);
}

describe("D776 provider envelope and phase lowering pre-live", () => {
	it("freezes the exact decision-bearing implementation closure", async () => {
		expect(await measureD776Implementation()).toBe(D776_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("qualifies all six arms with exact route bijection and unchanged retry identity", async () => {
		const result = await bundle();
		const validated = validateD776QualificationBundle(structuredClone(result));
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
			"inspection",
			"exact-mutation",
			"workspace-diff",
			"focused-validation",
			"hidden-verifier",
		] as const)
			expect(validated.routeEvidence.facts.some((fact) => fact.nextRequiredPhase === phase)).toBe(
				true,
			);
		const retried = validated.routeEvidence.facts.filter((fact) => fact.attemptOrdinal === 2);
		expect(retried).toHaveLength(6);
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
				throw new TypeError("D776 test fixture lacks Graph coordinates");
			const lowered = lowerD776ProviderChatRequest({
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
		expect(() => lowerD776ProviderChatRequest(accessorInput as never)).toThrow(/own data/);
		const contextual = result.graphEvidence.effectRuns
			.flatMap((run) => run.facts)
			.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request" &&
					fact.request.completionContext?.nextRequiredPhase === "inspection",
			);
		if (contextual?.kind !== "graph-effect-result-admitted")
			throw new TypeError("D776 contextual fixture is missing");
		const contextualAdmission = result.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === contextual.admissionDigest,
		)!;
		expect(() =>
			lowerD776ProviderChatRequest({
				effectRequest: contextual.request,
				admission: contextualAdmission,
				body: providerBodyWithTools(["replace_exact", "workspace_diff", "focused_validation"]),
			}),
		).toThrow(/uniquely available/);
		expect(() =>
			lowerD776ProviderChatRequest({
				effectRequest: contextual.request,
				admission: contextualAdmission,
				body: providerBodyWithTools([
					"read_file",
					"read_file",
					"replace_exact",
					"workspace_diff",
					"focused_validation",
				]),
			}),
		).toThrow(/uniquely available/);
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
			lowerD776ProviderChatRequest({
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
			createD776ProviderResultEnvelope({
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
		expect(() => validateD776RouteEvidence(duplicated, providerFacts)).toThrow();
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
			validateD776RouteEvidence(
				substitutedEvidence,
				providerFacts,
				undefined,
				result.graphEvidence.ledger.effectReconciliations,
			),
		).toThrow(/usage reconciliation/);

		const proposalMaterial = strictSnapshot({
			schemaVersion: D776_ROUTE_PROPOSAL_SCHEMA,
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
		const substitutedEnvelope = createD776ProviderResultEnvelope({
			effectRequest: graphFact.request,
			routeProposal: substitutedProposal,
			execution: {
				result: graphFact.result,
				actualCostMicrousd: graphFact.actualCostMicrousd,
				actualElapsedMs: graphFact.actualElapsedMs,
			},
		});
		expect(() =>
			validateD776ProviderResultEnvelope(substitutedEnvelope, graphFact.request, admission),
		).toThrow(/Graph admission/);
		const reconciliation = result.graphEvidence.ledger.effectReconciliations.find(
			(value) => value.admissionDigest === routeFact.admissionDigest,
		)!;
		const authority = createD776RouteAuthority();
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
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d776-")));
		await chmod(root, 0o700);
		try {
			await expect(
				persistD776QualificationBundle({ privateRoot: root, bundle: result }),
			).rejects.toThrow(/rejects injected baseline/);
			for (const stage of ["after-claim", "after-write", "after-rename", "after-marker"] as const) {
				await expect(
					persistD776InjectedBundleForTest({ privateRoot: root, bundle: result }, stage),
				).rejects.toThrow(/injected/);
				expect(await readdir(root)).toEqual([]);
			}
			const receipt = await persistD776InjectedBundleForTest({ privateRoot: root, bundle: result });
			expect(receipt.baselineBasis).toBe("injected-test");
			expect((await lstat(join(root, receipt.generationRef))).mode & 0o777).toBe(0o700);
			expect(
				(await lstat(join(root, receipt.generationRef, "artifacts", "bundle.v1.json"))).mode &
					0o777,
			).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 60_000);
});
