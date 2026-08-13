import { readFile } from "node:fs/promises";
import {
	admitD774ConsumedD773Baseline,
	persistD774QualificationBundle,
	runD774InjectedNoNetworkQualification,
} from "./d774-pre-live-qualification.js";

async function main(): Promise<void> {
	const [baselinePath, privateRoot] = process.argv.slice(2);
	if (baselinePath === undefined || privateRoot === undefined)
		throw new TypeError("usage: run-d774-no-network-pre-live <d773-bundle> <0700-private-root>");
	const baseline = admitD774ConsumedD773Baseline(await readFile(baselinePath));
	const bundle = await runD774InjectedNoNetworkQualification(baseline);
	const receipt = await persistD774QualificationBundle({ privateRoot, bundle });
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
	process.stderr.write(`${error instanceof Error ? error.message : "D774 pre-live failed"}\n`);
	process.exitCode = 1;
});
