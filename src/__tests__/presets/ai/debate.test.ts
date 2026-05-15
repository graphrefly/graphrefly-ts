/**
 * DS-14.6.A U-C — heterogeneousDebate.
 */
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { heterogeneousDebate, type Turn } from "../../../presets/ai/debate/index.js";
import type { LLMAdapter, LLMResponse } from "../../../utils/ai/adapters/core/types.js";

/** Adapter that replies with `reply(callIndex)`. */
function scriptedAdapter(provider: string, reply: (n: number) => string): LLMAdapter {
	let n = 0;
	return {
		provider,
		model: `${provider}-m`,
		invoke(): Promise<LLMResponse> {
			const content = reply(n++);
			return Promise.resolve({ content });
		},
		// biome-ignore lint/correctness/useYield: unused in debate
		async *stream() {
			throw new Error("unused");
		},
	};
}

describe("DS-14.6.A U-C — heterogeneousDebate", () => {
	it("fixedRounds: N rounds × participants turns; heterogeneous adapters", async () => {
		const g = new Graph("g");
		const d = heterogeneousDebate(g, {
			question: "Q?",
			participants: [
				{ adapter: scriptedAdapter("A", (n) => `a${n}`), role: "advocate", systemPrompt: "be for" },
				{
					adapter: scriptedAdapter("B", (n) => `b${n}`),
					role: "skeptic",
					systemPrompt: "be against",
				},
			],
			rounds: 3,
		});
		const out = (await d.run()) as readonly Turn[];
		expect(out).toHaveLength(6); // 3 rounds × 2 participants
		expect(out.filter((t) => t.round === 1).map((t) => t.role)).toEqual(["advocate", "skeptic"]);
		expect(d.status.cache).toBe("max-rounds");
	});

	it("D-C2: output 'synthesizer-final' without a synthesizer participant throws", () => {
		const g = new Graph("g");
		expect(() =>
			heterogeneousDebate(g, {
				question: "Q",
				participants: [
					{ adapter: scriptedAdapter("A", () => "x"), role: "advocate", systemPrompt: "" },
				],
				output: "synthesizer-final",
			}),
		).toThrow(/synth/i);
	});

	it("synthesizer-final returns the last synthesizer turn", async () => {
		const g = new Graph("g");
		const d = heterogeneousDebate(g, {
			question: "Q",
			participants: [
				{ adapter: scriptedAdapter("A", (n) => `a${n}`), role: "advocate", systemPrompt: "" },
				{
					adapter: scriptedAdapter("S", (n) => `verdict-${n}`),
					role: "synthesizer",
					systemPrompt: "",
				},
			],
			rounds: 2,
			output: "synthesizer-final",
		});
		const out = await d.run();
		expect(out).toBe("verdict-1"); // 2nd synthesizer call (index 1)
	});

	it("D-C1: until-converge stops when stances stabilize (default detector)", async () => {
		const g = new Graph("g");
		// Both adapters return a constant → round 2 == round 1 → converged.
		const d = heterogeneousDebate(g, {
			question: "Q",
			participants: [
				{ adapter: scriptedAdapter("A", () => "fixed-a"), role: "advocate", systemPrompt: "" },
				{ adapter: scriptedAdapter("B", () => "fixed-b"), role: "skeptic", systemPrompt: "" },
			],
			rounds: "until-converge",
			maxRounds: 8,
		});
		const out = (await d.run()) as readonly Turn[];
		// Converges after round 2 (round 2 stances == round 1 stances).
		expect(Math.max(...out.map((t) => t.round))).toBe(2);
		expect(d.status.cache).toBe("converged");
	});

	it("output.project maps the transcript", async () => {
		const g = new Graph("g");
		const d = heterogeneousDebate(g, {
			question: "Q",
			participants: [
				{ adapter: scriptedAdapter("A", (n) => `a${n}`), role: "advocate", systemPrompt: "" },
			],
			rounds: 2,
			output: { project: (tr) => tr.length },
		});
		expect(await d.run()).toBe(2);
	});

	it("QA M1(b): the round loop is reactive topology (describe-visible, not an async while)", () => {
		const g = new Graph("g");
		const d = heterogeneousDebate(g, {
			question: "Q",
			participants: [
				{ adapter: scriptedAdapter("A", (n) => `a${n}`), role: "advocate", systemPrompt: "" },
			],
			rounds: 2,
		});
		const desc = JSON.stringify(d.graph.describe());
		// The feedback loop's nodes are registered on the graph → dry-run /
		// explain / describe see the round structure (M1 redesign goal).
		expect(desc).toContain("rounds");
		expect(desc).toContain("transcript");
		expect(desc).toContain("converged");
		expect(desc).toContain("decide");
	});

	it("QA P4: re-entrant run() while pending throws RangeError", async () => {
		const g = new Graph("g");
		const d = heterogeneousDebate(g, {
			question: "Q",
			participants: [
				{ adapter: scriptedAdapter("A", (n) => `a${n}`), role: "advocate", systemPrompt: "" },
			],
			rounds: 2,
		});
		const p1 = d.run();
		// run() is async — the guard rejects rather than sync-throws.
		await expect(d.run()).rejects.toThrow(RangeError);
		await p1;
		// after settle, a fresh run() is allowed again
		await expect(d.run()).resolves.toBeDefined();
	});
});
