import { describe, expect, it } from "vitest";
import type {
	EvalAdmittedEffect,
	EvalProviderOutcome,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import { createRootEvalProviderAdapter } from "../../evals/graph-native-rerun-avoidance/focused-async-adapters.js";

const admission = (executionId = "one") =>
	({ kind: "eval-admitted-effect", executionId }) as EvalAdmittedEffect;
const result = (effect: EvalAdmittedEffect) =>
	({
		kind: "eval-provider-outcome",
		executionId: effect.executionId,
		admission: effect,
	}) as EvalProviderOutcome;

describe("D153 private focused async adapters", () => {
	it("registers before invoking, drains active work, and rejects replay after settlement", async () => {
		let finish!: (value: EvalProviderOutcome) => void;
		const adapter = createRootEvalProviderAdapter(2, (_effect) => {
			expect(adapter.pending()).toBe(1);
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const effect = admission();
		const running = adapter.run(effect);
		await expect(adapter.run(effect)).rejects.toThrow(/replay/);
		adapter.close();
		let drained = false;
		const drain = adapter.drain().then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);
		finish(result(effect));
		await running;
		await drain;
		expect(adapter.pending()).toBe(0);
		await expect(adapter.run(effect)).rejects.toThrow(/disposal/);
	});
	it("does not evict settled proof to make room or accept a cloned receipt", async () => {
		const bounded = createRootEvalProviderAdapter(1, async (effect) => result(effect));
		await bounded.run(admission());
		await expect(bounded.run(admission("two"))).rejects.toThrow(/capacity/);
		const forged = createRootEvalProviderAdapter(1, async (effect) => result({ ...effect }));
		await expect(forged.run(admission())).rejects.toThrow(/exact admission/);
		await forged.drain();
		expect(forged.pending()).toBe(0);
	});
});
