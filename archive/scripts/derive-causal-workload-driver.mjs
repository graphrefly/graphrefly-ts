/** Fixed-workload source derivation; BASE loop remains byte-identical to checked D169 loop. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { check } from "./check-causal-position-source.mjs";
import { sha } from "./derive-causal-block-driver.mjs";
import { derive as position } from "./derive-causal-position-driver.mjs";

export function derive(source, condition) {
	assert.ok(["BASE", "CPU", "CPU_GC"].includes(condition));
	const baseline = position(source).output;
	check(source, baseline);
	let output = baseline;
	const replace = (a, b) => {
		assert.equal(output.split(a).length, 2, `unique source seam: ${a}`);
		output = output.replace(a, b);
	};
	replace("const config = JSON.parse", "const config = JSON.parse");
	const guard = `\nassert.equal(config.kind, "control");\nassert.equal(config.condition, ${JSON.stringify(condition)});\nassert.ok(["U","V"].includes(config.orientation));`;
	replace("assert.deepEqual(config.row,", `${guard}\nassert.deepEqual(config.row,`);
	const begin = "for (let batch2 = 0; batch2 < RECIPE.orders.length; batch2++) {";
	if (condition !== "BASE") {
		output = 'import {createObservation} from "./observation.mjs";\n' + output;
		replace(
			begin,
			`const observation = createObservation(config.condition, config.orientation);\nlet workloadFailure;\ntry {\n${begin}`,
		);
		replace(
			"for (let index = 0; index < total; index++) {",
			'observation.checkpoint(batch2, arm, "warmup");\nfor (let index = 0; index < total; index++) {\nif (index === RECIPE.warmup) observation.checkpoint(batch2, arm, "measured");',
		);
		// Event overflow/fault is checked after the existing yield, never in the construction timer.
		replace("await setImmediate();", "await setImmediate();\nobservation.check();");
		replace(
			"} catch (error) {\n        armFailure = error;",
			'observation.checkpoint(batch2, arm, "end");\n} catch (error) {\n        armFailure = error;',
		);
		replace(
			'put("completion.json", { completed: true, samples: samples.length });',
			`} catch (error) { workloadFailure = error; }\nconst observed = await observation.finish();\nlet writeFailure;\ntry { put("diagnostic.json", observed.data); } catch (error) { writeFailure = error; }\nconst errors = [workloadFailure, observed.fault, writeFailure].filter(Boolean);\nif (errors.length === 1) throw errors[0];\nif (errors.length > 1) throw new AggregateError(errors, "workload/observation/write failures");\nput("completion.json", { completed: true, samples: samples.length });`,
		);
	} else {
		replace(
			'put("completion.json", { completed: true, samples: samples.length });',
			'put("diagnostic.json", {condition:config.condition,orientation:config.orientation,checkpoints:[],gc:[],disconnectAt:null,observerInstalled:false});\nput("completion.json", { completed: true, samples: samples.length });',
		);
	}
	return {
		output,
		manifest: {
			condition,
			originalDigest: sha(source),
			positionDigest: sha(baseline),
			derivedDigest: sha(output),
		},
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [source, condition, target] = process.argv.slice(2);
	const result = derive(readFileSync(source, "utf8"), condition);
	writeFileSync(target, result.output, { flag: "wx" });
	writeFileSync(target + ".json", JSON.stringify(result.manifest, null, 2) + "\n", { flag: "wx" });
}
