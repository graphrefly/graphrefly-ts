/** Private, exact-source transformations; never imports the consumer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export function driver(source) {
	assert.equal(hash(source), "b192d7bef7434b1241dc78d806b26950bcbf4fd5a62af3085611d65797ef08e9");
	const pairs = [
		["function cleanupAll(runs, primary) {", "function cleanupAll(runs, primary, diagnostic) {"],
		["run?.cleanup();", "run?.cleanup(diagnostic);"],
		[
			"export async function runRow(configPath, modules) {",
			"export async function runRow(configPath, modules, observer, gaps) {",
		],
		[
			"          await setImmediate();",
			`          const observationName = \`b\${batch2}s\${arms.indexOf(arm)}-\${index < 100 ? "warmup" : "measured"}\`; // GAP
          if (index === 0 || index === 100) observer.start(observationName); // GAP
          const gap = gaps.begin({batch:batch2, arm, index, phase:index < 100 ? "warmup" : "measured"}); // GAP
          gap.y0 = performance2.now(); // GAP
          await setImmediate();
          gap.y1 = performance2.now(); // GAP`,
		],
		[
			"            const memoryBefore = process.memoryUsage();",
			"            gap.m0 = performance2.now(); // GAP\n            const memoryBefore = process.memoryUsage();",
		],
		[
			"            const memoryAfter = process.memoryUsage();",
			"            const memoryAfter = process.memoryUsage();\n            gap.m1 = performance2.now(); // GAP\n            gap.start = start; gap.end = end; // GAP",
		],
		[
			"            record({",
			"            gap.r0 = performance2.now(); // GAP\n            record({",
		],
		[
			"              memoryAfter\n            });",
			"              memoryAfter\n            });\n            gap.r1 = performance2.now(); // GAP",
		],
		[
			"            if (run !== shared) cleanupAll([run], sampleFailure);",
			`            let diagnosticFailure, cleanupFailure, deep; // GAP
            try { // GAP
              gap.c0 = performance2.now(); // GAP
              deep = gaps.deep(gap); // GAP
            } catch (error) { diagnosticFailure = error; } // GAP
            try { // GAP
            if (run !== shared) cleanupAll([run], sampleFailure, deep);
            } catch (error) { cleanupFailure = error; } // GAP
            try { gap.c1 = performance2.now(); } catch (error) { diagnosticFailure = new AggregateError([diagnosticFailure, error].filter(Boolean), "diagnostic clocks"); } // GAP
            if (cleanupFailure || diagnosticFailure) gaps.fail(sampleFailure, cleanupFailure, diagnosticFailure); // GAP
            gaps.append(gap, sampleFailure); // GAP`,
		],
		[
			"          }\n        }\n      } catch (error) {",
			"          }\n          if (index === 99 || index === 399) observer.end(observationName); // GAP\n        }\n      } catch (error) {",
		],
	];
	let result = source;
	for (const [a, b] of pairs) {
		assert.equal(result.split(a).length, 2, a);
		result = result.replace(a, b);
	}
	return result;
}
export function worker(source) {
	const original = `    cleanup: () => {
      disconnect();
      for (const root of owner.roots) root.unsubscribe?.();
      const group = graph.topologyGroup();
      for (const n of graph.describe().nodes) group.add(graph.find(n.id));
      group.release();
    }`;
	const next = `    cleanup: (diagnostic) => {
      if (diagnostic) diagnostic.d0 = diagnostic.now(); // GAP
      disconnect();
      for (const root of owner.roots) root.unsubscribe?.();
      if (diagnostic) diagnostic.d1 = diagnostic.now(); // GAP
      const group = graph.topologyGroup();
      const snapshot = graph.describe();
      if (diagnostic) diagnostic.d2 = diagnostic.now(); // GAP
      for (const n of snapshot.nodes) group.add(graph.find(n.id));
      if (diagnostic) diagnostic.d3 = diagnostic.now(); // GAP
      group.release();
      if (diagnostic) diagnostic.d4 = diagnostic.now(); // GAP
    }`;
	assert.equal(source.split(original).length, 2);
	return source.replace(original, next);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 5);
	assert.ok(["driver", "worker"].includes(process.argv[2]));
	writeFileSync(
		process.argv[4],
		{ driver, worker }[process.argv[2]](readFileSync(process.argv[3], "utf8")),
		{ flag: "wx" },
	);
}
