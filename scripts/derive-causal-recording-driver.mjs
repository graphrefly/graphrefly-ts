/** Private recording intervention; preserves the independently checked CPU workload. */
import assert from "node:assert/strict";
import { derive as workload } from "./derive-causal-workload-driver.mjs";
export function derive(source, condition) {
	assert.ok(["EAGER", "DEFERRED"].includes(condition));
	let output = workload(source, "CPU").output;
	const replace = (a, b) => {
		assert.equal(output.split(a).length, 2, `unique seam: ${a}`);
		output = output.replace(a, b);
	};
	replace(
		'assert.equal(config.condition, "CPU");',
		`assert.equal(config.condition, "${condition}");`,
	);
	replace(
		"createObservation(config.condition, config.orientation)",
		'createObservation("CPU", config.orientation)',
	);
	replace(
		"let workloadFailure;\ntry {",
		`let workloadFailure;
const recording = {condition:config.condition, checkpoints:[]};
const boundary = edge => {
 const wallBefore = performance.now();
 const {user,system} = process.cpuUsage();
 const wallAfter = performance.now();
 recording.checkpoints.push({edge,wallBefore,wallAfter,user,system});
};
boundary("begin");
try {`,
	);
	if (condition === "DEFERRED")
		replace(
			"appendFileSync(samplesPath, `${JSON.stringify(v)}\n`);",
			"/* deferred: samples retained by the original push */",
		);
	replace(
		"const observed = await observation.finish();",
		`${
			condition === "DEFERRED"
				? `let flushFailure;
boundary("flushBegin");
try {
 for (const v of samples) appendFileSync(samplesPath, \`\${JSON.stringify(v)}\\n\`);
} catch (error) { flushFailure = error; }
boundary("flushEnd");`
				: "const flushFailure = undefined;"
		}
boundary("end");
const observed = await observation.finish();`,
	);
	replace(
		'try { put("diagnostic.json", observed.data); }',
		'try { put("diagnostic.json", observed.data); put("recording.json", recording); }',
	);
	replace(
		"[workloadFailure, observed.fault, writeFailure]",
		"[workloadFailure, flushFailure, observed.fault, writeFailure]",
	);
	return { output };
}
