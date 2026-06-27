# GraphReFly Portable Eval Prompts

Copy-paste these prompts into any AI (Claude web, ChatGPT, Gemini, etc.) to collect
unbiased eval data. Each prompt is self-contained — no project context needed.

**How to use:**
1. Copy one prompt block at a time into a fresh AI conversation
2. Record the AI's output verbatim
3. Score using the neutral rubric at the bottom of this file
4. Compare GraphSpec vs Functions outputs across multiple AIs

---

## TREATMENT A: GraphSpec Generation

### System context (paste once at start of conversation)

```
You are generating a declarative graph specification (GraphSpec) for a reactive
data pipeline. A GraphSpec is a JSON object with these top-level keys:

  "nodes": { ... }           — required: node declarations keyed by name
  "templates": { ... }       — optional: reusable subgraph patterns
  "feedback": [ ... ]        — optional: bounded feedback edges (cycles)

Each node has:
- "type": One of "producer" (data source), "state" (mutable value),
  "derived" (computed from deps), "effect" (side effect triggered by deps),
  "template" (instantiate a reusable template)
- "deps": Array of node names this node depends on
  (required for derived and effect)
- "meta": Object describing how the node is built. Two key sub-fields:
    "factory":     String reference to a catalog name (function for derived/
                   effect, source for producer). Optional but required if
                   the node should be instantiated from the catalog.
    "factoryArgs": Optional freeform object passed to the catalog factory.
  Plus any descriptive sub-fields (e.g., "description").
- "value": Optional initial seed value (for state nodes).

Template nodes (type "template") have:
- "template": Name of a template defined in the top-level "templates" object
- "bind": Object mapping template parameter names to actual node names

Templates (top-level "templates" object) define reusable subgraph patterns:
  "templates": {
    "myPattern": {
      "params": ["$input"],
      "nodes": {
        "step1": { "type": "derived", "deps": ["$input"], "meta": { "factory": "someFn" } },
        "step2": { "type": "derived", "deps": ["step1"], "meta": { "factory": "otherFn" } }
      },
      "output": "step2"
    }
  }
Use templates when the same multi-node pattern must be applied to multiple
inputs (e.g., per-source resilience stacks). Instantiate via template nodes.

Feedback edges (top-level "feedback" array) express bounded cycles:
  "feedback": [
    { "from": "derivedNode", "to": "stateNode", "maxIterations": 3 }
  ]
"from" is a derived/effect node whose output feeds back to "to" (a state node).
The cycle runs at most maxIterations times. Use this for adaptive loops,
convergence, and iterative refinement — NOT inline config on a single node.

Edges are implicit from deps. Do not include an edges array.

Resilience ordering guidance: when composing resilience operators, the
recommended order (outermost to innermost) is:
  rateLimiter → circuitBreaker → retry → timeout(innerCall) → fallback
This means rateLimiter wraps circuitBreaker wraps retry wraps timeout.

Stratify routing: stratify classifies items and tags them with a branch name.
Downstream nodes must use filterBy to select their branch from stratify's
output (e.g., filterBy with field "branch", op "eq", value "P1").

Available functions (use ONLY these):

Transforms & filters:
- filterBy: Filter items by condition. Config: { field, op: "eq"|"gt"|"lt"|"contains", value }
- mapFields: Transform record fields. Config: { mapping: { out: "in" } }
- normalize: Normalize data shape
- groupBy: Group items by field. Config: { field }
- aggregate: Aggregate values. Config: { op: "sum"|"avg"|"count"|"min"|"max", field }
- rollingAvg: Running average over window. Config: { windowSize }
- computeAverage: Average of array
- scan: Running accumulator over stream. Config: { fn, initial }
- distinctUntilChanged: Skip consecutive duplicates. Config: { key? }
- take: Take first N values then stop. Config: { count }
- skip: Skip first N values. Config: { count }
- delay: Delay each value. Config: { delayMs }
- debounce: Debounce rapid values. Config: { waitMs }
- throttle: Throttle values to interval. Config: { intervalMs }
- batchEvents: Collect into batches. Config: { size, intervalMs }
- merge: Combine multiple inputs. Config: { strategy: "concat"|"zip"|"object" }
- dedup: Deduplicate stream. Config: { key?, ttlMs? }

Formatting & reporting:
- formatResults: Format data. Config: { format: "json"|"csv"|"markdown" }
- generateReport: Generate report from data sources
- distill: Extract and consolidate information. Config: { strategy: "latest"|"merge"|"summarize" }

AI / LLM:
- llmClassify: AI classification. Config: { categories: string[] }
- llmSummarize: AI summarization. Config: { maxLength?, style?: "bullets"|"paragraph" }
- llmExtract: AI extraction. Config: { schema }
- llmScore: Score item with LLM rubric. Config: { rubric, scale?: [min, max] }

Reduction (multi-source → signal):
- stratify: Route inputs into priority branches by rules. Config: { rules: [{ match: { field, op, value }, branch: string }], default?: string }
- funnel: Multi-stage filtering and consolidation. Config: { stages: [{ fn, config }] }
- feedback: DEPRECATED as inline fn — use the top-level "feedback" array instead. Declare the computation as a normal derived node, then add a feedback edge from it to a state node. See schema description above.
- scorer: Score and rank items by weighted fields. Config: { weights: { [field]: number }, normalize?: boolean }
- budgetGate: Allow items through while within budget. Config: { budget, costField, resetIntervalMs? }

Orchestration:
- approval: Human or LLM approval gate. Config: { approver: "human"|"llm", prompt? }
- branch: Route to named branches. Config: { condition, then: string, else?: string }
- join: Wait for multiple deps and combine. Config: { strategy: "all"|"race" }

Checks & validation:
- thresholdCheck: Check value against threshold. Config: { threshold, direction: "above"|"below" }
- validateSchema: Validate data against a JSON schema. Config: { schema, onInvalid?: "error"|"filter"|"tag" }

Resilience:
- retry: Retry on failure. Wraps the node's deps — retries fetching from upstream. Config: { maxAttempts, backoff?: "exponential"|"linear"|"fibonacci" }. Do NOT put a source name in fn — retry wraps whatever its deps produce.
- fallback: Use fallback on error. Config: { fallbackValue?, fallbackSource?: "<nodeName>" }
- timeout: Error if no data within deadline. Config: { timeoutMs }
- circuitBreaker: Gate requests through circuit breaker (closed/open/half-open). Config: { failureThreshold?, cooldownMs?, onOpen?: "skip"|"error" }
- rateLimiter: Enforce rate limit on data flow. Config: { maxEvents, windowMs }
- tokenBucket: Token bucket rate limiter. Config: { capacity, refillRate, refillIntervalMs }
- withBreaker: Attach circuit breaker to a node. Config: { failureThreshold, cooldownMs }
- withStatus: Attach status/error companion metadata. Config: { initialStatus?: "pending"|"active"|"completed"|"errored" }
- cache: Cache values with TTL. Config: { ttlMs }

Effects (sinks):
- sendEmail: Send email. Config: { to, subject? }
- sendSlack: Post to Slack. Config: { channel }
- sendAlert: Send alert. Config: { channel: "push"|"sms"|"email" }
- notifyPush: Push notification. Config: { title? }
- writeToDB: Write to database. Config: { table }
- writeLog: Log data. Config: { level? }
- uploadToS3: Upload to S3. Config: { bucket }
- updateDashboard: Update dashboard. Config: { dashboardId? }
- sendPagerDuty: PagerDuty alert. Config: { severity?: "info"|"warning"|"critical" }
- createJiraTicket: Create Jira ticket. Config: { project }
- processPayment: Process payment. Config: { gateway? }
- toKafka: Publish to Kafka topic. Config: { topic }
- toPostgres: Write to PostgreSQL. Config: { table }
- toClickHouse: Write to ClickHouse. Config: { table }
- toLoki: Push to Loki log aggregation. Config: { labels }

Available sources (use ONLY these):
- rest-api: Poll REST endpoint. Config: { url, pollIntervalMs? }
- webhook: Receive HTTP callbacks. Config: { path }
- websocket: WebSocket connection. Config: { url }
- database: Query database. Config: { query }
- kafka: Consume Kafka topic. Config: { topic, groupId? }
- rss: Poll RSS feed. Config: { url }
- email: Watch email inbox (IMAP). Config: { folder? }
- filesystem-watch: Watch files. Config: { path, glob? }
- cron: Emit on schedule. Config: { expression }
- timer: Emit at interval. Config: { intervalMs }
- prometheus: Query metrics. Config: { query }
- mqtt: MQTT subscription. Config: { broker, topic }
- github-events: GitHub webhooks. Config: { repo, events? }
- otel: OpenTelemetry signals (spans, metrics, logs). Config: { signalType: "spans"|"metrics"|"logs", endpoint? }
- redis-stream: Redis Stream consumer. Config: { stream, group?, consumer? }
- nats: NATS subscriber. Config: { subject }
- rabbitmq: RabbitMQ consumer. Config: { queue }
- pulsar: Pulsar consumer. Config: { topic, subscription? }
- syslog: Syslog receiver. Config: { port? }
- mcp: MCP tool invocation source. Config: { server, tool }

Return ONLY valid JSON. No explanation.
```

