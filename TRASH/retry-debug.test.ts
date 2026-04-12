import { describe, it, expect, vi } from "vitest";
import { DATA, ERROR, START } from "../../core/messages.js";
import { producer } from "../../core/sugar.js";
import { retry } from "../../extra/resilience.js";
import { constant } from "../../extra/backoff.js";

describe("debug retry", () => {
  it("resubscribes", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const src = producer(
      (a) => {
        runs += 1;
        console.log("producer run", runs, "a.emit type:", typeof a.emit);
        if (runs === 1) {
          a.down([[ERROR, new Error("fail")]]);
        } else {
          a.emit(42);
        }
      },
      { resubscribable: true },
    );
    const out = retry(src, { count: 2, backoff: constant(0) });
    const batches: any[] = [];
    const unsub = out.subscribe((msgs) => {
      const desc = msgs.map((m: any) => {
        const name = String(m[0]).replace("Symbol(graphrefly/", "").replace(")", "");
        return [name, m[1]];
      });
      console.log("sub got:", JSON.stringify(desc));
      batches.push([...msgs]);
    });
    console.log("=== before advance, runs=", runs);
    await vi.advanceTimersByTimeAsync(100);
    console.log("=== after advance, runs=", runs);
    const data = batches.flat().filter((m: any) => m[0] === DATA);
    console.log("data count:", data.length, "values:", data.map((m: any) => m[1]));
    expect(data.some((m: any) => m[1] === 42)).toBe(true);
    unsub();
  });
});
