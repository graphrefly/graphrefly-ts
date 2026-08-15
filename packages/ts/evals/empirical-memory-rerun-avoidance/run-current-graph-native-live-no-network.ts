import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CURRENT_GRAPH_LIVE_D3_QUALIFICATION_ARTIFACT_DIGEST } from "./current-graph-native-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation,
} from "./current-graph-native-live-implementation-manifest.js";
import {
	persistCurrentGraphLiveQualification,
	runCurrentGraphLiveNoNetworkQualification,
} from "./current-graph-native-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d4",
);
const d3QualificationBundlePath = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d3/current-graph-native-live-no-network-qualification-2026-08-14-v4/artifacts/bundle.v1.json",
);

const measured = await measureCurrentGraphLiveImplementation(repositoryRoot);
if (measured !== CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("current live no-network implementation manifest drifted");
const d3QualificationBundleBytes = new Uint8Array(await readFile(d3QualificationBundlePath));
const bundle = await runCurrentGraphLiveNoNetworkQualification({
	repositoryRoot,
	d3QualificationBundleBytes,
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
		d3QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D3_QUALIFICATION_ARTIFACT_DIGEST,
		implementationManifestDigest: measured,
		receipt,
	})}\n`,
);
