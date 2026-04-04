---
title: "GraphReFly vs LangGraph.js"
description: "Comparing GraphReFly and LangGraph.js for AI agent orchestration — reactive nodes vs state dictionaries, built-in observability, and streaming."
---

Both GraphReFly and LangGraph.js orchestrate AI agent workflows with graph semantics. GraphReFly uses reactive nodes with automatic dependency resolution; LangGraph uses state dictionaries and channel-based message passing with explicit edge definitions.

## At a Glance

| Feature | LangGraph.js | GraphReFly |
|---------|-------------|------------|
| **State** | State dictionary (`Annotation`) | Reactive nodes (`.get()`/`.set()`) |
| **Graph edges** | `addEdge()` / `addConditionalEdge()` | `derived()` deps — implicit from dependency graph |
| **Conditional routing** | `addConditionalEdge(fn)` | `dynamicNode(get => ...)` or conditional `derived()` |
| **Human-in-the-loop** | `interrupt()` with checkpoint | `gate()` — reactive approve/reject |
| **Streaming** | `.stream()` on graph invocation | Native — every node is a stream |
| **Observability** | LangSmith (paid SaaS) | `graph.describe()` / `graph.observe()` (free, built-in) |
| **Diamond resolution** | N/A (explicit edges) | Glitch-free topological resolution |
| **Framework** | Node.js / Deno | Framework-agnostic with adapters for React, Vue, Svelte, Solid, NestJS |
| **Bundle** | ~100 KB+ (with LangChain deps) | ~5 KB core (tree-shakeable) |

## Key Difference

LangGraph models agent workflows as a **state machine** — you define nodes as functions that transform a shared state dict, then wire them together with explicit edges and conditional routing. The graph is a control-flow structure that you invoke and run to completion.

GraphReFly models agent workflows as a **reactive dependency graph** — you define state nodes that hold values, derived nodes that compute from dependencies, and effects that perform side effects. The graph is always live: when any input changes, dependent nodes recompute automatically. There is no "invoke" step — the graph reacts.

## Code Comparison

### LangGraph.js Approach

```ts
import { StateGraph, Annotation } from '@langchain/langgraph';

const AgentState = Annotation.Root({
  input: Annotation<string>,
  plan: Annotation<string>,
  result: Annotation<string>,
  approved: Annotation<boolean>,
});

const graph = new StateGraph(AgentState)
  .addNode('planner', async (state) => {
    const plan = await llm.invoke(`Plan: ${state.input}`);
    return { plan: plan.content };
  })
  .addNode('executor', async (state) => {
    const result = await llm.invoke(`Execute: ${state.plan}`);
    return { result: result.content };
  })
  .addNode('reviewer', async (state) => {
    return { approved: state.result.length > 10 };
  })
  .addEdge('__start__', 'planner')
  .addEdge('planner', 'executor')
  .addEdge('executor', 'reviewer')
  .addConditionalEdge('reviewer', (state) =>
    state.approved ? '__end__' : 'planner'
  )
  .compile();

const result = await graph.invoke({ input: 'Build a TODO app' });
```

### GraphReFly Approach

```ts
import { state, derived, effect, dynamicNode } from '@graphrefly/graphrefly';
import { gate } from '@graphrefly/graphrefly/extra';
import { Graph } from '@graphrefly/graphrefly';

const g = new Graph('agent');

const input = g.add(state('Build a TODO app'), 'input');

const plan = g.add(
  derived([input], async (input) => {
    const response = await llm.invoke(`Plan: ${input}`);
    return response.content;
  }),
  'plan'
);

const executorResult = g.add(
  derived([plan], async (plan) => {
    const response = await llm.invoke(`Execute: ${plan}`);
    return response.content;
  }),
  'result'
);

// Human-in-the-loop: gate blocks until approval signal
const approval = g.add(state(false), 'approval');
const approved = g.add(gate(executorResult, approval), 'approved-result');

// Reactive: change input and the entire pipeline re-executes
input.set('Build a chat app');

// Inspect the full graph at any time
console.log(g.describe());
```

### Human-in-the-Loop

