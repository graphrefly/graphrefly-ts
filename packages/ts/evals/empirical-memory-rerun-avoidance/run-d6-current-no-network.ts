import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation,
} from "./d6-current-implementation-manifest.js";
import { CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST } from "./d6-current-live-coordinates.js";
import {
	persistCurrentGraphLiveQualification,
	runCurrentGraphLiveNoNetworkQualification,
} from "./d6-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d6",
);
const d5QualificationBundlePath = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/d5-inspection-batch/d5-inspection-batch-no-network-qualification-2026-08-14-v3/artifacts/bundle.v1.json",
);

const measured = await measureCurrentGraphLiveImplementation(repositoryRoot);
if (measured !== CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("current live no-network implementation manifest drifted");
const d5QualificationBundleBytes = new Uint8Array(await readFile(d5QualificationBundlePath));
const bundle = await runCurrentGraphLiveNoNetworkQualification({
	repositoryRoot,
	d5QualificationBundleBytes,
	implementationManifestDigest: measured,
});
const injectedProviderAttempts = bundle.qualification.providerAttempts;
const receipt = await persistCurrentGraphLiveQualification({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		executionClass: "injected-no-network",
		realProviderCalls: 0,
		networkCalls: 0,
		injectedProviderAttempts,
		d5QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
		implementationManifestDigest: measured,
		receipt,
	})}\n`,
);
