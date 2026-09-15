import assert from "node:assert/strict";
import {appendFileSync,readFileSync,writeFileSync} from "node:fs";
import {performance as performance2} from "node:perf_hooks";
import {setImmediate} from "node:timers/promises";
const graphSnapshot = () => { throw new Error("unsupported non-cold branch"); };
function schedule(row, scenario) {
  const before = [], action = [];
  const arrival = (refs2, count = 1) => ({
    lane: "arrivals",
    values: Array.from({ length: count }, () => ({ ...scenario.arrivals, evaluationRefs: refs2 }))
  });
  if (row.group === "cold") return { before, action, preWaveNew: 0, frameItems: 0 };
  if (row.group === "recovery")
    return { before: scenario.steps, action, preWaveNew: 0, frameItems: 0 };
  const refs = scenario.arrivals.evaluationRefs;
  if (row.change === "duplicate") before.push(...scenario.steps);
  else {
    before.push(...scenario.setup);
    if (scenario.id !== "P6")
      before.push({ lane: "verification", values: [scenario.combined.verification] });
    if (row.change === "one-new") before.push(arrival(refs.slice(0, -1)));
  }
  action.push(arrival(refs, row.dataCount));
  if (scenario.id === "P6" && row.change !== "duplicate")
    action.push(...scenario.steps.filter((s) => s.lane === "verification"));
  return {
    before,
    action,
    preWaveNew: row.change === "all-new" ? refs.length : row.change === "one-new" ? 1 : 0,
    frameItems: refs.length
  };
}
function cleanupAll(runs, primary) {
  const errors = [];
  for (const run of runs) {
    try {
      run?.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      primary === void 0 ? errors : [primary, ...errors],
      "cleanup failures; original failure retained first"
    );
}
export function makeFactory(modules,kind) {
  assert.ok(["control","main","mutation","plain"].includes(kind));
  assert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);
  return (arm,mode) => {
    assert.ok(["candidate","reference","plain"].includes(arm));
    const slot = arm === "candidate" ? 1 : 0;
    const selected = arm === "plain" ? "plain" : arm === "candidate" && kind === "main" ? "candidate" : "reference";
    if (kind === "mutation" && arm === "candidate") {
      const extra = modules[slot].measurementArm(selected,mode);
      cleanupAll([extra]);
    }
    return modules[slot].measurementArm(selected,mode);
  };
}
export async function runRow(configPath, modules) {
const config = JSON.parse(readFileSync(configPath, "utf8"));
assert.deepEqual(config.row, {id:"cold-P2-summary",group:"cold",profile:"P2",mode:"summary"});
assert.ok(["control","main","mutation","plain"].includes(config.kind));
assert.equal(config.control, config.kind === "control");
assert.ok(Array.isArray(modules) && modules.length === 2 && modules[0] !== modules[1]);
const orders = {U:[["candidate","reference"],["reference","candidate"],["candidate","reference"]],V:[["reference","candidate"],["candidate","reference"],["reference","candidate"]],P:[["plain"],["plain"],["plain"]]};
assert.ok(Object.hasOwn(orders,config.orientation));
assert.equal(config.orientation === "P", config.kind === "plain");
const originalRecipe = {"revision":"spending-preset-performance-v1","coldRows":12,"steadyRows":60,"recoveryRows":12,"warmup":100,"measured":300,"orders":[["candidate","reference"],["reference","candidate"],["candidate","reference"]],"coldLimit":1.2,"steadyLimit":1.1,"recoveryCycles":20,"stopAfterFailedRow":true,"childTimeoutMs":900000,"totalTimeoutMs":7200000,"freshBasis":"distinct evaluation identities absent before the whole wave","doubleData":"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay","memory":"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof"};
assert.deepEqual(modules[0].RECIPE,originalRecipe);
assert.deepEqual(modules[1].RECIPE,originalRecipe);
const RECIPE = {...originalRecipe,orders:orders[config.orientation]};
const { row, output } = config, scenario = JSON.parse(readFileSync(config.scenarioPath, "utf8"));
const put = (name, value2) => writeFileSync(`${output}/${name}`, `${JSON.stringify(value2, null, 2)}
`);
const makeArm = makeFactory(modules,config.kind);
const checked3 = modules[0].preflight(row,scenario);
put("preflight-first.json",{module:0,pid:process.pid});
if (config.kind !== "plain") assert.deepEqual(modules[1].preflight(row,scenario),checked3,"two-module semantic preflight");
put("preflight-order.json",{modules:config.kind === "plain" ? [0] : [0,1],pid:process.pid});
put("preflight.json", checked3);
const plan = schedule(row, scenario), samplesPath = `${output}/samples.jsonl`;
const metadata = {
    node: process.version,
    pid: process.pid,
    control: config.control === true,
    timeOrigin: performance2.timeOrigin,
    uptimeOffsetMs: process.uptime() * 1e3 - performance2.now(),
    recipe: RECIPE,
    row
  };
put("worker.json", metadata);
const samples = [];
const record = (v) => {
    samples.push(v);
    appendFileSync(samplesPath, `${JSON.stringify(v)}
`);
  };
for (let batch2 = 0; batch2 < RECIPE.orders.length; batch2++) {
    const arms = RECIPE.orders[batch2];
    for (const arm of arms) {
      if (row.group === "recovery" && batch2 > 0) continue;
      let shared;
      const total = row.group === "recovery" ? RECIPE.recoveryCycles : RECIPE.warmup + RECIPE.measured;
      let armFailure;
      let recoveryBaseline;
      try {
        for (let index = 0; index < total; index++) {
          await setImmediate();
          const phase = row.group === "recovery" || index >= RECIPE.warmup ? "measured" : "warmup";
          let run, sampleFailure;
          let constructionMs = 0, preparationMs = 0;
          const preparationSteps = [], actionSteps = [];
          const fresh = row.group === "cold" || row.change === "all-new" || row.change === "one-new";
          try {
            if (row.group !== "cold") {
              if (!shared || fresh) {
                const begin = performance2.now();
                run = makeArm(arm, row.mode);
                constructionMs = performance2.now() - begin;
                const setupBegin = performance2.now();
                for (const step of plan.before) {
                  const start2 = performance2.now();
                  run.send(step);
                  preparationSteps.push({ start: start2, end: performance2.now() });
                }
                preparationMs = performance2.now() - setupBegin;
                if (!fresh) shared = run;
              } else run = shared;
            }
            const recoveryCounts = row.group === "recovery" && run && "counts" in run ? { ...run.counts } : void 0;
            if (row.group === "recovery" && run && "graph" in run && recoveryBaseline === void 0)
              recoveryBaseline = graphSnapshot(run);
            const memoryBefore = process.memoryUsage();
            const start = performance2.now();
            if (row.group === "cold") run = makeArm(arm, row.mode);
            else if (row.group === "recovery") {
              run.disconnect();
              run.connect();
            } else
              for (const step of plan.action) {
                const start2 = performance2.now();
                run.send(step);
                actionSteps.push({ start: start2, end: performance2.now() });
              }
            const end = performance2.now();
            const memoryAfter = process.memoryUsage();
            if (recoveryCounts && run && "graph" in run) {
              for (const key2 of ["assessment", "publication", "startup"].filter(
                (key3) => key3 in recoveryCounts
              ))
                assert.ok(
                  run.counts[key2] > recoveryCounts[key2],
                  `cycle ${index} reconnect DATA ${key2}`
                );
              assert.deepEqual(
                graphSnapshot(run),
                recoveryBaseline,
                `cycle ${index} obligations retained`
              );
            }
            const restoredCounts = run && "counts" in run ? run.counts : void 0;
            record({
              arm,
              batch: batch2,
              index,
              phase,
              segment: shared ? `${row.id}/${batch2}/${arm}/shared` : `${row.id}/${batch2}/${arm}/${index}`,
              start,
              end,
              ms: end - start,
              constructionMs,
              preparationMs,
              preparationSteps,
              actionSteps,
              memoryBefore,
              recoveryDataCounts: recoveryCounts && restoredCounts ? Object.fromEntries(
                Object.keys(recoveryCounts).map((k) => [
                  k,
                  restoredCounts[k] - recoveryCounts[k]
                ])
              ) : void 0,
              memoryAfter
            });
          } catch (error) {
            sampleFailure = error;
            throw error;
          } finally {
            if (run !== shared) cleanupAll([run], sampleFailure);
          }
        }
      } catch (error) {
        armFailure = error;
        throw error;
      } finally {
        cleanupAll([shared], armFailure);
      }
    }
  }
put("completion.json", { completed: true, samples: samples.length });
console.log("PRESET_PERFORMANCE_ROW_DONE", row.id, samples.length);
}