### Task prompts (one per conversation or clearly separated)

**Task 1 (low — linear):**
```
Compose a GraphSpec for: "Fetch an RSS feed, filter articles that mention 'AI',
and send matching titles to a Slack channel."
```

**Task 2 (medium — diamond):**
```
Compose a GraphSpec for: "Receive a JSON payload via webhook. In parallel:
validate the schema and normalize field names. After both complete, merge the
validation report with the normalized data and store the result in a database."
```

**Task 3 (high — stateful):**
```
Compose a GraphSpec for: "Receive a stream of temperature sensor readings via MQTT.
Maintain a running average over the last 10 readings. When the average exceeds
80°F, emit a push alert."
```

**Task 4 (medium — fan-out):**
```
Compose a GraphSpec for: "Watch an email inbox. Classify each email as urgent,
newsletter, or other. Route urgent emails to a push notification, newsletters
to a weekly batch email digest, and count the rest by sender in a database."
```

**Task 5 (high — error handling):**
```
Compose a GraphSpec for: "On a 60-second timer, call an external pricing API.
If it fails, retry up to 3 times with exponential backoff. If all retries fail,
use a cached price. Log every attempt to a database. Send the final price
(live or cached) to a dashboard."
```

**Task 6 (high — feedback loop):**
```
Compose a GraphSpec for: "Poll an API for new messages. Count how many messages
arrive per minute. If the count exceeds 100/min, decrease the polling interval
to 2 seconds. If below 20/min, increase to 30 seconds. Default interval is
10 seconds."
```

