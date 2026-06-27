# @graphrefly/ts

Clean-slate TypeScript implementation of GraphReFly: substrate, graph, operators,
sources, storage, messaging, work queues, orchestration, CQRS, render, and tests.

The graph core is synchronous. Async work should live at source, adapter, executor,
worker, or wire-bridge boundaries and return to the graph as visible facts or
commands.

## Concurrent WorkQueue Workers

`workQueue` supports parallel workers by separating queue lifecycle from async
execution:

1. The queue emits graph-visible `work-admitted` and `work-claimed` records.
2. A boundary runner observes claimed work and starts async tasks.
3. The runner reports results through the queue command front door:
   `complete`, `fail`, or `release`.

Do not keep a node `ctx` and call `ctx.down(...)` from a later promise callback.
Promise callbacks are fine in the boundary runner; the important part is that
their results re-enter the graph as explicit queue commands or outcome facts.

The smallest concurrent HTTP worker looks like this:

```ts
import {
  graph,
  messageBus,
  workQueue,
  type WorkQueue,
  type WorkQueueRecord,
} from "@graphrefly/ts";

type HttpTask = {
  readonly url: string;
};

const g = graph({ name: "http-work" });
const bus = messageBus(g, { topics: ["http-work"] });
const queue = workQueue<HttpTask>(g, {
  queueId: "http",
  bus,
  topic: "http-work",
  subscriptionId: "http-worker-input",
});

queue.submit({ url: "https://example.com/a.json" }, { workId: "url-1" });
queue.submit({ url: "https://example.com/b.json" }, { workId: "url-2" });

function startHttpWorker(
  queue: WorkQueue<HttpTask>,
  opts: { readonly workerId: string; readonly concurrency: number },
): () => void {
  const payloads = new Map<string, HttpTask>();
  const inFlight = new Set<string>();

  const refill = () => {
    const availableSlots = opts.concurrency - inFlight.size;
    if (availableSlots > 0) {
      queue.claim({ workerId: opts.workerId, limit: availableSlots });
    }
  };

  const unsubscribe = queue.records.subscribe((msg) => {
    if (msg[0] !== "DATA") return;
    const record = msg[1] as WorkQueueRecord<HttpTask>;

    if (record.kind === "work-admitted") {
      payloads.set(record.workId, record.payload);
      refill();
      return;
    }

    if (record.kind !== "work-claimed" || record.workerId !== opts.workerId) return;
    const task = payloads.get(record.workId);
    if (task === undefined) {
      queue.release({
        workId: record.workId,
        leaseId: record.leaseId,
        attempt: record.attempt,
        workerId: opts.workerId,
        reason: "missing-payload",
      });
      return;
    }

    inFlight.add(record.workId);
    void fetch(task.url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((result) => {
        queue.complete({
          workId: record.workId,
          leaseId: record.leaseId,
          attempt: record.attempt,
          workerId: opts.workerId,
          result,
        });
      })
      .catch((error) => {
        queue.fail({
          workId: record.workId,
          leaseId: record.leaseId,
          attempt: record.attempt,
          workerId: opts.workerId,
          error,
          retryable: true,
        });
      })
      .finally(() => {
        inFlight.delete(record.workId);
        refill();
      });
  });

  refill();
  return unsubscribe;
}

const stopWorker = startHttpWorker(queue, { workerId: "http-worker-1", concurrency: 2 });
```

This uses one worker identity, but it can keep multiple leases in flight. The
queue remains responsible for claim/lease/retry/dead-letter facts; the runner is
responsible for ordinary JavaScript concurrency.

For orchestration and CQRS recipes, keep the same boundary:

- orchestration work produces effect/request/evidence/status facts;
- CQRS work produces command/status/event/error facts;
- worker results return through explicit outcome facts or queue disposition
  commands, not through a stale graph `ctx`.
