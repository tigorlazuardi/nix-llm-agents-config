---
name: telemetry-planning
description: Scale observability to operational need. Use when planning a daemon, long-running app, service, endpoint, background job, or migration; when auditing observability gaps; or when the user mentions logs, tracing, metrics, OpenTelemetry, OTel, monitoring, instrumentation, or telemetry. Small apps default to useful logs; consider OpenTelemetry when runtime duration, process boundaries, or operational complexity justify it.
---

# Telemetry planning — match operational weight

Choose the smallest observability level that can diagnose likely failures:

1. **Small or short-lived app:** useful logs are enough. Do not add OpenTelemetry, collectors, exporters, traces, or metrics without a concrete operational need.
2. **Daemon or long-running app:** consider OpenTelemetry. Adopt only the signals needed for restart diagnosis, latency, throughput, saturation, cross-process correlation, or alerting.
3. **Distributed or operationally critical system:** prefer OpenTelemetry for vendor-neutral context propagation and correlated signals.

Observability is part of done; OpenTelemetry is not automatically part of done.

## When this skill must run

- Designing a daemon, long-running service, endpoint, background job, scheduled task, or migration.
- Refactor crossing a process, async, queue, or network boundary.
- Audit of existing logs, traces, metrics, or monitoring gaps.
- User explicitly asks about observability or telemetry.

For small feature plans, add only the log/error behavior needed to debug the feature. No mandatory telemetry section.

## Signals — select only what earns its cost

Name only selected signals and why each exists. "We will have OTel" is not a plan.

### Tracing — when operation flow crosses meaningful boundaries
- One trace per logical operation (request, job invocation, event-handler call).
- One span per meaningful step (DB query, external HTTP call, cache lookup, expensive compute block, queue publish).
- Propagate context across every process and async boundary (W3C `traceparent`/`tracestate` for HTTP, queue headers for async).
- Span attributes: business identifiers (entity ids, tenant id when small), technical attrs (status, durations, byte sizes, error kind).
- Errors: record exception on the span (OTel `RecordException` or language equivalent), set span status to `ERROR`. Do not swallow.

### Logs — default for small apps
- Structured (JSON or key=value), one event per line when practical.
- When a trace is active, emit `trace_id` + `span_id` on every log line.
- Severity discipline: debug for trace-only detail, info for state transitions, warn for recoverable anomalies, error for failures that need eyes.
- Log on state transitions, decisions, and failures — not on every tick. If the span already carries the data, do not duplicate it as a log.

### Metrics — when trends, SLOs, or alerts need aggregation
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

When selected logs, traces, or metrics contain sensitive fields, list relevant fields only:
1. **Tier A fields present** — always name and redact them.
2. **Tier B fields kept visible** — name them + state "support-debug default".
3. **Tier C fields redacted** — name them + redaction strategy.
4. **Tier D answers** — each field + chosen strategy (a/b/c/d) + policy pointer when one exists.

Capture a project rule only when policy will recur; do not create one for a one-off small app.

## Histograms — only when metrics are selected

Default OTel histogram buckets are often wrong for the domain. If a histogram is justified, pick buckets matching the expected distribution.

Worked examples:
- HTTP endpoint where p99 is well under 1s: `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]` ms.
- Hot in-memory operation: `[0.1, 0.5, 1, 5, 10, 50, 100, 500]` ms.
- DB query: `[1, 5, 10, 25, 50, 100, 250, 1000, 5000]` ms.
- Long-running job: `[1, 10, 60, 300, 900, 1800, 3600]` seconds.
- Payload size: `[256, 1024, 4096, 16384, 65536, 262144, 1048576]` bytes.
- Worker batch size: `[1, 5, 10, 25, 50, 100, 500]`.

Set buckets via the OTel Views API (or equivalent aggregation config) — do not hand-tune at every instrumentation site. Document the bucket choice next to the metric definition.

## Cardinality — only when metrics are selected

High cardinality (label values that explode the metric time-series count) is the most common observability cost spike. For selected metrics, default to LOW cardinality. Treat any unbounded label as a tripwire.

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

## OpenTelemetry when escalation is justified

When tracing or metrics justify instrumentation infrastructure, prefer the language's OpenTelemetry SDK. Reasons that matter:
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

For a small app, put log behavior beside the feature acceptance criteria: important state transitions, actionable errors, output destination, and sensitive-field handling. Skip a separate Telemetry section when logs are the only signal.

For a daemon, long-running app, or distributed system, record the observability decision:

- **Why OTel is or is not justified.** Runtime duration alone triggers consideration, not mandatory adoption.
- **Logs:** events, severity, destination, and trace correlation when tracing exists.
- **Spans:** only selected operations, attributes, and context boundaries.
- **Metrics:** only selected counters/gauges/histograms, buckets, and cardinality bounds.
- **Sensitive data:** fields and redaction strategy for every selected signal.
- **Acceptance:** observe each selected signal at its actual destination. Do not demand spans or metrics that the plan intentionally omitted.
