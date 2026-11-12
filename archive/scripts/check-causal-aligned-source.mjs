/** Independent reverse whitelist: observation ownership only; original loop unchanged. */
import assert from "node:assert/strict";
import { check as baseCheck } from "./check-causal-workload-source.mjs";
export function check(original, source, condition) {
	assert.ok(["CONTROL", "GC", "GC_CPU"].includes(condition));
	let s = source;
	const undo = (a, b) => {
		assert.equal(s.split(a).length, 2, a);
		s = s.replace(a, b);
	};
	undo("runRow(configPath, modules, observation)", "runRow(configPath, modules)");
	undo(`assert.equal(config.condition, "${condition}");`, 'assert.equal(config.condition, "CPU");');
	undo(
		"let workloadFailure;\ntry {",
		"const observation = createObservation(config.condition, config.orientation);\nlet workloadFailure;\ntry {",
	);
	undo(
		"if (workloadFailure) throw workloadFailure;\nreturn samples.length;",
		`const observed = await observation.finish();
let writeFailure;
try { put("diagnostic.json", observed.data); } catch (error) { writeFailure = error; }
const errors = [workloadFailure, observed.fault, writeFailure].filter(Boolean);
if (errors.length === 1) throw errors[0];
if (errors.length > 1) throw new AggregateError(errors, "workload/observation/write failures");
put("completion.json", { completed: true, samples: samples.length });`,
	);
	return baseCheck(original, 'import {createObservation} from "./observation.mjs";\n' + s, "CPU");
}
