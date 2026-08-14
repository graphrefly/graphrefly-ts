import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	admitD778ConsumedD777Baseline,
	persistD778QualificationBundle,
	runD778InjectedNoNetworkQualification,
} from "./d778-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const artifactPath = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/.d777-live-private/d777-provider-envelope-live-2026-08-13-v1/artifacts/bundle.v1.json",
);
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/.d778-pre-live-private",
);

async function main(): Promise<void> {
	const baseline = admitD778ConsumedD777Baseline(new Uint8Array(await readFile(artifactPath)));
	const bundle = await runD778InjectedNoNetworkQualification(baseline);
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	const persistence = await persistD778QualificationBundle({ privateRoot, bundle });
	process.stdout.write(
		`${JSON.stringify({
			status: "qualified",
			completedArms: bundle.qualification.completedArms,
			taskExposureFactCount: bundle.taskExposureFacts.length,
			toolRejectionFactCount: bundle.toolRejectionFacts.length,
			bundleDigest: bundle.bundleDigest,
			generationDigest: bundle.generation.generationDigest,
			persistenceDigest: persistence.persistenceDigest,
			credentialReads: 0,
			networkCalls: 0,
		})}\n`,
	);
}

await main();