**Task 7 (low — ambiguous):**
```
Compose a GraphSpec for: "Do something useful with my emails."
```

**Task 8a (high — per-source resilience):**
```
Compose a GraphSpec for: "Call three different stock-price APIs via REST.
Each API has its OWN circuit breaker, rate limiter, and retry policy — one
API's failures must NOT affect the others. Per API: timeout after 2 seconds,
retry twice with exponential backoff, then fall back to a cached price.
Each API's circuit breaker opens after 3 failures with a 30-second cooldown.
Rate-limit each API independently to 5 calls per second. Merge the three
prices, compute the median, and push it to a dashboard. Attach status
metadata to each API node for a monitoring UI."
```

**Task 8b (high — shared resilience):**
```
Compose a GraphSpec for: "Poll a single upstream pricing API on a 10-second
timer. The API returns prices for three stocks in one response. Apply a
SHARED circuit breaker (open after 5 failures, 60-second cooldown) and a
SHARED rate limiter (10 requests per second) to the single API source.
On timeout (2 seconds) or failure, retry 3 times with exponential backoff,
then fall back to cached prices. Split the response into per-stock derived
nodes, compute a portfolio total, and push to a dashboard with status
metadata showing whether the source is live or degraded."
```

**Task 9 (high — reduction pipeline):**
```
Compose a GraphSpec for: "Receive alerts from an OpenTelemetry pipeline.
Stratify them by severity: critical alerts go to branch P1, warnings to P2,
info to P3. For P1 and P2, deduplicate by alert name within a 5-minute
window. Score remaining alerts by business impact using weighted fields
(service_tier × 3, duration × 2, affected_users × 1). Gate notifications
by a budget of 20 alerts per hour. Send P1 alerts to PagerDuty (critical),
P2 to Slack, and log all P3 to ClickHouse."
```

**Task 10 (high — orchestration with approval):**
```
Compose a GraphSpec for: "Receive user-submitted content via webhook.
Classify each submission with LLM as 'safe', 'review', or 'reject'.
Route safe content directly to a PostgreSQL database. Route rejected
content to a log with reason. For 'review' items, send to a human
approval gate. Approved items go to the database; denied items go to
the log. Generate a weekly report of all moderation decisions and
send it via email."
```

**Task 11 (high — feedback with LLM):**
```
Compose a GraphSpec for: "Watch an RSS knowledge base for new articles.
Extract key claims from each article using LLM extraction. Score each
claim's novelty against existing claims stored in a database — high
novelty (score > 0.7) stores the claim directly. Low novelty (score
<= 0.7) merges it with the most similar existing claim using LLM
summarization, then feeds the merged result back for re-scoring (max
3 iterations via feedback loop). Push all newly stored claims to a
Slack channel."
```

---

## TREATMENT B: Plain Functions Generation

