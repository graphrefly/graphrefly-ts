import assert from "node:assert/strict";

/** Optional observation of the frozen qualification layout; no production source transformation. */
export function attributeCausalPerformance(source, output) {
	const replace = (before, after) => {
		assert.equal(source.split(before).length, 2, `unique attribution anchor: ${before}`);
		source = source.replace(before, after);
	};
	replace(
		"function run(candidate, scenario, background=0) {",
		`const attributedRuns=[];let attributionContext;
const clockAnchor=()=>({monotonicBeforeNs:process.hrtime.bigint().toString(),performanceMs:performance.now(),monotonicAfterNs:process.hrtime.bigint().toString()});
const traceAnchor=clockAnchor();
function run(candidate, scenario, background=0) {
 const record=attributionContext;const runStart=performance.now();
 const cpuStart=record?process.cpuUsage():undefined;
 const heapStart=record?process.memoryUsage().heapUsed:undefined;`,
	);
	replace(
		"const constructionNs=(performance.now()-start)*1e6;",
		"const constructionEnd=performance.now();const constructionNs=(constructionEnd-start)*1e6;",
	);
	replace("const events=[];const timings=[];", "const events=[];const timings=[];const starts=[];");
	replace(
		" const shape=g.describe()",
		" const describeStart=performance.now();const shape=g.describe()",
	);
	replace(
		" for(const arrival of scenario.arrivals)",
		" const inputsStart=performance.now();for(const arrival of scenario.arrivals)",
	);
	replace(
		"timings.push((performance.now()-t)*1e6);",
		"timings.push((performance.now()-t)*1e6);if(record)starts.push(t);",
	);
	replace(
		" for(const stop of stops.reverse())",
		" const cleanupStart=performance.now();for(const stop of stops.reverse())",
	);
	replace(
		" return {events,shape,constructionNs,timings};",
		` const runEnd=performance.now();
 if(record)attributedRuns.push({...record,candidate,count:scenario.count,evidence:scenario.evidenceCount,background,
 runStart,constructionStart:start,constructionEnd,describeStart,inputsStart,cleanupStart,runEnd,
 starts,timings,heapStart,heapEnd:process.memoryUsage().heapUsed,cpu:process.cpuUsage(cpuStart)});
 return {events,shape,constructionNs,timings};`,
	);
	replace(
		"  for(let i=0;i<300;i++){if((i+batch)%2)",
		"  for(let i=0;i<300;i++){attributionContext={phase:'construction',batch,pair:i};if((i+batch)%2)",
	);
	replace("  a.push(...aa);", "  attributionContext=undefined;a.push(...aa);");
	replace(
		" for(let i=0;i<pairs;i++){if(i%2)",
		" for(let i=0;i<pairs;i++){attributionContext={phase:'steady',pair:i};if(i%2)",
	);
	replace(
		" const result={count:scenario.count",
		" attributionContext=undefined;const result={count:scenario.count",
	);
	// Flush observations only after all original benchmark work. No I/O or yield inside run().
	source += `
const traceEnd=clockAnchor();
writeFileSync(${JSON.stringify(output)},JSON.stringify({schema:'graphrefly-ts/causal-performance-attribution/v1',
meaning:'Original layout, diagnostic clocks and allocations added; no requalification claim',
traceAnchors:[traceAnchor,traceEnd],
arrivals:scenarios.slice(0,3).map(s=>({count:s.count,evidence:s.evidenceCount,lanes:s.arrivals.map(a=>a.lane)})),
runs:attributedRuns}));
`;
	return source;
}
