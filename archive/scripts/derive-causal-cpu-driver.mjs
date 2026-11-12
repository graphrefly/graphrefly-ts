/** Only phase-boundary hooks in an immutable D169 driver. No business execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sha = (s) => createHash("sha256").update(s).digest("hex");
export function derive(source) {
	assert.equal(sha(source), "b192d7bef7434b1241dc78d806b26950bcbf4fd5a62af3085611d65797ef08e9");
	const substitutions = [
		[
			"export async function runRow(configPath, modules) {",
			"export async function runRow(configPath, modules, observer) {",
		],
		[
			"          await setImmediate();",
			'          const observationName = `b${batch2}s${arms.indexOf(arm)}-${index < 100 ? "warmup" : "measured"}`;\n          if (index === 0 || index === 100) observer.start(observationName);\n          await setImmediate();',
		],
		[
			"            if (run !== shared) cleanupAll([run], sampleFailure);\n          }",
			"            if (run !== shared) cleanupAll([run], sampleFailure);\n          }\n          if (index === 99 || index === 399) observer.end(observationName);",
		],
	];
	let output = source;
	for (const [old, next] of substitutions) {
		assert.equal(output.split(old).length, 2);
		output = output.replace(old, next);
	}
	return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 4);
	writeFileSync(process.argv[3], derive(readFileSync(process.argv[2], "utf8")), { flag: "wx" });
}