LangGraph uses `interrupt()` with checkpoint persistence to pause graph execution and wait for human input. GraphReFly uses `gate()` — a reactive operator that holds a value until a control signal allows it through:

```ts
import { state } from '@graphrefly/graphrefly';
import { gate } from '@graphrefly/graphrefly/extra';

const aiResult = state(''); // populated by AI
const humanApproval = state(false); // human sets this

// gatedResult only emits when humanApproval is true
const gatedResult = gate(aiResult, humanApproval);

// AI produces output
aiResult.set('Generated plan: step 1, step 2, step 3');

// Nothing downstream fires yet — gate is closed
gatedResult.get(); // undefined

// Human approves
humanApproval.set(true);

// Now gatedResult flows through
gatedResult.get(); // "Generated plan: step 1, step 2, step 3"
```

### Observability

LangGraph relies on LangSmith, a paid SaaS platform, for tracing and observability. GraphReFly includes observability as a built-in, free primitive:

```ts
import { Graph } from '@graphrefly/graphrefly';

const g = new Graph('agent');
// ... add nodes ...

// Snapshot the entire graph structure, values, and metadata
const snapshot = g.describe();
// {
//   nodes: [{ path: "input", type: "state", value: "..." }, ...],
//   edges: [{ from: "input", to: "plan" }, ...],
//   metadata: { nodeCount: 4, ... }
// }

// Observe changes reactively
const observer = g.observe();
// Streams node updates, errors, completions in real-time
```

This built-in observability is particularly valuable for AI agent workflows where you need to understand what the graph is doing, debug agent decisions, or feed graph state back into an LLM for self-reflection.

## What LangGraph Lacks

- **Reactive state.** LangGraph's state dict is a snapshot passed between node functions — there is no reactive subscription or automatic recomputation. Changing an input requires re-invoking the entire graph.
- **Diamond resolution.** LangGraph uses explicit edges, so diamond patterns require manual wiring. GraphReFly resolves diamond dependencies automatically and glitch-free.
- **Built-in streaming operators.** LangGraph's `.stream()` is graph-level output streaming. GraphReFly's streaming is per-node — every node is a stream, and operators like `debounce`, `throttle`, and `scan` compose naturally.
- **Free observability.** LangGraph's observability story is LangSmith, a paid external service. GraphReFly's `graph.describe()` and `graph.observe()` are built-in, free, and work offline.
- **Framework independence.** LangGraph is backend-only (Node.js/Deno). GraphReFly runs anywhere — browser, server, edge — with adapters for React, Vue, Svelte, Solid, and NestJS.

## What LangGraph Does Better

- **LangChain integration.** LangGraph is part of the LangChain ecosystem with native support for LangChain tools, agents, retrievers, and memory. If you are already in the LangChain ecosystem, LangGraph plugs in seamlessly.
- **Pre-built agent patterns.** LangGraph provides high-level agent architectures (ReAct, plan-and-execute, multi-agent supervisor) out of the box. GraphReFly gives you the primitives to build these patterns, but you wire them yourself.
- **Cloud deployment.** LangGraph Cloud offers managed deployment, scaling, and thread management for agent workflows. GraphReFly is a library — you manage your own deployment.
- **Thread management.** LangGraph has built-in conversation thread persistence and checkpointing. GraphReFly's checkpoint capabilities exist at the node level, but full thread management is an application-layer concern.

## When to Choose GraphReFly

Choose GraphReFly when your AI agent workflow needs:

- **Reactive, always-live state** — inputs change and the graph recomputes automatically, no re-invocation required
- **Fine-grained streaming** — per-node streaming with composable operators, not just graph-level output streaming
- **Free, built-in observability** — `graph.describe()` for snapshots, `graph.observe()` for real-time monitoring, no external service required
- **Framework flexibility** — the same agent logic running in a React frontend, NestJS backend, or edge function
- **Lightweight footprint** — ~5 KB core vs ~100 KB+ for LangGraph with LangChain dependencies
- **Human-LLM co-operation** — reactive `gate()` for human-in-the-loop, with the LLM itself able to inspect and reason about graph state via `graph.describe()`

For teams already invested in LangChain with complex pre-built agent patterns and managed cloud deployment needs, LangGraph is the more integrated choice.
