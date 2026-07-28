<div align="center" >
<img src="./public/assets/banner.png" />

[![Status](https://img.shields.io/badge/status-in%20development-orange?style=for-the-badge)]()
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)]()
</div>
Klinpi is an AI gateway that sits between your coding tools and LLM providers. Instead of routing every request to the same model, it intelligently distributes work based on task complexity, team policies, cost, and performance constraints. The result: lower API costs without changing how your team works.

This is not a coding assistant. It's infrastructure for coding assistants—a router that lives in the middle and makes routing decisions so you don't have to make them manually.

## Why Klinpi?

The problem: using a single LLM for every task wastes money. Writing a function description doesn't need GPT-4-level reasoning. A search query doesn't need a 128K context window. But detecting what task you're actually doing—and routing it to the right model—requires logic that doesn't exist in most setups.

Klinpi solves this by:

- **Routing based on task type.** Simple completion goes to a fast, cheap model. Complex reasoning goes somewhere with better performance. The decision happens automatically.
- **Enforcing team policies.** Set rules per team, per project, per file type. "Don't use external LLMs for this codebase." "Use local models for customer data." "Claude for security work, GPT for everything else."
- **Tracking cost and performance.** Know how much you're spending per model, per task type, per team. Adjust routing based on real metrics.
- **Reducing manual decisions.** Your developers don't think about model selection. They hit the same request button. Klinpi decides.

## Our Philosophy

We don't believe every task deserves the biggest model.

Most AI coding tools treat every prompt the same, sending everything to expensive models regardless of complexity. We think that's wasteful.

Klinpi is built around a simple idea:

> **Use the right model for the right task.**

Simple edits shouldn't cost premium tokens.
Complex reasoning shouldn't be limited by cheaper models.

By understanding the intent behind every request, Klinpi intelligently routes work to the model that provides the best balance of quality, speed, and cost.

Our goal isn't to replace coding agents.

Our goal is to make them smarter, more efficient, and accessible for every developer and every team.

## Planned Features

- **Smart model routing** — Route based on task complexity, language, file type
- **Policy engine** — Team and project-level routing rules
- **Cost optimization** — Automatic routing to minimize spend while maintaining quality
- **Budget limits** — Per-team, per-project spend caps
- **Multi-provider support** — Claude, GPT-4, local models, custom endpoints
- **Usage analytics** — Track cost, latency, and model performance per team
- **Caching layer** — Reduce redundant requests across team
- **Team management** — Policies, budget allocation, audit logs

## Architecture

## *Diagram and detailed architecture docs coming soon.*

### Development

Placeholder. Will include:
- Local development environment
- Running tests
- Building from source
- Extending with custom policies
