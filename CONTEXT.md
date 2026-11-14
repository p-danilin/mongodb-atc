# Hackathon Context

**Event:** Agents in Context Toronto — a MongoDB Hackathon (Cerebral Valley)
**Source:** https://cerebralvalley.ai/e/mongodb-toronto-hackathon/details
**Venue:** The Quay, 100 Queens Quay E, 3rd Floor, Toronto (~15 min walk from Union Station)
**Date:** Saturday, Nov 14 — hacking 10:45 AM → **submissions due 5:00 PM ET**

## Problem statements (project MUST fit one)

### 1. Agents You Can Audit

Agent that takes real actions across systems, with MongoDB Atlas as the **identity, policy and audit layer** (collections, schema validation, change streams). Every action is tied to an identity, checked against policy _before_ it runs, and recorded so a reviewer can reconstruct it.

- Decide and enforce what the agent may do before acting
- Record what it did, why, under whose authority
- Stop or roll back mid-run
- e.g. claims-handling agent with per-step policy gates + queryable compliance ledger; KYC-refresh agent blocked from out-of-scope accounts

### 2. Memory You Can Govern

Agent using Atlas + **Vector Search** to persist/retrieve memory that changes behavior on the next run, with rules for who can read each memory, how long it lives, and how it's corrected/forgotten.

- Prevent cross-client/team memory leakage
- Fix or drop wrong/expired memories
- Prove memory changed behavior (not just filled the prompt)
- e.g. advisor-prep agent scoped per client & advisor; incident-triage agent remembering past fixes with expiry

### 3. Finish the Job

Agent completing a long multi-step task across several systems, using Atlas to persist **verified task state** and Vector Search to retrieve past experience, surviving crashes and system changes.

- Distinguish actions that took effect vs. merely sent
- Resume after crash without replaying full history
- Adapt when a system's layout/fields/workflow changes
- e.g. address-change agent that retries only the failed update when one system refreshes mid-run; month-end reconciliation resuming from checkpointed state

## Rules

- **Finalists must use the provided MongoDB Atlas Sandbox** (invite link sent by email) — otherwise ineligible for finals/prizes
- Repo must be **public**
- Max 4 per team; solo allowed
- New work only; demo must clearly show what was built during the event (else disqualified)
- No code/data/assets you lack rights to

**Banned / anti-projects:** AI mental health advisor, basic RAG apps, Streamlit apps, image analyzers, "AI for Education" chatbots, AI job-application screeners, AI nutrition coaches, personality analyzers, AI medical advice, **projects where a dashboard is the main feature**, sports analyzers/coaches.

## Submission

- Submit via Cerebral Valley form: includes a **~1 minute demo video** of features built during the hackathon
- Check: repo public, demo link accessible, all teammates added

## Judging

Round 1: ~3 min live demo + 1–2 min Q&A

- **Technical Demo — 35%** (impressive, well-engineered, working)
- **Implementation Difficulty — 30%** (more than a few prompts away)
- **Impact Potential — 20%**
- **Creativity — 15%**

Round 2 (top 6, on stage): 3 min demo + 2 min Q&A, same criteria, equal weighting.

## Resources (from the official resource guide)

Theme: agents that hold context across sessions, adapt their own guardrails, and run reliably under real workloads — with **MongoDB Atlas as the data, memory and state layer**.

### MongoDB — recommended setup (do first)
1. [MongoDB Agent Skills](https://www.mongodb.com/docs/agent-skills/) — best-practice instructions for AI coding assistants
2. [MongoDB MCP Server](https://www.mongodb.com/docs/mcp-server/get-started/) — lets the coding assistant query/manage the live Atlas cluster
3. [Natural Language → MongoDB Queries](https://www.mongodb.com/docs/manual/natural-language-to-mongodb/) — prompting guide

Also: **Atlas Managed MCP Server** (hosted, uses Atlas service accounts — no local MCP infra; usable by our agent at runtime).

### Data & search
- [Vector Search](https://www.mongodb.com/products/platform/atlas-vector-search) · [Atlas Search](https://www.mongodb.com/docs/atlas/atlas-search/) (keyword, typo-tolerant)
- [Automated Embeddings](https://www.mongodb.com/company/blog/product-release-announcements/unlocking-ai-search-introducing-automated-embedding-in-mongodb-vector-search) — DB generates/maintains embeddings, no separate pipeline
- [Embedding & Reranking API](https://www.mongodb.com/docs/api/doc/atlas-embedding-and-reranking-api/)
- [Data Modeling](https://www.mongodb.com/docs/manual/data-modeling/#data-modeling) · [Sample mflix dataset](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix)

### Memory, state, agents
- [LangGraph + Atlas agent](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph/build-agents/) — thread checkpoints & persistence (MongoDB checkpointer)
- [State & Persistence: Agent Reliability](https://www.mongodb.com/company/blog/technical/state-persistence-the-problem-of-agent-reliability) — checkpoints, suspend/resume, crash recovery, state vs. memory (key read for #3)
- [Agent with memory + function calling](https://www.mongodb.com/developer/products/atlas/interactive-rag-mongodb-atlas-function-calling-api/)
- Chat memory with LangChain: [Python](https://www.mongodb.com/developer/products/atlas/advanced-rag-langchain-mongodb/) · [JS](https://www.mongodb.com/developer/products/atlas/add-memory-to-javascript-rag-application-mongodb-langchain/)
- [Build AI Agents with MongoDB](https://www.mongodb.com/docs/atlas/ai-agents/) · [GraphRAG + LangChain](https://www.mongodb.com/docs/atlas/ai-integrations/langchain/graph-rag/)

### Starter code
- [GenAI Showcase](https://github.com/mongodb-developer/GenAI-Showcase/tree/main) (many frameworks/languages)
- [Python quickstart notebook](https://github.com/mongodb-developer/mongodb-atlas-python-quickstart/blob/main/quickstart-1-getting-started-atlas-python.ipynb) · [MERN starter](https://github.com/mongodb-developer/mern-stack-example)

### Partner credits (must be checked in on the CV platform)
- **Voyage AI** — 200M free tokens for embeddings + rerankers; team on-site. Sign up at [dashboard.voyageai.com](https://dashboard.voyageai.com/), create API key, add payment method for Tier 1 rate limits (not charged within allowance). `pip install voyageai`. [Quickstart](https://docs.voyageai.com/docs/quickstart-tutorial)
- **LangChain** — $50 LangSmith credits + Deployments; [redeem form](https://airtable.com/appzjKToipPcn2dKI/pagTsO0Ld3edczsrV/form) within 10 days (card required, not charged). [LangGraph docs](https://docs.langchain.com/oss/python/langgraph/overview) · [Deep Agents quickstart](https://docs.langchain.com/oss/python/deepagents/quickstart)
- **ElevenLabs** — 1 month Creator plan free; redeem via ElevenLabs Discord #coupon-codes ("Start Redemption", use CV-registered email). Separate prize for best ElevenLabs project.

### Logistics
- Submission on CV platform: public GitHub repo link, **1-min demo video (check audio!)**, concise project description, all teammates added
- Discord: #announcements, #rules, #questions (ping @CV)
- Wi-Fi: TRBOT-Guest
