import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD726ExecutorFailureProviderTurn } from "../../evals/empirical-memory-rerun-avoidance/d729-provider-block-core.js";
import {
	createD751PersistenceFault,
	createD751SanitizedExecutorFailureProviderTurn,
	D751_GENERATION_REF,
	executeD751SanitizedTransportBoundary,
	persistD751PrivateGeneration,
	runD751InjectedNoNetworkQualification,
	validateD751Qualification,
	validateD751SanitizedTransportDiagnostic,
} from "../../evals/empirical-memory-rerun-avoidance/d751-sanitized-transport-diagnostic.js";
import { OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA } from "../../evals/empirical-memory-rerun-avoidance/openrouter-transport-failure.js";
import { strictJsonCodec } from "../json/codec.js";

const roots: string[] = [];

async function privateRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-d751-"));
	await chmod(root, 0o700);
	const canonical = await realpath(root);
	roots.push(canonical);
	return canonical;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("D751 Graph-admitted sanitized transport diagnostics", () => {
	it("passes successful turns through unchanged and does not relabel non-transport failures", async () => {
		const turn = createD726ExecutorFailureProviderTurn({
			classification: "response-decode-failure",
			evidenceDigest: empiricalStrictJsonDigest({ test: "d751-success-turn" }),
		});
		const passed = await executeD751SanitizedTransportBoundary(
			async () => turn,
			empiricalStrictJsonDigest({ request: "d751-success" }),
		);
		expect(passed).toEqual({ turn, proposal: null });

		const ordinary = new TypeError("ordinary executor failure");
		await expect(
			executeD751SanitizedTransportBoundary(
				async () => {
					throw ordinary;
				},
				empiricalStrictJsonDigest({ request: "d751-nontransport" }),
			),
		).rejects.toBe(ordinary);
		expect(createD751SanitizedExecutorFailureProviderTurn).toBeTypeOf("function");
	});
	it("qualifies every frozen transport cause without retry, provider transport, or network calls", async () => {
		const qualification = await runD751InjectedNoNetworkQualification();
		expect(validateD751Qualification(qualification)).toEqual(qualification);
		expect(qualification.transportGraphEvidence.facts).toHaveLength(10);
		expect(qualification.simulatedProviderEffectCount).toBe(10);
		expect(qualification.providerTransportCallCount).toBe(0);
		expect(qualification.networkCallCount).toBe(0);
		expect(qualification.retryWaitCount).toBe(0);
		expect(
			new Set(qualification.transportGraphEvidence.facts.map((fact) => fact.causeCode)),
		).toEqual(
			new Set([
				"abort-err",
				"econnreset",
				"enotfound",
				"und-err-body-timeout",
				"und-err-connect-timeout",
				"und-err-headers-timeout",
				"unrecognized",
			]),
		);
		for (const fact of qualification.transportGraphEvidence.facts) {
			expect(fact.effectRequestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(fact.effectAdmissionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(fact.providerResultDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(fact.reconciliationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
		const encoded = Buffer.from(strictJsonCodec.encode(qualification)).toString("utf8");
		expect(encoded).not.toMatch(/OpenRouter byte transport failed|UND_ERR_|ECONNRESET|ENOTFOUND/);
		expect(encoded).not.toMatch(
			/authorizationBearer|rawBody|"message"|"stack"|"headers"|OPENROUTER_API_KEY/,
		);
	}, 30_000);

	it("rejects accessor diagnostics without invoking the getter and rejects canonical substitution", async () => {
		let getterHits = 0;
		const accessor = Object.defineProperties(
			{},
			{
				schemaVersion: {
					enumerable: true,
					value: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
				},
				phase: {
					enumerable: true,
					get() {
						getterHits += 1;
						return "request";
					},
				},
				causeCode: { enumerable: true, value: "econnreset" },
			},
		);
		expect(() => validateD751SanitizedTransportDiagnostic(accessor)).toThrow();
		expect(getterHits).toBe(0);

		const qualification = await runD751InjectedNoNetworkQualification();
		const substituted = structuredClone(qualification) as unknown as Record<string, unknown>;
		const graphEvidence = substituted.transportGraphEvidence as Record<string, unknown>;
		const facts = graphEvidence.facts as Record<string, unknown>[];
		facts[0] = { ...facts[0], phase: "response-body" };
		expect(() => validateD751Qualification(substituted)).toThrow(/transport|digest|binding/);

		const replayed = structuredClone(qualification) as unknown as Record<string, unknown>;
		const replayedGraph = replayed.transportGraphEvidence as Record<string, unknown>;
		const replayedFacts = replayedGraph.facts as Record<string, unknown>[];
		replayedFacts.push(structuredClone(replayedFacts[0]!));
		expect(() => validateD751Qualification(replayed)).toThrow(/duplicated|coverage|digest/);
	});

	it("persists canonical evidence atomically, rejects replay, and keeps exact 0600 artifacts", async () => {
		const root = await privateRoot();
		const qualification = await runD751InjectedNoNetworkQualification();
		const clone = strictJsonCodec.decode(strictJsonCodec.encode(qualification));
		expect(validateD751Qualification(clone)).toEqual(qualification);
		await expect(
			persistD751PrivateGeneration({
				privateRoot: root,
				qualification: clone as typeof qualification,
			}),
		).rejects.toThrow(/same-process/);

		const receipt = await persistD751PrivateGeneration({ privateRoot: root, qualification });
		expect(receipt.generationPath).toBe(join(root, D751_GENERATION_REF));
		const names = await readdir(receipt.generationPath);
		expect(names.sort()).toEqual(["artifacts", "commit.v1.json"]);
		const artifactNames = await readdir(join(receipt.generationPath, "artifacts"));
		expect(artifactNames.sort()).toEqual(["generation.v1.json", "qualification.v1.json"]);
		for (const name of artifactNames) {
			const status = await lstat(join(receipt.generationPath, "artifacts", name));
			expect(status.mode & 0o777).toBe(0o600);
		}
		const persisted = strictJsonCodec.decode(
			new Uint8Array(
				await readFile(join(receipt.generationPath, "artifacts", "qualification.v1.json")),
			),
		);
		expect(validateD751Qualification(persisted).qualificationDigest).toBe(
			receipt.qualificationDigest,
		);

		const second = await runD751InjectedNoNetworkQualification();
		await expect(
			persistD751PrivateGeneration({ privateRoot: root, qualification: second }),
		).rejects.toThrow();
		expect(await readdir(root)).toEqual([D751_GENERATION_REF]);
	}, 30_000);

	it("removes exact owned state after every injected persistence failure", async () => {
		for (const stage of [
			"after-staging",
			"after-commit",
			"after-rename",
			"after-final-sync",
		] as const) {
			const root = await privateRoot();
			const qualification = await runD751InjectedNoNetworkQualification();
			await expect(
				persistD751PrivateGeneration({
					privateRoot: root,
					qualification,
					fault: createD751PersistenceFault(stage),
				}),
			).rejects.toThrow(new RegExp(`injected ${stage} failure`));
			expect(await readdir(root)).toEqual([]);
		}
	}, 30_000);
});
