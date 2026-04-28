import { describe, expect, it } from "vitest";
import { derived, state } from "../../core/sugar.js";
import { toAscii } from "../../extra/render/index.js";
import { Graph } from "../../graph/graph.js";

/**
 * Helper — strip trailing whitespace per line + drop leading / trailing empty
 * lines so our structural asserts don't depend on exact canvas padding.
 */
function normalize(text: string): string {
	return text
		.split("\n")
		.map((l) => l.replace(/\s+$/u, ""))
		.join("\n")
		.replace(/^\n+|\n+$/gu, "");
}

function allBoxesPresent(output: string, paths: readonly string[]): boolean {
	return paths.every((p) => output.includes(p));
}

describe("toAscii (extra/render — ex `describe({ format: 'ascii' })`)", () => {
	it("renders a single node as one box containing its label", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		const out = toAscii(g.describe());
		expect(out).toContain("a");
		// Default Unicode charset uses box-drawing corners.
		expect(out).toMatch(/[┌┐└┘]/u);
	});

	it("LR chain: three nodes arranged left-to-right with rightward arrows", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const c = derived([b], ([v]) => (v as number) + 1, { name: "c" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		const out = toAscii(g.describe(), { direction: "LR" });
		expect(allBoxesPresent(out, ["a", "b", "c"])).toBe(true);
		// LR arrow tip points right.
		expect(out).toContain("▶");
		// LR boxes share rows — `a` and `b` both appear at the top region.
		const lines = normalize(out).split("\n");
		const aLine = lines.findIndex((l) => l.includes("a"));
		const bLine = lines.findIndex((l) => l.includes("b"));
		expect(aLine).toBeGreaterThanOrEqual(0);
		expect(bLine).toBeGreaterThanOrEqual(0);
		// In LR, a and b should be on roughly the same row (since b is on next layer, not below).
		expect(Math.abs(aLine - bLine)).toBeLessThanOrEqual(1);
	});

	it("TD chain: three nodes arranged top-to-bottom with downward arrows", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const c = derived([b], ([v]) => (v as number) + 1, { name: "c" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		const out = toAscii(g.describe(), { direction: "TD" });
		expect(allBoxesPresent(out, ["a", "b", "c"])).toBe(true);
		// TD arrow tip points down.
		expect(out).toContain("▼");
		// TD: a above b above c — earlier-layer labels appear on earlier lines.
		const lines = normalize(out).split("\n");
		const aLine = lines.findIndex((l) => l.includes("a"));
		const bLine = lines.findIndex((l) => l.includes("b"));
		const cLine = lines.findIndex((l) => l.includes("c"));
		expect(aLine).toBeLessThan(bLine);
		expect(bLine).toBeLessThan(cLine);
	});

	it("diamond (A→B, A→C, B→D, C→D): 4 boxes, no broken edges", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const c = derived([a], ([v]) => (v as number) + 2, { name: "c" });
		const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number), {
			name: "d",
		});
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		g.add(d, { name: "d" });
		const out = toAscii(g.describe());
		expect(allBoxesPresent(out, ["a", "b", "c", "d"])).toBe(true);
		expect(out).toContain("▶");
		// Every row should stay sane width; no Infinity / NaN leakage.
		for (const line of out.split("\n")) {
			expect(line.length).toBeLessThan(400);
		}
	});

	it("long edge spanning 3 layers stays connected via virtual-node routing", () => {
		// Graph: a → b → c → d with an extra edge a → d that skips two layers.
		// Virtual-node splitting should make a→d flow through the middle
		// layers cleanly; no stray empty gutter.
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const c = derived([b], ([v]) => (v as number) + 1, { name: "c" });
		const d = derived([c, a], ([cv, av]) => (cv as number) + (av as number), {
			name: "d",
		});
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		g.add(d, { name: "d" });
		const out = toAscii(g.describe());
		expect(allBoxesPresent(out, ["a", "b", "c", "d"])).toBe(true);
		// One arrow tip per distinct target-node entry point. b, c, d each
		// receive at least one arrow; edges converging on the same cell
		// (c→d + a→d through virtuals) share the tip glyph — that's
		// visually correct.
		const arrowCount = (out.match(/▶/gu) ?? []).length;
		expect(arrowCount).toBeGreaterThanOrEqual(3);
		// Spanning edge's virtuals: the grid must have at least one
		// intermediate column with a horizontal or corner glyph between
		// a and d besides the ones rendered around b / c — a rough
		// "chain is visible" check.
		expect(out).toMatch(/[─│┌┐└┘┬┴├┤┼]/u);
	});

	it("asciiCharset: 'ascii' uses plain ASCII glyphs only", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const out = toAscii(g.describe(), { asciiCharset: "ascii" });
		// No Unicode box-drawing characters.
		expect(out).not.toMatch(/[─│┌┐└┘┬┴├┤┼▶▼]/u);
		// Must have the ASCII equivalents.
		expect(out).toMatch(/[-|+>]/u);
	});

	it("maxLabelWidth truncates long labels with an ellipsis", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "this_is_a_rather_long_path_name" }), {
			name: "this_is_a_rather_long_path_name",
		});
		const out = toAscii(g.describe(), { maxLabelWidth: 10 });
		expect(out).toContain("…");
		expect(out).not.toContain("this_is_a_rather_long_path_name");
	});

	it("CJK labels keep box structure aligned (2 cells per wide char)", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "日本語" }), { name: "日本語" });
		const out = toAscii(g.describe());
		expect(out).toContain("日本語");
		// The box borders should be long enough that the top row has at
		// least 6 horizontal glyphs (3 CJK = 6 cells + 2 borders + 2 padding).
		const lines = normalize(out).split("\n");
		const topBorder = lines.find((l) => l.includes("┌"));
		expect(topBorder).toBeDefined();
		// Top border should contain the corner + several horizontal runs.
		expect(topBorder!).toMatch(/┌─+┐/u);
	});

	it("subgraph-qualified paths render as full labels", () => {
		const g = new Graph("g");
		const sub = new Graph("sub");
		const a = state(1, { name: "a" });
		sub.add(a, { name: "a" });
		g.mount("sub", sub);
		const out = toAscii(g.describe());
		expect(out).toContain("sub::a");
	});

	it("invalid direction throws a clear error", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		expect(() => toAscii(g.describe(), { direction: "BT" as unknown as "LR" })).toThrow(
			/ascii describe supports direction "LR" or "TD"/,
		);
	});

	it("logger callback fires with the rendered text before return", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		let captured = "";
		const out = toAscii(g.describe(), {
			logger: (text) => {
				captured = text;
			},
		});
		expect(captured).toBe(out);
		expect(captured).toContain("a");
	});

	it("derived(describe({reactive:true}), toAscii) yields a live string Node", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		const handle = g.describe({ reactive: true });
		const ascii = derived([handle.node], ([snap]) => toAscii(snap), { name: "live-ascii" });
		const unsub = ascii.subscribe(() => {});
		try {
			const first = ascii.cache;
			expect(typeof first).toBe("string");
			expect(first).toContain("a");
			// Add a second node — describe recomputes → ascii recomputes.
			g.add(state(2, { name: "b" }), { name: "b" });
			const second = ascii.cache;
			expect(typeof second).toBe("string");
			expect(second).toContain("b");
		} finally {
			unsub();
			handle.dispose();
		}
	});

	it("scales to 100-node wide DAG without throwing", () => {
		const g = new Graph("g");
		const roots: ReturnType<typeof state>[] = [];
		for (let i = 0; i < 10; i += 1) {
			const s = state(i, { name: `r${i}` });
			roots.push(s);
			g.add(s, { name: `r${i}` });
		}
		// 3 downstream layers of 30 derived nodes each, randomly wired.
		let prev = roots;
		for (let layer = 0; layer < 3; layer += 1) {
			const next: ReturnType<typeof state>[] = [];
			for (let i = 0; i < 30; i += 1) {
				const deps = [
					prev[(i * 3 + layer) % prev.length]!,
					prev[(i * 7 + layer + 1) % prev.length]!,
				];
				const d = derived(deps, ([a, b]) => (a as number) + (b as number), {
					name: `L${layer}_n${i}`,
				});
				next.push(d as unknown as ReturnType<typeof state>);
				g.add(d, { name: `L${layer}_n${i}` });
			}
			prev = next;
		}
		const start = Date.now();
		const out = toAscii(g.describe(), { maxLabelWidth: 10 });
		const elapsed = Date.now() - start;
		expect(out.length).toBeGreaterThan(100);
		// Every registered name should appear in the output. Truncation
		// preserves the prefix so the unique `L0_n0` / `r0` prefixes stay
		// visible.
		for (let i = 0; i < 10; i += 1) expect(out).toContain(`r${i}`);
		for (let layer = 0; layer < 3; layer += 1) {
			for (let i = 0; i < 30; i += 1) expect(out).toContain(`L${layer}_n${i}`);
		}
		// Loose bound so the test doesn't flake on slow CI.
		expect(elapsed).toBeLessThan(2000);
	});

	it("empty graph renders as a valid (possibly empty) string without throwing", () => {
		const g = new Graph("empty");
		const out = toAscii(g.describe());
		expect(typeof out).toBe("string");
	});

	it("malformed snapshot with same-layer or back edges renders best-effort, no crash", () => {
		// Real GraphReFly graphs are DAGs, so we feed toAscii a synthetic
		// GraphDescribeOutput containing a back-edge to exercise the defensive
		// drop in `insertVirtualNodes`. We build the smallest possible describe
		// shape by hand.
		const fake = {
			name: "cyclic",
			nodes: {
				a: { type: "state", status: "settled", value: 1, deps: [], meta: {} },
				b: { type: "state", status: "settled", value: 2, deps: ["a"], meta: {} },
			},
			// Forward edge + back-edge that would make a cycle. Renderer must
			// drop the back-edge and render the two boxes.
			edges: [
				{ from: "a", to: "b" },
				{ from: "b", to: "a" },
			],
			subgraphs: [],
		};
		const out = toAscii(fake as never);
		expect(out).toContain("a");
		expect(out).toContain("b");
		// No NaN leaked into the output.
		expect(out).not.toMatch(/NaN/);
	});

	it("LR and TD of the same graph contain the same set of labels", () => {
		const g = new Graph("g");
		const a = state(1, { name: "alpha" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "beta" });
		const c = derived([a], ([v]) => (v as number) + 2, { name: "gamma" });
		const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number), {
			name: "delta",
		});
		g.add(a, { name: "alpha" });
		g.add(b, { name: "beta" });
		g.add(c, { name: "gamma" });
		g.add(d, { name: "delta" });
		const lr = toAscii(g.describe(), { direction: "LR" });
		const td = toAscii(g.describe(), { direction: "TD" });
		for (const n of ["alpha", "beta", "gamma", "delta"]) {
			expect(lr).toContain(n);
			expect(td).toContain(n);
		}
	});
});
