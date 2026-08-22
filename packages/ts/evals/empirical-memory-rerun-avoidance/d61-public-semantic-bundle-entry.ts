// @ts-expect-error This specifier is bound to the frozen candidate snapshot by the esbuild gate.
import * as graphModule from "d61-candidate-graph";
// @ts-expect-error This specifier is bound to the frozen candidate snapshot by the esbuild gate.
import * as identity from "d61-candidate-identity";
// @ts-expect-error This specifier is bound to the frozen candidate snapshot by the esbuild gate.
import * as providerInput from "d61-candidate-provider-input";
// @ts-expect-error This specifier is bound to the frozen candidate snapshot by the esbuild gate.
import * as runtime from "d61-candidate-runtime";
import {
	D61_PUBLIC_SEMANTIC_SCENARIO_IDS,
	type D61WorkerSemanticScenarioId,
	D63_WITHHELD_SEMANTIC_SCENARIO_ID,
	executeD61PublicSemanticScenarioWithModules,
} from "./d61-public-semantic-scenarios.js";

async function main(): Promise<void> {
	const [workspaceStateDigest, writeScope, scenarioIdValue] = process.argv.slice(2);
	if (
		workspaceStateDigest === undefined ||
		(writeScope !== "0" && writeScope !== "1") ||
		(!D61_PUBLIC_SEMANTIC_SCENARIO_IDS.includes(scenarioIdValue as never) &&
			scenarioIdValue !== D63_WITHHELD_SEMANTIC_SCENARIO_ID)
	)
		throw new TypeError("D61 isolated semantic worker arguments drifted");
	const result = await executeD61PublicSemanticScenarioWithModules(
		{
			workspaceRoot: "isolated-bundle",
			workspaceStateDigest,
			writeScopePreserved: writeScope === "1",
			scenarioId: scenarioIdValue as D61WorkerSemanticScenarioId,
		},
		{ runtime, graphModule, identity, providerInput },
	);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch(() => {
	process.exitCode = 1;
});