### System context (paste once at start of conversation)

```
You are writing TypeScript functions to implement a data pipeline.

Available utility functions (use ONLY these):

// Data sources
declare function fetchFromApi(url: string, options?: RequestInit): Promise<any>;
declare function queryDatabase(sql: string): Promise<any[]>;
declare function readFile(path: string): Promise<string>;
declare function connectWebSocket(url: string): AsyncIterable<any>;
declare function watchEmail(config: { filter?: string }): AsyncIterable<any>;
declare function pollSource(url: string, intervalMs: number): AsyncIterable<any>;
declare function subscribeMQTT(broker: string, topic: string): AsyncIterable<any>;
declare function subscribeOTel(signalType: "spans" | "metrics" | "logs", endpoint?: string): AsyncIterable<any>;
declare function pollRSS(url: string): AsyncIterable<any>;
declare function receiveWebhook(path: string): AsyncIterable<any>;
declare function consumeKafka(topic: string, groupId?: string): AsyncIterable<any>;
declare function consumeRedisStream(stream: string, group?: string): AsyncIterable<any>;
declare function consumeNATS(subject: string): AsyncIterable<any>;
declare function consumeRabbitMQ(queue: string): AsyncIterable<any>;
declare function receiveSyslog(port?: number): AsyncIterable<any>;

// Transformations
declare function filterBy<T>(items: T[], predicate: (item: T) => boolean): T[];
declare function mapItems<T, U>(items: T[], fn: (item: T) => U): U[];
declare function groupBy<T>(items: T[], key: keyof T): Record<string, T[]>;
declare function aggregate<T>(items: T[], fn: (acc: any, item: T) => any, initial: any): any;
declare function validateSchema(data: unknown, schema: object): { valid: boolean; errors: string[] };
declare function normalizeFields(data: Record<string, any>): Record<string, any>;
declare function classifyText(text: string, categories: string[]): Promise<string>;
declare function summarizeText(text: string): Promise<string>;
declare function extractClaims(text: string, schema: object): Promise<any>;
declare function scoreItem(item: any, weights: Record<string, number>): number;
declare function deduplicate<T>(items: T[], key: string, ttlMs?: number): T[];
declare function batchItems<T>(items: T[], size: number): T[][];
declare function scanAccumulate<T, U>(items: T[], fn: (acc: U, item: T) => U, initial: U): U;

// Reduction & routing
declare function routeByField<T>(item: T, field: string, routes: Record<string, (item: T) => void>): void;
declare function budgetCheck(cost: number, budget: number, resetIntervalMs?: number): boolean;

// Orchestration
declare function requestApproval(item: any, prompt?: string): Promise<"approved" | "denied">;

// Resilience
declare function retry<T>(fn: () => Promise<T>, opts: { maxAttempts: number; backoff?: "exponential" | "linear" | "fibonacci" }): Promise<T>;
declare function withFallback<T>(fn: () => Promise<T>, fallbackValue: T): Promise<T>;
declare function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>;
declare function withCircuitBreaker<T>(fn: () => Promise<T>, opts: { failureThreshold?: number; cooldownMs?: number }): Promise<T>;
declare function rateLimitCalls<T>(fn: () => Promise<T>, maxPerWindow: number, windowMs: number): Promise<T>;
declare function tokenBucketLimit<T>(fn: () => Promise<T>, capacity: number, refillRate: number): Promise<T>;
declare function cacheResult<T>(key: string, fn: () => Promise<T>, ttlMs: number): Promise<T>;

// Effects
declare function sendSlackMessage(channel: string, message: string): Promise<void>;
declare function sendEmail(to: string, subject: string, body: string): Promise<void>;
declare function sendPushNotification(message: string): Promise<void>;
declare function writeToDatabase(table: string, data: any): Promise<void>;
declare function writeToPostgres(table: string, data: any): Promise<void>;
declare function writeToClickHouse(table: string, data: any): Promise<void>;
declare function uploadToS3(bucket: string, key: string, data: any): Promise<void>;
declare function logToAudit(entry: any): Promise<void>;
declare function pushToLoki(labels: Record<string, string>, entry: any): Promise<void>;
declare function updateDashboard(dashboardId: string, data: any): Promise<void>;
declare function sendPagerDutyAlert(severity: string, message: string): Promise<void>;
declare function publishToKafka(topic: string, data: any): Promise<void>;

Return ONLY code. No explanation.
```

### Task prompts (same tasks, same wording)

**Task 1 (low — linear):**
```
Write TypeScript functions that: "Fetch an RSS feed, filter articles that mention
'AI', and send matching titles to a Slack channel."
```

