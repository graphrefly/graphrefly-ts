# @graphrefly/ts/work-queue

Graph-visible generic work queue built on the message bus.

`workQueue` owns queue lifecycle facts: submission, admission, claim, lease,
retry, completion, failure, release, dead-letter, status, and issue material.
It does not execute async work by itself. A host or boundary runner observes
claimed work, performs ordinary JavaScript async work, and reports the result
through explicit queue commands.

## Shape

1. A `messageBus` topic receives submitted work.
2. `workQueue` consumes that topic and emits `work-admitted` records.
3. Workers claim available work and receive `work-claimed` records.
4. Boundary runners execute the claimed payload.
5. Results return through `complete`, `fail`, or `release` commands.

Do not retain a node `ctx` and call `ctx.down(...)` from a later promise
callback. Promise callbacks are fine in the boundary runner; their results
should re-enter the graph as explicit queue commands or outcome facts.

## Concurrent Worker Example

```ts
import { graph } from "@graphrefly/ts/graph";
import { messageBus } from "@graphrefly/ts/messaging";
import {
  workQueue,
  type WorkQueue,
  type WorkQueueRecord,
} from "@graphrefly/ts/work-queue";

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

const stopWorker = startHttpWorker(queue, {
  workerId: "http-worker-1",
  concurrency: 2,
});
```

This uses one worker identity, but it can keep multiple leases in flight. The
queue remains responsible for claim, lease, retry, dead-letter, status, and
issue facts. The runner is responsible for external async execution.

For orchestration and CQRS recipes, keep the same boundary:

- orchestration work produces effect, request, evidence, and status facts;
- CQRS work produces command, status, event, and error facts;
- worker results return through explicit outcome facts or queue disposition
  commands, not through a stale graph `ctx`.
