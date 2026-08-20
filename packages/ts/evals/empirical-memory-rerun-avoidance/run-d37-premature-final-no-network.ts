import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { empiricalSha256 } from "./canonical.js";
import {
	D37_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD37Implementation,
} from "./d37-premature-final-implementation-manifest.js";
import {
	admitD37D36Baseline,
	D37_D36_BASELINE,
	persistD37Qualification,
	runD37InjectedNoNetworkQualification,
} from "./d37-premature-final-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d37",
);
const baselinePath = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d36/current-graph-native-retained-span-live-2026-08-20-d36-v1/artifacts/bundle.v1.json",
);

export async function main() {
	if ((await measureD37Implementation(repositoryRoot)) !== D37_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D37 implementation manifest drifted");
	const baselineBytes = new Uint8Array(await readFile(baselinePath));
	if (empiricalSha256(baselineBytes) !== D37_D36_BASELINE.artifactDigest)
		throw new TypeError("D37 private D36 baseline drifted");
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d37-run-"));
	try {
		const bundle = await runD37InjectedNoNetworkQualification({
			baseline: admitD37D36Baseline(baselineBytes),
			repositoryRoot,
			materializationRoot,
		});
		const receipt = await persistD37Qualification({
			privateRoot: await realpath(privateRoot),
			bundle,
		});
		process.stdout.write(
			`${JSON.stringify({
				disposition: "qualified-no-network",
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
				implementationManifestDigest: D37_IMPLEMENTATION_MANIFEST_DIGEST,
				providerTransportCalls: bundle.qualification.providerTransportCalls,
				prematureFinalFactCount: bundle.qualification.prematureFinalFactCount,
				providerNetworkCalls: 0,
				persistenceDigest: receipt.receiptDigest,
				efficacyClaim: bundle.qualification.efficacyClaim,
			})}\n`,
		);
	} finally {
		await rm(materializationRoot, { recursive: true, force: true });
		await rm(`${materializationRoot}-second-final`, { recursive: true, force: true });
		await rm(`${materializationRoot}-headroom`, { recursive: true, force: true });
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
