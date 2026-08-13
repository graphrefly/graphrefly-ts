import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	admitD767ConsumedD766Baseline,
	persistD767QualificationBundle,
	runD767InjectedNoNetworkQualification,
} from "./d767-retry-exhaustion-qualification.js";

const here = dirname(fileURLToPath(import.meta.url));
const privateRoot = resolve(here, "../.private/empirical-memory-rerun-avoidance/.d767-private");
const baselinePath = resolve(
	here,
	"../.private/empirical-memory-rerun-avoidance/.d766-live-private/d766-public-semantic-live-2026-08-13-v1/artifacts/bundle.v1.json",
);

async function main(): Promise<void> {
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	const baseline = admitD767ConsumedD766Baseline(await readFile(baselinePath));
	const bundle = await runD767InjectedNoNetworkQualification(baseline);
	const receipt = await persistD767QualificationBundle({ privateRoot, bundle });
	process.stdout.write(
		`${JSON.stringify({
			status: "qualified",
			bundleDigest: bundle.bundleDigest,
			graphEvidenceDigest: bundle.graphEvidence.evidenceDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			persistenceDigest: receipt.persistenceDigest,
			providerRequestCount: bundle.qualification.providerRequestCount,
			retryWaitCount: bundle.qualification.retryWaitCount,
			exhaustedRunCount: bundle.qualification.exhaustedRunCount,
			networkCalls: bundle.qualification.networkCalls,
		})}\n`,
	);
}

await main();