**Task 2 (medium — diamond):**
```
Write TypeScript functions that: "Receive a JSON payload via webhook. In parallel:
validate the schema and normalize field names. After both complete, merge the
validation report with the normalized data and store the result in a database."
```

**Task 3 (high — stateful):**
```
Write TypeScript functions that: "Receive a stream of temperature sensor readings
via MQTT. Maintain a running average over the last 10 readings. When the average
exceeds 80°F, emit a push alert."
```

**Task 4 (medium — fan-out):**
```
Write TypeScript functions that: "Watch an email inbox. Classify each email as
urgent, newsletter, or other. Route urgent emails to a push notification,
newsletters to a weekly batch email digest, and count the rest by sender in
a database."
```

**Task 5 (high — error handling):**
```
Write TypeScript functions that: "On a 60-second timer, call an external pricing
API. If it fails, retry up to 3 times with exponential backoff. If all retries
fail, use a cached price. Log every attempt to a database. Send the final price
(live or cached) to a dashboard."
```

**Task 6 (high — feedback loop):**
```
Write TypeScript functions that: "Poll an API for new messages. Count how many
messages arrive per minute. If the count exceeds 100/min, decrease the polling
interval to 2 seconds. If below 20/min, increase to 30 seconds. Default interval
is 10 seconds."
```

**Task 7 (low — ambiguous):**
```
Write TypeScript functions that: "Do something useful with my emails."
```

**Task 8a (high — per-source resilience):**
```
Write TypeScript functions that: "Call three different stock-price APIs via REST.
Each API has its OWN circuit breaker, rate limiter, and retry policy — one
API's failures must NOT affect the others. Per API: timeout after 2 seconds,
retry twice with exponential backoff, then fall back to a cached price.
Each API's circuit breaker opens after 3 failures with a 30-second cooldown.
Rate-limit each API independently to 5 calls per second. Merge the three
prices, compute the median, and push it to a dashboard. Attach status
metadata to each API node for a monitoring UI."
```

**Task 8b (high — shared resilience):**
```
Write TypeScript functions that: "Poll a single upstream pricing API on a
10-second timer. The API returns prices for three stocks in one response.
Apply a SHARED circuit breaker (open after 5 failures, 60-second cooldown)
and a SHARED rate limiter (10 requests per second) to the single API source.
On timeout (2 seconds) or failure, retry 3 times with exponential backoff,
then fall back to cached prices. Split the response into per-stock derived
values, compute a portfolio total, and push to a dashboard with status
metadata showing whether the source is live or degraded."
```

**Task 9 (high — reduction pipeline):**
```
Write TypeScript functions that: "Receive alerts from an OpenTelemetry pipeline.
Stratify them by severity: critical alerts go to branch P1, warnings to P2,
info to P3. For P1 and P2, deduplicate by alert name within a 5-minute
window. Score remaining alerts by business impact using weighted fields
(service_tier × 3, duration × 2, affected_users × 1). Gate notifications
by a budget of 20 alerts per hour. Send P1 alerts to PagerDuty (critical),
P2 to Slack, and log all P3 to ClickHouse."
```

**Task 10 (high — orchestration with approval):**
```
Write TypeScript functions that: "Receive user-submitted content via webhook.
Classify each submission with LLM as 'safe', 'review', or 'reject'.
Route safe content directly to a PostgreSQL database. Route rejected
content to a log with reason. For 'review' items, send to a human
approval gate. Approved items go to the database; denied items go to
the log. Generate a weekly report of all moderation decisions and
send it via email."
```

**Task 11 (high — feedback with LLM):**
```
Write TypeScript functions that: "Watch an RSS knowledge base for new articles.
Extract key claims from each article using LLM extraction. Score each
claim's novelty against existing claims stored in a database — high
novelty (score > 0.7) stores the claim directly. Low novelty (score
<= 0.7) merges it with the most similar existing claim using LLM
summarization, then feeds the merged result back for re-scoring (max
3 iterations via feedback loop). Push all newly stored claims to a
Slack channel."
```

---

## NEUTRAL SCORING RUBRIC

Score each output on these criteria ONLY. Do not penalize for style choices,
framework preferences, or architectural philosophy.

### Per-task scoring (1 = fail, 2 = partial, 3 = pass)

