import { afterEach, expect, it } from "vitest";
import {
	frameworkExample,
	maintainerExample,
	ordinaryExample,
} from "../../../../examples/spending-alerts/causal-audience.examples.js";
import type { Publication } from "../../../../examples/spending-alerts/causal-publication.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetRun,
} from "../../../../scripts/fixtures/spending-preset-harness.js";

const runs: ReturnType<typeof presetRun>[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	for (const run of runs.splice(0)) run.cleanup();
});

for (const mode of ["off", "summary"] as const) {
	it(`D162 audience examples share one graph without exposing assembly fields (${mode})`, () => {
		const run = presetRun(mode);
		runs.push(run);
		const { view, capabilities } = run.built.consume;
		const before = run.graph.describe().nodes.map((node) => node.id);
		expect(Reflect.ownKeys(view)).toEqual([
			"assessment",
			"publication",
			"coverage",
			"issues",
			"startup",
		]);
		for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(view))) {
			expect(descriptor.get).toBeUndefined();
			expect(descriptor.writable).toBe(false);
			expect(descriptor.configurable).toBe(false);
		}
		const binding = {
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: 1,
		} as const;
		expect(frameworkExample(run.graph, capabilities, binding)).toBe(capabilities.execution);
		expect(capabilities.execution.identity).toBe(capabilities.identity);
		expect(capabilities.retained.execution).toBe(capabilities.execution);
		expect(() => frameworkExample(run.graph, capabilities, { ...binding, epoch: 2 })).toThrow();
		const seen: Publication[] = [];
		stops.push(ordinaryExample(view, (value) => seen.push(value)));
		const evaluation = evaluationFixture();
		run.send("pack", evaluationPack([evaluation]));
		run.drive(evaluation);
		expect(seen.at(-1)).toBe(run.events.publication.at(-1));
		expect(seen.at(-1)?.rows[0].recorded).toBe("admitted-no-outcome");
		const snapshot = maintainerExample(run.graph);
		expect(snapshot.nodes.map((node) => node.id)).toEqual(before);
		expect(snapshot.nodes.filter((node) => node.name === "spending/causal/authority")).toHaveLength(
			1,
		);
	});

	it(`D162 ordinary detach and reconnect do not settle an admitted obligation (${mode})`, () => {
		const run = presetRun(mode);
		runs.push(run);
		const seen: Publication[] = [];
		const stop = ordinaryExample(run.built.consume.view, (value) => seen.push(value));
		stops.push(stop);
		const evaluation = evaluationFixture();
		run.send("pack", evaluationPack([evaluation]));
		run.drive(evaluation);
		const outcome = run.outcome();
		stop();
		run.disconnect();
		const count = seen.length;
		const inbox = policyFacts(evaluation).inbox;
		run.send("inbox", { ...inbox, outcomes: [{ ...outcome, effectId: "wrong" }] });
		expect(seen).toHaveLength(count);
		expect([...run.state().effects.values()][0].outcome).toBeUndefined();
		stops.push(ordinaryExample(run.built.consume.view, (value) => seen.push(value)));
		expect(seen.length).toBeGreaterThan(count);
		expect(seen.at(-1)?.rows[0].recorded).toBe("admitted-no-outcome");
		run.send("inbox", { ...inbox, outcomes: [outcome] });
		expect(seen.at(-1)?.rows[0].recorded).toBe("succeeded");
	});
}
