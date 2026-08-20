import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	D35_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD35Implementation,
} from "./d35-retained-span-implementation-manifest.js";
import {
	admitD35D34Baseline,
	persistD35Qualification,
	runD35InjectedNoNetworkQualification,
	validateD35QualificationBundle,
} from "./d35-retained-span-real-provider-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d35",
);
const d34ArtifactPath = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d34/current-graph-native-retained-span-no-network-2026-08-20-d34-v2/artifacts/bundle.v1.json",
);

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D35 no-network runner refuses provider credentials");
if (resolve(process.cwd()) !== repositoryRoot)
	throw new TypeError("D35 no-network runner must execute from the repository root");

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const materializationRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d35-")));
try {
	if ((await measureD35Implementation(repositoryRoot)) !== D35_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D35 implementation manifest drifted");
	const baseline = admitD35D34Baseline(new Uint8Array(await readFile(d34ArtifactPath)));
	const constructedBundle = await runD35InjectedNoNetworkQualification({
		baseline,
		repositoryRoot,
		materializationRoot,
	});
	const bundle = validateD35QualificationBundle(constructedBundle);
	const receipt = await persistD35Qualification({ privateRoot, bundle: constructedBundle });
	process.stdout.write(
		`${JSON.stringify(
			{
				decisionRef: bundle.qualification.decisionRef,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
				evidenceDigest: bundle.evidence.evidenceDigest,
				providerNetworkCalls: bundle.qualification.providerNetworkCalls,
				injectedTransportCalls: bundle.qualification.injectedTransportCalls,
				retainedSpanTransportCalls: bundle.qualification.retainedSpanTransportCalls,
				retryWaitCount: bundle.qualification.retryWaitCount,
				efficacyClaim: bundle.qualification.efficacyClaim,
				receipt,
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
