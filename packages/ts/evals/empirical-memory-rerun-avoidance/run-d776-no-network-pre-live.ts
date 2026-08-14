import { readFile } from "node:fs/promises";
import {
	admitD776ConsumedD775Baseline,
	persistD776QualificationBundle,
	runD776InjectedNoNetworkQualification,
} from "./d776-pre-live-qualification.js";

async function main(): Promise<void> {
	const [baselinePath, privateRoot] = process.argv.slice(2);
	if (baselinePath === undefined || privateRoot === undefined)
		throw new TypeError("usage: run-d776-no-network-pre-live <d775-bundle> <0700-private-root>");
	const baseline = admitD776ConsumedD775Baseline(await readFile(baselinePath));
	const bundle = await runD776InjectedNoNetworkQualification(baseline);
	const receipt = await persistD776QualificationBundle({ privateRoot, bundle });
	process.stdout.write(
		`${JSON.stringify({
			generationRef: receipt.generationRef,
			bundleDigest: receipt.bundleDigest,
			persistenceDigest: receipt.persistenceDigest,
			completedArms: bundle.qualification.completedArms,
			providerCalls: bundle.qualification.providerCalls,
			routeFacts: bundle.routeEvidence.facts.length,
			credentialReads: 0,
			networkCalls: 0,
		})}\n`,
	);
}

void main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : "D776 pre-live failed"}\n`);
	process.exitCode = 1;
});
