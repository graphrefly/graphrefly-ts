import { join, resolve } from "node:path";
import { empiricalStrictJsonDigest } from "./canonical.js";
import { checkRootEvalGeneratedArtifacts } from "./generate-root-eval-artifacts.js";
import {
	assertCurrentImplementationRuntime,
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import { ROOT_EVAL_LIVE_DECISION_REF } from "./root-eval-live.js";
import {
	qualifyRootEvalLivePrivateInputs,
	ROOT_EVAL_LIVE_GENERATION_REF,
} from "./root-eval-live-authority.js";

const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const credentialPath = resolve(
	process.env.GRAPHREFLY_EVAL_CREDENTIAL_PATH ??
		join(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
);
const zeroByokPath = resolve(
	process.env.GRAPHREFLY_EVAL_ZERO_BYOK_PATH ?? join(operatorRoot, "fresh-zero-byok-d125.v12.json"),
);
export const ROOT_EVAL_PRIVATE_INPUT_EXECUTION_APPROVAL = "graphrefly-ts:D125" as const;

async function main(executionApproval: string | null): Promise<void> {
	if (executionApproval === null)
		throw new TypeError("root eval has no current private-input or live execution approval");
	assertCurrentImplementationRuntime();
	if ((await measureCurrentImplementation()) !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("root eval private-input qualification manifest drifted");
	await checkRootEvalGeneratedArtifacts();

	const privateInputs = await qualifyRootEvalLivePrivateInputs({ credentialPath, zeroByokPath });
	process.stdout.write(
		`${JSON.stringify({
			disposition: "qualified-private-inputs",
			decisionRef: ROOT_EVAL_LIVE_DECISION_REF,
			generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
			credentialBindingDigest: empiricalStrictJsonDigest({
				bindingRef: privateInputs.credential.bindingRef,
				bindingRevision: privateInputs.credential.bindingRevision,
			}),
			zeroByokObservationDigest: privateInputs.zeroByok.observationDigest,
		})}\n`,
	);
}

await main(ROOT_EVAL_PRIVATE_INPUT_EXECUTION_APPROVAL);
