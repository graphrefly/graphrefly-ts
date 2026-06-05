import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../index.js";
import { graph } from "../index.js";
import { type FSEvent, fromFSWatch } from "../sources/node.js";

const dirs: string[] = [];

beforeEach(() => {
	vi.useRealTimers();
});

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const data = (msgs: Message[]): FSEvent[] =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", FSEvent])[1]);

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 200; i += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(predicate()).toBe(true);
}

describe("node-only filesystem sources", () => {
	it("fromFSWatch is an inspectable node-only source factory with explicit initial scan", async () => {
		const dir = mkdtempSync(join(tmpdir(), "graphrefly-fs-"));
		dirs.push(dir);
		writeFileSync(join(dir, "a.txt"), "a");
		writeFileSync(join(dir, "skip.log"), "skip");
		const g = graph();
		const watched = g.initNode(
			fromFSWatch(dir, { debounceMs: 0, include: ["*.txt"], initialScan: true }),
			[],
			{ name: "fs" },
		);
		const msgs: Message[] = [];
		const unsubscribe = watched.subscribe((msg) => msgs.push(msg));

		await waitFor(() => data(msgs).length === 1);
		unsubscribe();

		const event = data(msgs)[0];
		expect(event.type).toBe("create");
		expect(event.path.endsWith("/a.txt")).toBe(true);
		expect(event.relativePath).toBe("a.txt");
		expect(g.describe().nodes.find((node) => node.id === "fs")?.factory).toBe("fromFSWatch");
	});

	it("fromFSWatch rejects an empty path list before constructing an operator", () => {
		expect(() => fromFSWatch([])).toThrow(RangeError);
	});
});
