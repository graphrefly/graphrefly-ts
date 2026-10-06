---
name: graph-animation
description: "Create GraphReFly concept explanation videos using HyperFrames. Use when asked to generate animated diagrams of reactive graph topologies — node activations, START/DIRTY/DATA/COMPLETE message flow, diamond resolution, batch mode, operators, etc. Supports two modes: default = concept-explainer (captioned, beat-structured, 30–90s); `--mode ambient-hero` = silent looping landing-page background (8-stage canonical storyboard, ~42s seamless loop). Invokes /hyperframes for composition authoring and /gsap for deterministic animation. Run /hyperframes-cli for preview/render commands."
argument-hint: "[--mode ambient-hero] [concept to animate, e.g. 'diamond resolution', 'batch mode', 'node lifecycle']"
---

Read and follow [the maintained graph-animation workflow](../../../.agents/skills/graph-animation/SKILL.md).
Resolve that path relative to this file and pass the user request and arguments through unchanged.
This entrypoint has no separate protocol, decision, work, or review policy.
