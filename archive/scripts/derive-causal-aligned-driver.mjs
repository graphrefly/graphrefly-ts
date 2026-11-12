/** Private derivation; never imports the consumer bundle. */
import assert from "node:assert/strict";
import { derive as workload } from "./derive-causal-workload-driver.mjs";
export function derive(original, condition) {
	assert.ok(["CONTROL", "GC", "GC_CPU"].includes(condition));
	let output = workload(original, "CPU").output;
	const swap = (a, b) => {
		assert.equal(output.split(a).length, 2, a);
		output = output.replace(a, b);
	};
	swap('import {createObservation} from "./observation.mjs";\n', "");
	swap("runRow(configPath, modules)", "runRow(configPath, modules, observation)");
	swap('assert.equal(config.condition, "CPU");', `assert.equal(config.condition, "${condition}");`);
	swap("const observation = createObservation(config.condition, config.orientation);\n", "");
	const start = output.indexOf("const observed = await observation.finish();");
	assert.ok(start > 0);
	const end = output.indexOf(
		'put("completion.json", { completed: true, samples: samples.length });',
		start,
	);
	assert.ok(end > start);
	output =
		output.slice(0, start) +
		"if (workloadFailure) throw workloadFailure;\nreturn samples.length;" +
		output.slice(
			end + 'put("completion.json", { completed: true, samples: samples.length });'.length,
		);
	return output;
}
