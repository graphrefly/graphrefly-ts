/** Independent reverse whitelist; does not import the recording derivation. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { check as workloadCheck } from "./check-causal-workload-source.mjs";
export function check(original, source, condition) {
	assert.ok(["EAGER", "DEFERRED"].includes(condition));
	let restored = source;
	const undo = (a, b) => {
		assert.equal(restored.split(a).length, 2, `recording whitelist: ${a}`);
		restored = restored.replace(a, b);
	};
	undo(`assert.equal(config.condition, "${condition}");`, 'assert.equal(config.condition, "CPU");');
	undo(
		'createObservation("CPU", config.orientation)',
		"createObservation(config.condition, config.orientation)",
	);
	undo(
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
		"let workloadFailure;\ntry {",
	);
	if (condition === "DEFERRED") {
		undo(
			"/* deferred: samples retained by the original push */",
			"appendFileSync(samplesPath, `${JSON.stringify(v)}\n`);",
		);
		undo(
			`let flushFailure;
boundary("flushBegin");
try {
 for (const v of samples) appendFileSync(samplesPath, \`\${JSON.stringify(v)}\\n\`);
} catch (error) { flushFailure = error; }
boundary("flushEnd");
boundary("end");
const observed = await observation.finish();`,
			"const observed = await observation.finish();",
		);
	} else
		undo(
			'const flushFailure = undefined;\nboundary("end");\nconst observed = await observation.finish();',
			"const observed = await observation.finish();",
		);
	undo(
		'try { put("diagnostic.json", observed.data); put("recording.json", recording); }',
		'try { put("diagnostic.json", observed.data); }',
	);
	undo(
		"[workloadFailure, flushFailure, observed.fault, writeFailure]",
		"[workloadFailure, observed.fault, writeFailure]",
	);
	const proof = workloadCheck(original, restored, "CPU");
	return {
		...proof,
		cpuDigest: proof.derivedDigest,
		derivedDigest: createHash("sha256").update(source).digest("hex"),
		kind: "independent-recording-whitelist-v1",
		condition,
	};
}