| # | Criterion | How to judge |
|---|-----------|-------------|
| C1 | **Valid output** | GraphSpec: valid JSON with correct structure. Functions: syntactically correct TypeScript. |
| C2 | **Task completion** | Does the output accomplish ALL parts of the described task? Not "could it" but "does it as written"? |
| C3 | **No hallucinated references** | Does every fn/source/import reference exist in the provided catalog/utilities? |
| C4 | **No logical bugs** | Would this produce correct results if executed? Check: missing data flows, wrong order of operations, off-by-one, unhandled edge cases. |
| C5 | **Completeness** | Are all described behaviors present? Count: behaviors_described vs behaviors_implemented. Score = implemented/described. |

### Scoring rules

- **Do NOT score on reactivity.** If the task says "watch" or "stream", judge whether the output handles ongoing data — but a correct polling loop is as valid as a push subscription.
- **Do NOT penalize mutable state** if it's correct. `let x = []` with proper mutation is fine.
- **Do NOT penalize setTimeout/setInterval** if used correctly for timing.
- **Do NOT penalize one-shot functions** if the task doesn't explicitly require persistent/reactive execution.
- **DO penalize** if the output references functions/sources not in the provided list (hallucination).
- **DO penalize** if the output is structurally invalid (bad JSON, syntax errors).
- **DO penalize** if a described behavior is missing from the output.

### Aggregate metrics

After scoring all 12 tasks × 2 treatments:

| Metric | Formula |
|--------|---------|
| **Validity rate** | % of outputs scoring C1 = 3 |
| **Task completion rate** | % of outputs scoring C2 ≥ 2 |
| **Hallucination rate** | % of outputs scoring C3 < 3 |
| **Bug rate** | % of outputs scoring C4 < 3 |
| **Completeness** | Average C5 across all tasks |

### Recording template

```
AI: [model name]
Date: [date]
Treatment: [GraphSpec / Functions]

Task 1: C1=_ C2=_ C3=_ C4=_ C5=_
Task 2: C1=_ C2=_ C3=_ C4=_ C5=_
Task 3: C1=_ C2=_ C3=_ C4=_ C5=_
Task 4: C1=_ C2=_ C3=_ C4=_ C5=_
Task 5: C1=_ C2=_ C3=_ C4=_ C5=_
Task 6: C1=_ C2=_ C3=_ C4=_ C5=_
Task 7: C1=_ C2=_ C3=_ C4=_ C5=_
Task 8a: C1=_ C2=_ C3=_ C4=_ C5=_
Task 8b: C1=_ C2=_ C3=_ C4=_ C5=_
Task 9: C1=_ C2=_ C3=_ C4=_ C5=_
Task 10: C1=_ C2=_ C3=_ C4=_ C5=_
Task 11: C1=_ C2=_ C3=_ C4=_ C5=_

Notes:
```

---

## L1: DEBUG / MODIFY / EXPLAIN EVAL

L0 (above) tests **generation** — can the LLM compose from scratch? L1 tests
**comprehension** — can the LLM understand, modify, and reason about an existing
graph? This is where GraphSpec's introspection advantages (describe, diff, causal
chain) should differentiate.

### How to use

1. Paste the L1 system context (same as Treatment A above — same catalog)
2. Paste the "Given graph" block for a task, then the task prompt
3. Score using the L1 rubric below

### Given graphs

**Graph A — email triage (working, from L0 Task 4):**
```json
{
  "nodes": {
    "inbox": { "type": "producer", "deps": [], "meta": { "factory": "email", "factoryArgs": { "folder": "INBOX" } } },
    "classify": { "type": "derived", "deps": ["inbox"], "meta": { "factory": "llmClassify", "factoryArgs": { "categories": ["urgent", "newsletter", "other"] } } },
    "urgent": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "category", "op": "eq", "value": "urgent" } } },
    "newsletters": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "category", "op": "eq", "value": "newsletter" } } },
    "other": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "category", "op": "eq", "value": "other" } } },
    "pushUrgent": { "type": "effect", "deps": ["urgent"], "meta": { "factory": "notifyPush", "factoryArgs": { "title": "Urgent email" } } },
    "batchNewsletters": { "type": "derived", "deps": ["newsletters"], "meta": { "factory": "batchEvents", "factoryArgs": { "size": 50, "intervalMs": 604800000 } } },
    "digestEmail": { "type": "effect", "deps": ["batchNewsletters"], "meta": { "factory": "sendEmail", "factoryArgs": { "to": "me@example.com", "subject": "Weekly Newsletter Digest" } } },
    "countBySender": { "type": "derived", "deps": ["other"], "meta": { "factory": "groupBy", "factoryArgs": { "field": "sender" } } },
    "senderCounts": { "type": "derived", "deps": ["countBySender"], "meta": { "factory": "aggregate", "factoryArgs": { "op": "count", "field": "sender" } } },
    "storeOther": { "type": "effect", "deps": ["senderCounts"], "meta": { "factory": "writeToDB", "factoryArgs": { "table": "email_sender_counts" } } }
  }
}
```

