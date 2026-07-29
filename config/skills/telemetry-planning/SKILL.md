---
name: telemetry-planning
description: Treat observability as part of "done" for every feature plan. Trigger this whenever planning a new feature, service, endpoint, background job, migration, or any program; whenever drafting a SCOPE.md, ADR, spec, or any implementation plan; whenever auditing an existing feature for observability gaps; or whenever the user mentions tracing, logs, metrics, OpenTelemetry, OTel, observability, monitoring, instrumentation, or telemetry. Enforces OpenTelemetry as the default standard, all three pillars (tracing + logs + metrics) covered, explicit histogram buckets, low-cardinality-by-default with high-value offers, and sensitive-data redaction that keeps the field name visible. Also triggers on "plan with telemetry", "add observability", "what metrics should we emit".
---

# Telemetry planning — observability is part of "done"

Whenever you plan a new feature, service, endpoint, job, migration, or any work that produces user-visible behavior, observability is part of the plan AND part of the implementation. A feature that ships without telemetry is incomplete — write that into the acceptance criteria, not into a follow-up ticket.

## When this skill must run

- Feature plan / SCOPE.md / ADR / spec / PROMPT.md drafting.
- Designing a new service, endpoint, background job, scheduled task, or migration.
- Refactor that crosses a process boundary, async boundary, or network call.
- Audit of an existing feature for observability gaps.
- Anything the user calls a "feature" or "program".

If you are planning and skipped this skill, restart the plan.

## Three pillars — cover as much as possible

A plan should explicitly name what each pillar carries. "We will have OTel" is not a plan; "we will emit these spans, these logs, these metrics" is.

### Tracing
- One trace per logical operation (request, job invocation, event-handler call).
- One span per meaningful step (DB query, external HTTP call, cache lookup, expensive compute block, queue publish).
- Propagate context across every process and async boundary (W3C `traceparent`/`tracestate` for HTTP, queue headers for async).
- Span attributes: business identifiers (entity ids, tenant id when small), technical attrs (status, durations, byte sizes, error kind).
- Errors: record exception on the span (OTel `RecordException` or language equivalent), set span status to `ERROR`. Do not swallow.

### Logs
- Structured (JSON or key=value), one event per line.
- Correlate with the active trace: emit `trace_id` + `span_id` on every log line.
- Severity discipline: debug for trace-only detail, info for state transitions, warn for recoverable anomalies, error for failures that need eyes.
- Log on state transitions, decisions, and failures — not on every tick. If the span already carries the data, do not duplicate it as a log.

### Metrics
- Counter: monotonically growing values (requests, errors, items processed, retries triggered).
- Gauge: values that go up and down at observation time (queue depth, pool size, active connections, in-flight requests).
- Histogram: distributions (latency, payload size, batch size).
- UpDownCounter: when the value is truly bidirectional (e.g. open connections measured by inc/dec instead of sampling).

## Sensitive data — redact the content, keep the field

Do NOT silently drop PII or secrets. Future debugging needs to know the SHAPE of what flowed through. The field name MUST appear in the trace/log/metric attribute; the value's redaction strategy is decided per tier below. Three tiers act WITHOUT asking (universal defaults), one tier MUST ask.

### Tier A — Always redact (no ask, universal)

Every project, every company, every jurisdiction. Do not ask; just do it. These leak credentials or break the security model on exposure.

- Authentication material of any kind: bearer tokens, JWTs, session cookies, API keys, OAuth access + refresh tokens, signed-URL credentials, webhook signing secrets, MFA codes, recovery codes, password reset tokens.
- Passwords — raw or hashed (the hash is still a credential for offline attack).
- Private keys, key material, certificates with private components, kubeconfig embedded creds.
- Card PAN (raw card number), CVV / CVC, full magnetic stripe / EMV data.
- HTTP headers: `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-Api-Key` and equivalents.
- Any field whose path contains: `token`, `password`, `secret`, `api_key` / `apikey`, `credential`, `auth`, `private_key`, `signing_key`, `webhook_secret`, `bearer`, `cookie`.
- Anything a user or prior rule has labeled "secret".

Marker: `<redacted>` or typed variant (`<redacted:jwt>` / `<redacted:apikey>` / `<redacted:cookie>`). NEVER the value, NEVER a partial reveal, NEVER a fingerprint — a stable hash of a session token is still a session identifier.

### Tier B — Account handles (NOT redacted by default)

These are the FIRST THING support needs when a complaint arrives. Redacting them by default makes debugging from a complaint impossible: "user X says login broken" → you cannot find user X's traces without an out-of-band lookup table that the support team has access to anyway, which moves the value but adds no security. Leave them visible by default.

