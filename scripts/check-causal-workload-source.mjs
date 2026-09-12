/** Independent literal-insertion + AST verifier; never imports the workload derivation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { check as checkPosition } from "./check-causal-position-source.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const parse = (source) => {
	const tree = ts.createSourceFile(
		"workload.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	assert.equal(tree.parseDiagnostics.length, 0, "valid diagnostic JavaScript");
	return tree;
};
export function check(original, derived, condition) {
	assert.ok(["BASE", "CPU", "CPU_GC"].includes(condition), "known condition");
	const tree = parse(derived);
	const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => n.moduleSpecifier.text);
	assert.deepEqual(
		imports,
		condition === "BASE"
			? ["node:assert/strict", "node:fs", "node:perf_hooks", "node:timers/promises"]
			: [
					"./observation.mjs",
					"node:assert/strict",
					"node:fs",
					"node:perf_hooks",
					"node:timers/promises",
				],
		"only frozen runtime imports and the diagnostic sidecar",
	);
	let restored = derived;
	const undo = (addition, baseline) => {
		assert.equal(
			restored.split(addition).length,
			2,
			`exact unique permitted insertion: ${addition}`,
		);
		restored = restored.replace(addition, baseline);
	};
	// Each whole literal is owned here independently. Any extra statement, altered argument,
	// changed timer, or relocated observation survives reversal and fails the D169 checker.
	undo(
		`\nassert.equal(config.kind, "control");\nassert.equal(config.condition, ${JSON.stringify(condition)});\nassert.ok(["U","V"].includes(config.orientation));\nassert.deepEqual(config.row,`,
		"assert.deepEqual(config.row,",
	);
	const completion = 'put("completion.json", { completed: true, samples: samples.length });';
	if (condition === "BASE") {
		undo(
			'put("diagnostic.json", {condition:config.condition,orientation:config.orientation,checkpoints:[],gc:[],disconnectAt:null,observerInstalled:false});\n' +
				completion,
			completion,
		);
	} else {
		const header = 'import {createObservation} from "./observation.mjs";\n';
		assert.ok(restored.startsWith(header), "sidecar import at exact header");
		undo(header, "");
		undo(
			"const observation = createObservation(config.condition, config.orientation);\nlet workloadFailure;\ntry {\nfor (let batch2 = 0; batch2 < RECIPE.orders.length; batch2++) {",
			"for (let batch2 = 0; batch2 < RECIPE.orders.length; batch2++) {",
		);
		undo(
			'observation.checkpoint(batch2, arm, "warmup");\nfor (let index = 0; index < total; index++) {\nif (index === RECIPE.warmup) observation.checkpoint(batch2, arm, "measured");',
			"for (let index = 0; index < total; index++) {",
		);
		undo("await setImmediate();\nobservation.check();", "await setImmediate();");
		undo(
			'observation.checkpoint(batch2, arm, "end");\n} catch (error) {\n        armFailure = error;',
			"} catch (error) {\n        armFailure = error;",
		);
		undo(
			'} catch (error) { workloadFailure = error; }\nconst observed = await observation.finish();\nlet writeFailure;\ntry { put("diagnostic.json", observed.data); } catch (error) { writeFailure = error; }\nconst errors = [workloadFailure, observed.fault, writeFailure].filter(Boolean);\nif (errors.length === 1) throw errors[0];\nif (errors.length > 1) throw new AggregateError(errors, "workload/observation/write failures");\n' +
				completion,
			completion,
		);
	}
	// Existing independent AST/byte-loop verifier pins the original worker digest and
	// every frozen statement; it does not execute or import any consumer.
	const baseline = checkPosition(original, restored);
	return {
		kind: "independent-fixed-workload-source-v1",
		valid: true,
		condition,
		originalDigest: sha(original),
		positionDigest: sha(restored),
		derivedDigest: sha(derived),
		originalLoopDigest: baseline.originalLoopDigest,
		parserVersion: baseline.parserVersion,
		parserDigest: baseline.parserDigest,
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 5);
	console.log(
		JSON.stringify(
			check(
				readFileSync(process.argv[2], "utf8"),
				readFileSync(process.argv[3], "utf8"),
				process.argv[4],
			),
			null,
			2,
		),
	);
}
