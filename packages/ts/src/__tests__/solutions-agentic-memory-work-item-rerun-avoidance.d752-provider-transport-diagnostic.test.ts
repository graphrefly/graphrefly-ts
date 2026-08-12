import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalSha256 } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { runD751InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d751-sanitized-transport-diagnostic.js";
import {
	type D752_IMPLEMENTATION_SOURCE_SHA256,
	validateD752ImplementationBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d752-implementation-manifest.js";
import {
	createD752PersistenceFault,
	D752_D751_BASELINE,
	D752_GENERATION_REF,
	persistD752PrivateGeneration,
	runD752InjectedNoNetworkQualification,
	validateD752Bundle,
} from "../../evals/empirical-memory-rerun-avoidance/d752-provider-transport-diagnostic-integration.js";
import { strictJsonCodec } from "../json/codec.js";

const roots: string[] = [];
let baselinePromise: Promise<Uint8Array> | null = null;

async function baseline(): Promise<Uint8Array> {
	baselinePromise ??= runD751InjectedNoNetworkQualification().then((value) =>
		strictJsonCodec.encode(value),
	);
	return new Uint8Array(await baselinePromise);
}

async function bundle() {
	return runD752InjectedNoNetworkQualification({ d751QualificationBytes: await baseline() });
}

async function privateRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-d752-"));
	await chmod(root, 0o700);
	const canonical = await realpath(root);
	roots.push(canonical);
	return canonical;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("D752 provider transport diagnostic integration", () => {
	it("runs two complete serial six-arm blocks and admits only terminal transport diagnostics", async () => {
		const d751Bytes = await baseline();
		expect(empiricalSha256(d751Bytes)).toBe(D752_D751_BASELINE.qualificationArtifactSha256);
		const bundle = await runD752InjectedNoNetworkQualification({
			d751QualificationBytes: d751Bytes,
		});
		expect(validateD752Bundle(bundle)).toEqual(bundle);
		expect(bundle.qualification.graphEvidence).toHaveLength(2);
		expect(
			bundle.qualification.graphEvidence.map((graph) => graph.ledger.completedArms.length),
		).toEqual([6, 6]);
		expect(bundle.qualification.retryWaitCount).toBe(3);
		expect({
			retry: bundle.qualification.retryDiagnosticProposalCount,
			terminal: bundle.qualification.terminalDiagnosticProposalCount,
			causes: bundle.qualification.transportGraphEvidence.facts.map((fact) => fact.causeCode),
		}).toEqual({ retry: 0, terminal: 2, causes: ["econnreset", "enotfound"] });
		expect(
			bundle.qualification.transportGraphEvidence.facts.map((fact) => fact.causeCode).sort(),
		).toEqual(["econnreset", "enotfound"]);
		expect(bundle.qualification.graphNonTransportFailureResultCount).toBe(1);
		expect(bundle.qualification.graphTransportFailureResultCount).toBe(2);
		expect(bundle.qualification.graphProviderResultCount).toBe(
			bundle.qualification.graphRouteResultCount +
				bundle.qualification.graphTransportFailureResultCount +
				bundle.qualification.graphNonTransportFailureResultCount,
		);
		expect(bundle.qualification.networkCallCount).toBe(0);
		expect(bundle.qualification.maxActiveEffects).toBe(1);
		const encoded = Buffer.from(strictJsonCodec.encode(bundle)).toString("utf8");
		expect(encoded).not.toMatch(/OPENROUTER_API_KEY|authorization|bearerToken|rawBody|rawHeader/);
		expect(encoded).not.toMatch(/UND_ERR_|ECONNRESET|ENOTFOUND|ordinary executor failure/);
	}, 30_000);

	it("rejects accessor, canonical, route-binding, and implementation substitutions", async () => {
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "d751QualificationBytes", {
			enumerable: true,
			get() {
				getterHits += 1;
				return new Uint8Array();
			},
		});
		await expect(runD752InjectedNoNetworkQualification(accessor as never)).rejects.toThrow();
		expect(getterHits).toBe(0);
		const tamperedBaseline = await baseline();
		tamperedBaseline[tamperedBaseline.length - 1] ^= 1;
		await expect(
			runD752InjectedNoNetworkQualification({ d751QualificationBytes: tamperedBaseline }),
		).rejects.toThrow(/d751Artifact|D751|qualification/);

		const valid = await bundle();
		const substituted = structuredClone(valid) as unknown as Record<string, unknown>;
		const qualification = substituted.qualification as Record<string, unknown>;
		const routes = qualification.routeEvidence as Record<string, unknown>[];
		routes.reverse();
		expect(() => validateD752Bundle(substituted)).toThrow(/route|source|digest|coverage/);

		const names: Record<keyof typeof D752_IMPLEMENTATION_SOURCE_SHA256, string> = {
			integration: "d752-provider-transport-diagnostic-integration.ts",
			privateRunner: "run-d752-no-network-pre-live.ts",
			d751Authority: "d751-sanitized-transport-diagnostic.ts",
			d751Manifest: "d751-implementation-manifest.ts",
			d734RouteIntegration: "d734-route-profile-provider-integration.ts",
			d729ProviderCore: "d729-provider-block-core.ts",
			transportBoundary: "openrouter-transport-failure.ts",
		};
		const measured = Object.fromEntries(
			await Promise.all(
				(Object.entries(names) as [keyof typeof names, string][]).map(async ([key, name]) => [
					key,
					new Uint8Array(
						await readFile(
							new URL(`../../evals/empirical-memory-rerun-avoidance/${name}`, import.meta.url),
						),
					),
				]),
			),
		) as Record<keyof typeof names, Uint8Array>;
		expect(validateD752ImplementationBytes(measured)).toMatch(/^sha256:[0-9a-f]{64}$/);
		const drifted = { ...measured, integration: new Uint8Array(measured.integration) };
		drifted.integration[0] ^= 1;
		expect(() => validateD752ImplementationBytes(drifted)).toThrow(/integration/);
	}, 30_000);

	it("persists one exclusive 0700/0600 canonical generation and rejects bundle replay", async () => {
		const root = await privateRoot();
		const value = await bundle();
		const clone = strictJsonCodec.decode(strictJsonCodec.encode(value));
		expect(validateD752Bundle(clone)).toEqual(value);
		await expect(
			persistD752PrivateGeneration({ privateRoot: root, bundle: clone as typeof value }),
		).rejects.toThrow(/same-process/);
		const receipt = await persistD752PrivateGeneration({ privateRoot: root, bundle: value });
		expect(receipt.generationPath).toBe(join(root, D752_GENERATION_REF));
		expect((await readdir(receipt.generationPath)).sort()).toEqual(["artifacts", "commit.v1.json"]);
		for (const name of await readdir(join(receipt.generationPath, "artifacts"))) {
			const status = await lstat(join(receipt.generationPath, "artifacts", name));
			expect(status.mode & 0o777).toBe(0o600);
		}
		const second = await bundle();
		await expect(
			persistD752PrivateGeneration({ privateRoot: root, bundle: second }),
		).rejects.toThrow();
		expect(await readdir(root)).toEqual([D752_GENERATION_REF]);
	}, 45_000);

	it("removes exact owned state after every persistence fault", async () => {
		for (const stage of [
			"after-staging",
			"after-commit",
			"after-rename",
			"after-final-sync",
		] as const) {
			const root = await privateRoot();
			await expect(
				persistD752PrivateGeneration({
					privateRoot: root,
					bundle: await bundle(),
					fault: createD752PersistenceFault(stage),
				}),
			).rejects.toThrow(new RegExp(`injected ${stage} failure`));
			expect(await readdir(root)).toEqual([]);
		}
	}, 90_000);
});
