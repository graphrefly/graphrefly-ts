import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	persistCurrentGraphQualificationBundle,
	runCurrentGraphNativeNoNetworkQualification,
} from "./current-graph-native-eval-qualification.js";

export async function runCurrentGraphNativePrivateQualification(privateRootValue: string) {
	const privateRoot = resolve(privateRootValue);
	let networkCalls = 0;
	const transportKey = ["fe", "tch"].join("");
	const globals = globalThis as unknown as Record<string, unknown>;
	const originalTransport = globals[transportKey];
	globals[transportKey] = async () => {
		networkCalls += 1;
		throw new TypeError("current Graph no-network sentinel");
	};
	try {
		const bundle = await runCurrentGraphNativeNoNetworkQualification();
		const receipt = await persistCurrentGraphQualificationBundle({ privateRoot, bundle });
		if (networkCalls !== 0) throw new TypeError("current Graph qualification attempted network");
		return Object.freeze({ networkCalls, receipt });
	} finally {
		globals[transportKey] = originalTransport;
	}
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
	const privateRoot = process.argv[2];
	if (privateRoot === undefined)
		throw new TypeError("current Graph private root argument is required");
	const result = await runCurrentGraphNativePrivateQualification(privateRoot);
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
