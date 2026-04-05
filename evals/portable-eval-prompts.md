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
data pipeline. A GraphSpec is a JSON object with a single "nodes" key.

Each node has:
- "type": One of "producer" (data source), "state" (mutable value),
  "derived" (computed from deps), "effect" (side effect triggered by deps)
- "deps": Array of node names this node depends on
  (required for derived and effect)
- "fn": String reference to a function name (required for derived and effect)
- "source": String reference to a data source name (required for producer)
- "config": Optional freeform object for configuration
- "initial": Optional initial value (for state nodes)

Edges are implicit from deps. Do not include an edges array.

Available functions (use ONLY these):
- filterBy: Filter items by condition. Config: { field, op: "eq"|"gt"|"lt"|"contains", value }
- mapFields: Transform record fields. Config: { mapping: { out: "in" } }
- normalize: Normalize data shape
- groupBy: Group items by field. Config: { field }
- aggregate: Aggregate values. Config: { op: "sum"|"avg"|"count"|"min"|"max", field }
- rollingAvg: Running average over window. Config: { windowSize }
- computeAverage: Average of array
- batchEvents: Collect into batches. Config: { size, intervalMs }
- merge: Combine multiple inputs. Config: { strategy: "concat"|"zip"|"object" }
- formatResults: Format data. Config: { format: "json"|"csv"|"markdown" }
- generateReport: Generate report from data sources
- llmClassify: AI classification. Config: { categories: string[] }
- llmSummarize: AI summarization. Config: { maxLength?, style?: "bullets"|"paragraph" }
- llmExtract: AI extraction. Config: { schema }
- thresholdCheck: Check value against threshold. Config: { threshold, direction: "above"|"below" }
- retry: Retry on failure. Config: { maxAttempts, backoff?: "exponential"|"linear", fn?: "fnToRetry" }
- fallback: Use fallback on error. Config: { fallbackValue? }
- dedup: Deduplicate stream. Config: { key?, ttlMs? }
- cache: Cache values. Config: { ttlMs? }
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

// Transformations
declare function filterBy<T>(items: T[], predicate: (item: T) => boolean): T[];
declare function mapItems<T, U>(items: T[], fn: (item: T) => U): U[];
declare function groupBy<T>(items: T[], key: keyof T): Record<string, T[]>;
declare function aggregate<T>(items: T[], fn: (acc: any, item: T) => any, initial: any): any;
declare function validateSchema(data: unknown, schema: object): { valid: boolean; errors: string[] };
declare function normalizeFields(data: Record<string, any>): Record<string, any>;
declare function classifyText(text: string, categories: string[]): Promise<string>;
declare function summarizeText(text: string): Promise<string>;

// Effects
declare function sendSlackMessage(channel: string, message: string): Promise<void>;
declare function sendEmail(to: string, subject: string, body: string): Promise<void>;
declare function sendPushNotification(message: string): Promise<void>;
declare function writeToDatabase(table: string, data: any): Promise<void>;
declare function uploadToS3(bucket: string, key: string, data: any): Promise<void>;
declare function logToAudit(entry: any): Promise<void>;
declare function updateDashboard(dashboardId: string, data: any): Promise<void>;
declare function sendPagerDutyAlert(severity: string, message: string): Promise<void>;

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

After scoring all 7 tasks × 2 treatments:

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

Notes:
```
