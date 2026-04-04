---
title: "GraphReFly vs Vercel AI SDK"
description: "Both handle LLM streaming — Vercel AI SDK provides React hooks for chat UIs; GraphReFly provides a full reactive graph for streaming state, orchestration, and multi-model coordination."
---

Both handle LLM streaming. Vercel AI SDK provides React hooks for chat UIs; GraphReFly provides a full reactive graph for streaming state, orchestration, and multi-model coordination.

## At a Glance

| Feature | Vercel AI SDK | GraphReFly |
|---------|--------------|------------|
| **Core abstraction** | React hooks (`useChat`, `useCompletion`) | Reactive nodes + operators |
| **Streaming** | Built-in (provider-based) | `producer()` + `switchMap` + `scan` |
| **State model** | React state (`useState`) | Framework-agnostic reactive graph |
| **Framework** | React/Next.js first | Framework-agnostic (React, Vue, Svelte, Solid, NestJS) |
| **Provider support** | OpenAI, Anthropic, Google, etc. | Any (bring your own fetch) |
| **Local/Edge LLMs** | Limited (experimental) | First-class (`producer` wraps any streaming API) |
| **Tool calling** | Built-in | `toolRegistry()` — composable |
| **Multi-model** | Provider switching | Conditional routing + `rescue()` |
| **Diamond resolution** | None (React re-renders) | Glitch-free two-phase push |
| **Composable operators** | None | 70+ (debounce, retry, buffer, ...) |
| **Graph inspection** | None | `graph.describe()` / `graph.observe()` |
| **Orchestration** | None | `pipeline()`, `gate()`, `checkpoint()` |
| **Bundle size** | ~15 KB+ | ~5 KB core (tree-shakeable) |

## The Key Difference

Vercel AI SDK wraps LLM APIs in React hooks. GraphReFly is a reactive graph engine — LLM streams are just one type of source that composes with state, derived values, operators, and effects.

```ts
// Vercel AI SDK — React hook
const { messages, input, handleSubmit, isLoading } = useChat({
  api: '/api/chat'
})

// GraphReFly — framework-agnostic reactive graph
import { state, pipe, filter, switchMap, producer, scan, derived } from "@graphrefly/graphrefly-ts";

const prompt = state('')
const tokens = pipe(prompt, filter(p => p.length > 0), switchMap(p =>
  producer(({ emit, complete }) => {
    streamChat(p, emit, complete)
    return () => abort()
  })
))
const response = pipe(tokens, scan((acc, t) => acc + t, ''))
const tokenCount = derived([response], () => estimateTokens(response.get()))
```

## What Vercel AI SDK Lacks

### 1. Framework independence

`useChat` is a React hook. It doesn't work in Node.js, edge functions, Svelte, Vue, or vanilla JS. GraphReFly works everywhere — it is framework-agnostic with adapters for React, Vue, Svelte, Solid, and NestJS.

### 2. Composable operators

Vercel AI SDK has no way to debounce, throttle, buffer, or retry at the stream level. GraphReFly has 70+ operators that compose freely.

### 3. Multi-model coordination

Switching between models in Vercel AI SDK requires changing provider configuration. GraphReFly's conditional routing + `rescue()` enables confidence-based routing with automatic fallback.

### 4. Local/Edge LLM support

Vercel AI SDK is optimized for cloud API providers. GraphReFly wraps any streaming source — Ollama, WebLLM, ExecuTorch, or custom inference servers.

### 5. Derived state

Vercel AI SDK has no concept of derived/computed values. Token counts, context window tracking, conversation summaries — all manual. GraphReFly's `derived()` computes them reactively.

### 6. Orchestration

Vercel AI SDK has no pipeline, checkpoint, gate, or execution logging. GraphReFly's orchestration layer provides durable workflows for agentic systems.

### 7. Graph inspection

No way to see the reactive state graph. GraphReFly's `graph.describe()` and `graph.observe()` show every node, value, and dependency edge.

## What Vercel AI SDK Does Better

- **Zero-config React** — `useChat` just works with Next.js + API routes
- **Provider abstraction** — unified API across OpenAI, Anthropic, Google, Cohere, etc.
- **Structured output** — `generateObject()` with Zod schema validation
- **AI SDK UI** — pre-built components for chat, completion, and streaming
- **Edge runtime** — optimized for Vercel's edge runtime
- **Tool calling** — declarative tool definitions with automatic invocation

## When to Choose GraphReFly

- You need framework independence (not just React/Next.js)
- You need composable streaming operators (debounce, retry, buffer)
- You need local/edge LLM support (Ollama, WebLLM)
- You need multi-model routing with automatic fallback
- You need derived state (token tracking, context window management)
- You need orchestration (pipelines, checkpoints, human-in-the-loop)
- You want graph inspectability for debugging AI agent behavior
