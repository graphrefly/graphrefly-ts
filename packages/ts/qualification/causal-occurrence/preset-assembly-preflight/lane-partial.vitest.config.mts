// Diagnostic only: an in-memory change to the existing lane; never production qualification.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../../vitest.config.js";
export default mergeConfig(
	base,
	defineConfig({
		plugins: [
			{
				name: "isolated-lane-prerequisite",
				enforce: "pre",
				transform(code, id) {
					if (!id.endsWith("/solutions/causal-occurrence/construction.ts")) return;
					const target = '{ name, factory: "causalOccurrenceInputLane" }';
					if (code.split(target).length !== 2) throw Error("missing unique lane patch target");
					return code.replace(
						target,
						'{ name, factory: "causalOccurrenceInputLane", partial: true }',
					);
				},
			},
		],
	}),
);