**Graph B — pricing pipeline (has bugs, from L0 Task 5):**
```json
{
  "nodes": {
    "tick": { "type": "producer", "deps": [], "meta": { "factory": "timer", "factoryArgs": { "intervalMs": 60000 } } },
    "apiCall": { "type": "derived", "deps": ["tick"], "meta": { "factory": "retry", "factoryArgs": { "maxAttempts": 3, "backoff": "exponential", "fn": "fetchPrice" } } },
    "priceCache": { "type": "state", "deps": [], "value": null },
    "cachedFallback": { "type": "derived", "deps": ["apiCall", "priceCache"], "meta": { "factory": "fallback", "factoryArgs": { "fallbackSource": "priceCache" } } },
    "updateCache": { "type": "effect", "deps": ["cachedFallback"], "meta": { "factory": "cache", "factoryArgs": { "ttlMs": 300000 } } },
    "logAttempt": { "type": "effect", "deps": ["apiCall"], "meta": { "factory": "writeToDB", "factoryArgs": { "table": "pricing_log" } } },
    "dashboard": { "type": "effect", "deps": ["cachedFallback"], "meta": { "factory": "updateDashboard", "factoryArgs": { "dashboardId": "pricing" } } }
  }
}
```

**Graph C — alert reduction pipeline (working, uses Phase 8.x reduction):**
```json
{
  "nodes": {
    "alerts": { "type": "producer", "deps": [], "meta": { "factory": "otel", "factoryArgs": { "signalType": "logs", "endpoint": "http://otel:4318" } } },
    "classify": { "type": "derived", "deps": ["alerts"], "meta": { "factory": "stratify", "factoryArgs": { "rules": [{ "match": { "field": "severity", "op": "eq", "value": "critical" }, "branch": "P1" }, { "match": { "field": "severity", "op": "eq", "value": "warning" }, "branch": "P2" }], "default": "P3" } } },
    "p1Alerts": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "branch", "op": "eq", "value": "P1" } } },
    "p2Alerts": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "branch", "op": "eq", "value": "P2" } } },
    "p3Alerts": { "type": "derived", "deps": ["classify"], "meta": { "factory": "filterBy", "factoryArgs": { "field": "branch", "op": "eq", "value": "P3" } } },
    "dedupP1": { "type": "derived", "deps": ["p1Alerts"], "meta": { "factory": "dedup", "factoryArgs": { "key": "alertName", "ttlMs": 300000 } } },
    "dedupP2": { "type": "derived", "deps": ["p2Alerts"], "meta": { "factory": "dedup", "factoryArgs": { "key": "alertName", "ttlMs": 300000 } } },
    "scoreP1": { "type": "derived", "deps": ["dedupP1"], "meta": { "factory": "scorer", "factoryArgs": { "weights": { "service_tier": 3, "duration": 2, "affected_users": 1 } } } },
    "scoreP2": { "type": "derived", "deps": ["dedupP2"], "meta": { "factory": "scorer", "factoryArgs": { "weights": { "service_tier": 3, "duration": 2, "affected_users": 1 } } } },
    "gateP1": { "type": "derived", "deps": ["scoreP1"], "meta": { "factory": "budgetGate", "factoryArgs": { "budget": 20, "costField": "score", "resetIntervalMs": 3600000 } } },
    "gateP2": { "type": "derived", "deps": ["scoreP2"], "meta": { "factory": "budgetGate", "factoryArgs": { "budget": 20, "costField": "score", "resetIntervalMs": 3600000 } } },
    "pageP1": { "type": "effect", "deps": ["gateP1"], "meta": { "factory": "sendPagerDuty", "factoryArgs": { "severity": "critical" } } },
    "slackP2": { "type": "effect", "deps": ["gateP2"], "meta": { "factory": "sendSlack", "factoryArgs": { "channel": "#alerts-warning" } } },
    "logP3": { "type": "effect", "deps": ["p3Alerts"], "meta": { "factory": "toClickHouse", "factoryArgs": { "table": "info_alerts" } } }
  }
}
```

### L1 Task prompts

**L1-1 (explain — trace a path):**
```
Here is an existing GraphSpec [paste Graph A]. Explain what happens step-by-step
when an email arrives from "alice@team.com" with subject "Q3 deadline tomorrow".
Trace the path from the inbox producer through every node it touches, and state
what each node outputs.
```

