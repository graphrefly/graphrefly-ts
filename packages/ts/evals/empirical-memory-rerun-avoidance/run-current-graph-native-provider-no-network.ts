import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	persistCurrentGraphProviderQualificationBundle,
	readCurrentGraphProviderD1Baseline,
	runCurrentGraphProviderNoNetworkQualification,
} from "./current-graph-native-provider-qualification.js";

const D1_BUNDLE_PATH = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d1/current-graph-native-no-network-qualification-2026-08-14-v1/artifacts/bundle.v1.json",
);

export async function runCurrentGraphProviderPrivateQualification(privateRootValue: string) {
	const privateRoot = resolve(privateRootValue);
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	let networkCalls = 0;
	const transportKey = ["fe", "tch"].join("");
	const globals = globalThis as unknown as Record<string, unknown>;
	const originalTransport = globals[transportKey];
	globals[transportKey] = async () => {
		networkCalls += 1;
		throw new TypeError("current provider no-network sentinel");
	};
	try {
		const d1Baseline = await readCurrentGraphProviderD1Baseline(D1_BUNDLE_PATH);
		const bundle = await runCurrentGraphProviderNoNetworkQualification({ d1Baseline });
		if (networkCalls !== 0) throw new TypeError("current provider qualification attempted network");
		const receipt = await persistCurrentGraphProviderQualificationBundle({ privateRoot, bundle });
		return Object.freeze({ networkCalls, receipt });
	} finally {
		globals[transportKey] = originalTransport;
	}
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
	const privateRoot = process.argv[2];
	if (privateRoot === undefined)
		throw new TypeError("current provider private root argument is required");
	const result = await runCurrentGraphProviderPrivateQualification(privateRoot);
	process.stdout.write(
		`${JSON.stringify({
			networkCalls: result.networkCalls,
			generationRef: result.receipt.generationRef,
			bundleDigest: result.receipt.bundleDigest,
			bundleArtifactDigest: result.receipt.bundleArtifactDigest,
			receiptDigest: result.receipt.receiptDigest,
		})}\n`,
	);
}
