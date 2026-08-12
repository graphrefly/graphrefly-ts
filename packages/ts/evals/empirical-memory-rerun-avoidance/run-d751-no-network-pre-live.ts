import { chmod, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	persistD751PrivateGeneration,
	runD751InjectedNoNetworkQualification,
} from "./d751-sanitized-transport-diagnostic.js";

const here = dirname(fileURLToPath(import.meta.url));
const privateRoot = join(here, "../.private/empirical-memory-rerun-avoidance/.d751-private");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);

const qualification = await runD751InjectedNoNetworkQualification();
const persistence = await persistD751PrivateGeneration({
	privateRoot: await realpath(privateRoot),
	qualification,
});

process.stdout.write(
	`${JSON.stringify({
		status: "qualified",
		qualificationDigest: persistence.qualificationDigest,
		generationDigest: persistence.generationDigest,
		transportDiagnosticFacts: qualification.transportGraphEvidence.facts.length,
		providerTransportCalls: qualification.providerTransportCallCount,
		networkCalls: qualification.networkCallCount,
		retryWaits: qualification.retryWaitCount,
	})}\n`,
);