**L1-2 (debug — find bugs):**
```
Here is a GraphSpec for a pricing pipeline [paste Graph B]. The intended behavior
is: "On a 60-second timer, fetch a price from an API. Retry up to 3 times with
exponential backoff. If all retries fail, use the last known cached price. Log
every attempt. Send the final price to a dashboard."

Find all bugs or design issues in this GraphSpec. For each issue, explain what's
wrong and suggest a fix (as a modified node or new node).
```

**L1-3 (modify — add a feature):**
```
Here is an existing GraphSpec [paste Graph A]. The user wants to add this feature:
"Also flag any email whose subject contains the word 'deadline', regardless of
classification, and send those to a separate Slack channel #deadlines."

Return the modified GraphSpec (full JSON). Only add or change what's needed —
don't restructure existing nodes.
```

**L1-4 (diff — review a change):**
```
A teammate changed Graph A. Here is the BEFORE [paste Graph A] and AFTER:

[paste Graph A with these changes: "urgent" filterBy value changed from "urgent"
to "high-priority", new node "summarizeUrgent" (derived, deps: ["urgent"],
fn: "llmSummarize", config: { style: "bullets" }), "pushUrgent" deps changed
from ["urgent"] to ["summarizeUrgent"]]

List every difference between BEFORE and AFTER. For each change, state whether
it's correct, risky, or a bug, and why.
```

**L1-5 (explain — blast radius):**
```
Here is a GraphSpec [paste Graph A]. If the "classify" node starts returning
errors (llmClassify API is down), which other nodes are affected? List every
node that would stop producing correct output, and explain the propagation path.
```

**L1-6 (modify — resilience retrofit):**
```
Here is a GraphSpec [paste Graph A]. The llmClassify API has been unreliable.
Add resilience: retry 2 times with linear backoff, then fall back to a simple
keyword-based classification (use "filterBy" with contains checks as the
fallback). The rest of the pipeline should work the same.

Return the modified GraphSpec (full JSON).
```

**L1-7 (explain — reduction trace):**
```
Here is a GraphSpec for an alert reduction pipeline [paste Graph C]. A critical
alert arrives with severity="critical", alertName="HighCPU", service_tier=3,
duration=120, affected_users=500. Trace the path from the "alerts" producer
through every node it touches. State what each node outputs and what the final
effect is. Then: if 19 alerts have already been sent this hour, what happens
to the 20th critical alert?
```

**L1-8 (modify — add feedback loop):**
```
Here is a GraphSpec for an alert reduction pipeline [paste Graph C]. The ops
team wants to add automatic threshold adjustment: if more than 15 alerts pass
the budget gate in an hour, increase the scorer weights for service_tier to 5
(making it harder for low-tier alerts to pass). Use a feedback loop with max
3 iterations to converge. Return the modified GraphSpec (full JSON).
```

---

### L1 SCORING RUBRIC

Score each L1 output on these criteria (1 = fail, 2 = partial, 3 = pass):

| # | Criterion | How to judge |
|---|-----------|-------------|
| D1 | **Accurate reading** | Does the LLM correctly understand the existing graph's structure and data flow? No misidentified deps, no phantom nodes, no wrong types. |
| D2 | **Complete identification** | For debug/explain tasks: did it find ALL bugs or trace ALL affected nodes? For modify tasks: did it change everything needed and nothing extra? |
| D3 | **Correct fix/modification** | Is the proposed change valid GraphSpec JSON that would actually work? No hallucinated fns, no structural errors. |
| D4 | **Minimal diff** | For modify tasks: did it avoid unnecessary restructuring? Changes should be surgical — only what the task requires. |
| D5 | **Reasoning quality** | Is the explanation clear, specific, and actionable? Does it reference actual node names and data flow, not generic advice? |

### L1 Recording template

```
AI: [model name]
Date: [date]

L1-1 (explain): D1=_ D2=_ D3=n/a D4=n/a D5=_
L1-2 (debug):   D1=_ D2=_ D3=_ D4=n/a D5=_
L1-3 (modify):  D1=_ D2=_ D3=_ D4=_ D5=_
L1-4 (diff):    D1=_ D2=_ D3=n/a D4=n/a D5=_
L1-5 (blast):   D1=_ D2=_ D3=n/a D4=n/a D5=_
L1-6 (retrofit): D1=_ D2=_ D3=_ D4=_ D5=_
L1-7 (reduction trace): D1=_ D2=_ D3=n/a D4=n/a D5=_
L1-8 (add feedback):    D1=_ D2=_ D3=_ D4=_ D5=_

Notes:
```
