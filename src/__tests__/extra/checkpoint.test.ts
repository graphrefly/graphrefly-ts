import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { state } from "../../core/sugar.js";
import {
	checkpointNodeValue,
	DictCheckpointAdapter,
	FileCheckpointAdapter,
	MemoryCheckpointAdapter,
	restoreGraphCheckpoint,
	SqliteCheckpointAdapter,
	saveGraphCheckpoint,
} from "../../extra/checkpoint.js";
import { Graph } from "../../graph/graph.js";

describe("extra checkpoint (roadmap §3.1)", () => {
	it("MemoryCheckpointAdapter round-trips snapshot", () => {
		const g = new Graph("g");
		g.add("x", state(7));
		const mem = new MemoryCheckpointAdapter();
		saveGraphCheckpoint(g, mem);
		const g2 = new Graph("g");
		g2.add("x", state(0));
		expect(restoreGraphCheckpoint(g2, mem)).toBe(true);
		expect(g2.get("x")).toBe(7);
	});

	it("DictCheckpointAdapter uses storage key", () => {
		const g = new Graph("app");
		g.add("n", state("hi"));
		const bag: Record<string, unknown> = {};
		const ad = new DictCheckpointAdapter(bag, "ck");
		saveGraphCheckpoint(g, ad);
		const g2 = new Graph("app");
		g2.add("n", state(""));
		expect(restoreGraphCheckpoint(g2, ad)).toBe(true);
		expect(g2.get("n")).toBe("hi");
	});

	it("FileCheckpointAdapter writes atomically", () => {
		const dir = join(tmpdir(), `grf-ckpt-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "snap.json");
		try {
			const g = new Graph("g");
			g.add("a", state(1));
			const file = new FileCheckpointAdapter(path);
			saveGraphCheckpoint(g, file);
			const g2 = new Graph("g");
			g2.add("a", state(0));
			expect(restoreGraphCheckpoint(g2, file)).toBe(true);
			expect(g2.get("a")).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("SqliteCheckpointAdapter round-trips", () => {
		const path = join(tmpdir(), `grf-sqlite-${Date.now()}.db`);
		const g = new Graph("g");
		g.add("z", state(99));
		const sql = new SqliteCheckpointAdapter(path);
		saveGraphCheckpoint(g, sql);
		const g2 = new Graph("g");
		g2.add("z", state(0));
		expect(restoreGraphCheckpoint(g2, sql)).toBe(true);
		expect(g2.get("z")).toBe(99);
		sql.close();
		try {
			rmSync(path, { force: true });
		} catch {
			/* ignore */
		}
	});

	it("restore returns false when empty", () => {
		const g = new Graph("g");
		g.add("x", state(1));
		expect(restoreGraphCheckpoint(g, new MemoryCheckpointAdapter())).toBe(false);
	});

	it("checkpointNodeValue", () => {
		const n = state(3);
		expect(checkpointNodeValue(n)).toEqual({ version: 1, value: 3 });
	});
});
