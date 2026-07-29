# Zipline Operations Intelligence

Live operations dashboard built from the synthetic commercial drone-delivery
practice pack. It includes:

- fleet status for all 24 aircraft;
- order, merchant-readiness, and preflight views;
- a persistent prioritized issue queue with notifications;
- four replay scenarios derived from the supplied datasets;
- deterministic policy checks and human-decision guardrails;
- a LangGraph-orchestrated OpenAI Responses API recommendation selector.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npx tsc --noEmit
```

## OpenAI recommendation selector

Without an API key, the recommendation field remains empty and reports that
OpenAI is not configured. To enable the OpenAI selection step, set:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna
```

The API may only select from action IDs already allowed by the deterministic
policy engine. Its rule IDs and evidence IDs are validated before the result is
shown. There is no fabricated local recommendation when the API is unavailable.

## Refresh replay data

The generated replay snapshot is stored in `app/data/live-scenarios.json`.
After changing the source practice pack, run:

```bash
python scripts/build_demo_data.py
```

## Safety boundary

The dashboard never labels a flight safe, passed, cleared, or authorized.
Policy findings and priorities are computed in code. Every release decision
belongs to a human operator.