- Email address — when used as the account handle (the login identity).
- Username / login handle.
- Opaque account / customer / tenant ID (UUIDs, internal numeric IDs).

Reasoning: the handle is the JOIN KEY from "user X reported Y" to the actual trace/log/metric stream. Without it visible in telemetry, every support ticket requires a separate DB lookup before you can even start.

Exception: if the company has an explicit override policy (GDPR-strict EU deployment, healthcare, etc.) that demands these be redacted, escalate to Tier D ask. The plan MUST note "Tier B default applied: `<field>` visible" so reviewers see it was a conscious choice.

### Tier C — KYC-only / regulated PII (redact by default)

Data collected for identity verification or regulatory compliance, with no operational debug use. Redact by default; only un-redact (escalate to Tier D ask) when a specific operational reason exists (e.g. fraud team needs `last4` to triage chargebacks).

- Full name, first name, last name.
- Date of birth, age.
- Government IDs (SSN, NIK, passport, driver's license, tax ID).
- Physical address, postal code beyond country.
- Partial card data (BIN, last4).
- Geolocation / GPS coordinates beyond country / region.
- Other regulator-defined PII (PCI, HIPAA, GLBA fields, etc.).

Marker: same options as Tier A, plus stable fingerprint (`sha256(value)` truncated) is allowed when correlation is needed without exposure.

### Tier D — Ask the user (context-dependent)

Intent determines whether the field is a handle, a fraud signal, or PII. Default cannot be guessed; ASK during planning, per field, what the policy is.

- Phone number — account handle (SMS-auth), KYC-only, or contact-only.
- IP address — fraud / abuse signal vs PII to redact.
- `user_id` when it might be a PII handle (email-shaped) vs an opaque UUID.
- Anything under `user.*` / `customer.*` / `account.*` beyond the explicit Tier B handles.
- User-supplied free text (search queries, comments, descriptions, prompts) — may contain anything.
- Internal employee IDs, audit subject identifiers.
- Override on Tier B (project policy redacts even account handles).
- Override on Tier C (project policy needs a Tier C field visible for ops).

Ask pattern:

> "This feature emits these context-dependent fields: `user.phone`, `client.ip`, `prompt.text`. Per field, what's the policy — (a) full value, (b) partial reveal (e.g. country+last4 / `/24` / first-N-chars), (c) stable hash for correlation, (d) full redact? If the company already has a policy doc, point me at it and I'll codify what's there."

User answers ARE the project's PII contract. Write into the plan AND capture as a project rule (path-scoped to the instrumentation code) via `/promote-rules` so the next session doesn't re-ask.

### Allowed redaction markers

- Literal: `<redacted>`, `<redacted:email>`, `<redacted:jwt>` — when no correlation is needed.
- Stable fingerprint: `sha256(value)` truncated (first 8–12 hex) — when correlation matters but the value must not leak. NOT for Tier A.
- Partial reveal: `card.last4=4242`, `email.domain=acme.io`, `ip.cidr=10.0.0.0/24` — only for Tiers C/D when the user has explicitly picked it.

### Per-plan output

Every Telemetry section MUST list:
1. **Tier A fields present** — name them so reviewers see the universal contract is honored.
2. **Tier B fields kept visible** — name them + state "support-debug default".
3. **Tier C fields redacted** — name them + redaction strategy.
4. **Tier D answers** — each field + chosen strategy (a/b/c/d) + pointer to company policy doc if one exists.
5. **Committed project rule** — which `.agents/rules/<name>.md` codifies the above. If no rule yet, mark as follow-up before merge.

## Histograms — explicit buckets

Default OTel histogram buckets are almost always wrong for your domain (the default latency boundaries jump 0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000 — fine for some HTTP services, useless for sub-millisecond compute or multi-minute jobs). Pick buckets that match the actual distribution you expect.

Worked examples:
- HTTP endpoint where p99 is well under 1s: `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]` ms.
- Hot in-memory operation: `[0.1, 0.5, 1, 5, 10, 50, 100, 500]` ms.
- DB query: `[1, 5, 10, 25, 50, 100, 250, 1000, 5000]` ms.
- Long-running job: `[1, 10, 60, 300, 900, 1800, 3600]` seconds.
- Payload size: `[256, 1024, 4096, 16384, 65536, 262144, 1048576]` bytes.
- Worker batch size: `[1, 5, 10, 25, 50, 100, 500]`.

Set buckets via the OTel Views API (or equivalent aggregation config) — do not hand-tune at every instrumentation site. Document the bucket choice next to the metric definition.

## Cardinality — low by default, offer high when high value

High cardinality (label values that explode the metric time-series count) is the most common observability cost spike. Default to LOW cardinality. Treat any unbounded label as a tripwire.

Default-safe labels (low cardinality):
- `http.method`, `http.status_code` (or `status_class`), `service.name`, `service.version`.
- `endpoint_template` (the matched route, e.g. `/users/:id`) — NEVER the raw path (e.g. `/users/12345`).
- `error.kind` from a bounded enum, `db.system`, `messaging.system`, `cloud.region`.

Never as a metric label (these are fine on spans, which are sampled and bounded):
- `user_id`, `session_id`, `request_id`, `trace_id`.
- Raw URL, raw query string, free-form input.
- Timestamps, generated UUIDs.
- Email, phone, any PII (also breaks the redaction contract above).

When a label is HIGH CARDINALITY but HIGH VALUE (e.g. `tenant_id` in a multi-tenant SaaS where per-tenant SLO is the whole point), OFFER it to the user explicitly. Do not silently add it; do not silently refuse it. Pattern:

> "Adding `tenant_id` as a metric label means O(tenants) time-series per metric. For ~100 tenants this is fine; for ~10k it gets expensive. Options: (a) add as a metric label, (b) keep on spans only (trace cardinality is unbounded but sampled), (c) sample top-N tenants via exemplars, (d) aggregate to tenant tier (free/pro/enterprise) and label that. Recommend (b) unless you need per-tenant alerting."

Default to (b) unless the user picks otherwise. Record the decision in the plan.

## OpenTelemetry as the standard

Use the OpenTelemetry SDK for the language. Reasons that matter:
- Vendor-neutral export (OTLP). You can ship to Tempo, Jaeger, Honeycomb, Grafana Cloud, Datadog, New Relic — by changing config, not code.
- Semantic conventions (`semconv`). Use the documented attribute names (`http.method`, `db.system`, `messaging.destination.name`, etc.) so dashboards, queries, and tools that understand semconv work out of the box.
- Auto-instrumentation libraries exist for most frameworks (HTTP servers, gRPC, common DBs, queues, ORMs). Use them; do not hand-roll context propagation.

Avoid:
- Direct vendor SDKs (Datadog APM, New Relic agent, Sentry tracing) at the instrumentation site. They couple your code to one backend.
- Custom in-house tracing/log/metric format. Context propagation is a solved problem; rolling your own always ends in pain.

If the project already has a non-OTel stack: do NOT rip-and-replace as part of an unrelated feature. Add OTel side-by-side via the OTLP exporter; the old stack stays until a dedicated migration.

## Codify when the stack is clear

Once a project commits to a specific telemetry stack — SDK version, exporter, collector endpoint, backend, naming conventions, redaction list, bucket sets — CAPTURE it as a project-level rule or skill so future sessions stop re-deriving it.

- Path-scoped (instrumentation code lives under specific dirs) → `/promote-rules` → writes `.agents/rules/<name>.md` with `paths:` frontmatter.
- Intent-triggered (e.g. "add a metric", "add a span", "instrument this") → `/promote-skills` → writes `.agents/skills/<name>/SKILL.md`.

Trigger to capture: the moment you have answered the same telemetry stack question twice in this project. Do not wait for the third time.

Minimum content for the captured rule/skill:
1. Which OTel SDK + exporter + collector endpoint.
2. Service name + resource attributes (`deployment.environment`, `service.version`, etc.).
3. Standard attribute names + per-field redaction strategy (the PII contract).
4. Histogram bucket sets per metric family.
5. Cardinality bound list (which labels OK, which not, which high-value escalation paths exist).
6. Any "we use OTel for X but legacy Y for Z" carve-outs.

## In the SCOPE / acceptance criteria

Every feature plan MUST include a Telemetry section answering:

- **Spans:** which spans does this emit? What attributes? Where does context cross a boundary?
- **Logs:** which events get a log line? Severity? Trace correlation confirmed?
- **Metrics:** which counters / gauges / histograms? Bucket choice for histograms. Cardinality bound for every label.
- **Sensitive data:** which fields are sensitive? Redaction strategy per field.
- **High-cardinality offer:** any label that is high-value-but-high-cardinality? Which option (a/b/c/d above) did the user pick?
- **Acceptance:** run the feature, see the expected spans/logs/metrics arrive in the configured backend with the expected attributes. Tests-pass alone is NOT the acceptance check.

A plan that does not have this section is incomplete; restart the planning step.
