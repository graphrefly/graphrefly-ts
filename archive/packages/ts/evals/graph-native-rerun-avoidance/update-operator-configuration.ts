import { resolve } from "node:path";
import {
	ROOT_EVAL_LIVE_OPERATOR_CONFIGURATION_NAME,
	replaceRootEvalLiveOperatorConfiguration,
} from "./root-eval-live-authority.js";

const argumentsAfterSeparator = process.argv.slice(2);
const candidateArguments =
	argumentsAfterSeparator[0] === "--" ? argumentsAfterSeparator.slice(1) : argumentsAfterSeparator;
if (candidateArguments.length !== 1)
	throw new TypeError(
		"root eval operator configuration update requires one explicit mode-0600 candidate path",
	);

const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const result = await replaceRootEvalLiveOperatorConfiguration({
	credentialPath: resolve(
		import.meta.dirname,
		"../.private/empirical-memory-rerun-avoidance/openrouter.env",
	),
	candidatePath: resolve(candidateArguments[0]!),
	targetPath: resolve(operatorRoot, ROOT_EVAL_LIVE_OPERATOR_CONFIGURATION_NAME),
});

if (result.disposition === "committed-unverified") {
	process.stdout.write(
		`${JSON.stringify({
			disposition: "operator-configuration-committed-unverified",
			postCommitFailureDigest: result.postCommitFailureDigest,
		})}\n`,
	);
	process.exitCode = 1;
} else {
	process.stdout.write(
		`${JSON.stringify({
			disposition: "operator-configuration-installed",
			configurationRevision: result.configurationRevision,
			revoked: result.revoked,
			sourceArtifactDigest: result.sourceArtifactDigest,
		})}\n`,
	);
}
