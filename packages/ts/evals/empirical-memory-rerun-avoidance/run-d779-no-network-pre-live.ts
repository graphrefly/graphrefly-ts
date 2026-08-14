import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	admitD779ConsumedD778Baseline,
	persistD779QualificationBundle,
	runD779InjectedNoNetworkQualification,
} from "./d779-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const artifactPath = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/.d778-pre-live-private/d778-complete-task-tool-diagnostics-2026-08-13-v1/artifacts/bundle.v1.json",
);
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/.d779-pre-live-private",
);

async function main(): Promise<void> {
	const baseline = admitD779ConsumedD778Baseline(new Uint8Array(await readFile(artifactPath)));
	const bundle = await runD779InjectedNoNetworkQualification(baseline);
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	const persistence = await persistD779QualificationBundle({ privateRoot, bundle });
	process.stdout.write(
		`${JSON.stringify({
			status: "qualified",
			completedArms: bundle.qualification.completedArms,
			taskExposureFactCount: bundle.taskExposureFacts.length,
			toolRejectionFactCount: bundle.toolRejectionFacts.length,
			diagnosticToolRejectionFactCount: bundle.diagnosticToolRejectionFacts.length,
			bundleDigest: bundle.bundleDigest,
			generationDigest: bundle.generation.generationDigest,
			persistenceDigest: persistence.persistenceDigest,
			credentialReads: 0,
			networkCalls: 0,
		})}\n`,
	);
}

await main();
