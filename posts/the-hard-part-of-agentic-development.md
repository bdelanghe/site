---
title: The hard part of agentic development isn't the agents
date: 2026-06-22
description: Writing code was never the bottleneck. Keeping a hundred agent-authored pieces honest against each other is — and that's a contract-enforcement problem, not a code-generation one.
tags: [capability-security, agent-infra, contracts]
---
Everyone is racing to make AI agents write more code. That race is almost over, and it was the wrong race. Writing code was never the bottleneck. The bottleneck is the one nobody is naming: keeping a hundred agent-authored pieces honest against each other while they all change at once.

Let me back up and say how I think this actually works.

## Good systems bifurcate

When a codebase grows well, it doesn't grow as one big thing. It splits. A good idea earns its own bounded abstraction — a module with a name, a defined contract, a clear edge. I call this bifurcation, and it's the single most important thing for working with agents, because **a bounded abstraction with a contract is exactly the thing you can scope an agent to.**

You can't hand an agent "the codebase" and get something trustworthy. You can hand it one bounded thing with a contract — *here is the input shape, here is the output shape, here is the one effect you're allowed to have* — and now the agent has a box it can't reach outside of. Scope is what makes agent work safe. Contracts are what make scope real.

## The part nobody is solving

Once you have many bounded, agent-authored abstractions, they have to stay honest *against each other* — and they're all evolving in parallel. Module A promises something. Module B was built assuming that promise. An agent changes A — correctly, within A's contract, tests green — and silently breaks the assumption B was standing on. Nothing catches it, because what was violated wasn't inside any one contract. It was the agreement *between* contracts.

That's the actual frontier: not "can the agent write the function" — it can — but "can we keep the agreements between a hundred functions from rotting while a hundred agents rewrite them."

## My answer: make the boundary enforceable

This is the bet behind {{org}} — **{{thesis}}** Bind every privileged effect to a signed owner, enforced in CI. And make drift a build failure: one source of truth projected to every surface, red build when they desync. That last move is the whole game — it turns "keep the contracts honest" from a discipline into a guarantee.

The claims here are graded against running code: [prx]({{proof.prx}}), [guest-room]({{proof.guest-room}}), [ocap-provenance]({{proof.ocap-provenance}}). I'd rather you check than trust me.

If you're working on this, reach me at {{email}}.
