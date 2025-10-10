# 🧠 CNStra DevTools Panel — Product Plan (Draft)

## Scope Overview

- Real‑time debugging and observability for CNS instances over WebSocket
- Multi‑app and multi‑CNS support with request/response over WS
- Safe snapshots, replay, and export for reproducible diagnostics

## Connectivity & Protocol

- Auto‑connect to DevTools Server; connection status, reconnect
- Support WS RPCs: `apps:list`, `apps:get-topology`, `apps:get-cns`, `cns:get-neurons|dendrites|collaterals|responses`, `apps:get-stimulations`
- Stream handling: `response-batch`, `stimulation-batch`, `stimulate` (+ acks)
- Multi‑CNS routing: select `appId`/`cnsId`; data loads for the chosen CNS

Status
- Implementation: High (endpoints wired; stimulate routing prefers cnsId → appId)
- Tests: Moderate (server integration tests + example‑app E2E; panel covered by smoke tests; no full protocol matrix)

## Apps & Instances

- Active apps list (name, version, last seen)
- CNS instances per app with picker; quick focus actions

Status
- Implementation: High (apps list, cns picker, persistence to db.cns)
- Tests: Low‑Moderate (UI smoke; selection flow covered indirectly)

## CNS Topology (Graph)

- Large block nodes (name, stim count) with clean layout and collision avoidance
- Labeled edges by collaterals; pan/zoom; scroll indicators; mini‑map (optional)
- Click to open neuron details, filter traces/logs by neuron

Status
- Implementation: High for core (PIXI graph, large blocks, collision guard, pan/zoom)
- Tests: Low (visual; no automated PIXI snapshot tests yet)

## Streams & Trace

- Stimulations page: unified feed of stimulations/responses with filters
- Trace view per `stimulationId`:
  - Order by `hopIndex` (if present) or fallback by timestamp and collateral linkage
  - Step‑by‑step path: neuron → [collateral] → neuron; per‑hop and total duration
- Collapsible JSON viewer for input/output payload and contexts

Status
- Implementation: High (trace + JSON viewer in place; DTO fields ingested)
- Tests: Moderate (DTO mapping tests; no full E2E trace validation yet)

## Signal Injection

- Signal Debugger: collateral picker, editable payload/contexts/options
- Sends `stimulate` with `appId`/`cnsId`; shows `stimulate-accepted/rejected`
- Options: delay, timeout, max hops, allowed names, concurrency

Status
- Implementation: High (panel UI + server forwarding; transport acks)
- Tests: Moderate (transport tests exist; UI path smoke‑tested)

## Snapshots

- Safe snapshot (topology optional), last N stimulations/responses, sanitized `contexts`
- Collapsible JSON, quick key search, size limits
- Diff snapshots (selected metrics/keys)
- Export/Import JSON; schema versioning

Status
- Implementation: Medium-High (viewer/contexts; server-side snapshot export with sanitization; size indicator in UI log; diff/import pending)
- Tests: Low (manual UI; backend export/sanitization covered; size guard warning surfaced in UI log)

## Replay

- Replay per `stimulationId` or grouped session; step‑by‑step with pause/speed/loops
- Accurate payload/contexts reproduction; optional time normalization
- Target the selected `cnsId`; parallel or sequential modes for multiple CNS
- Replay log with per‑step results and timings

Status
- Implementation: Partial (Replay via WS `stimulate` with options; ack/nack feedback; basic replay history list with refresh)
- Tests: Pending (UI handlers only; backend history covered separately)

## Filtering & Search

- Filter by time range, neuron, collateral, errors, duration bands, payload text
- Saved filter profiles, quick toggles

Status
- Implementation: Medium (server supports time-window/pagination; UI now has basic from/to/offset/limit controls for exports; advanced filters/profiles pending)
- Tests: Low-Moderate (server protocol covered; UI filter sanitizer unit-tested)

## Metrics & Perf

- Live metrics: stimulations/sec, p50/p95/max, error rate, memory footprint
- Thresholds/alerts; auto‑limit storage windows

Status
- Implementation: Medium (metrics infra present; alerts/thresholds pending)
- Tests: Low

## UX & Productivity

- Copy id/neuron/collateral; deep links between Graph/Trace/Logs
- Sticky details drawer; theme/scale customization

Status
- Implementation: Medium‑High (copy, deep‑linking basic; customization partial)
- Tests: Low‑Moderate (component smoke)

## Robustness & Safety

- Payload/context sanitization; viewer virtualization for large objects
- Throttling and back‑pressure on high volume
- DTO schema versioning and graceful downgrade

Status
- Implementation: Medium (sanitization and size limits in place; throttle/back‑pressure basic)
- Tests: Low (no stress/perf tests yet)

## Export & Integrations

- Export graph/trace/logs (JSON/CSV/PNG)
- Hooks/API for CI storage of snapshots and replays

Status
- Implementation: Partial
  - Server: JSON export endpoints available (topology, stimulations, responses)
  - Panel UI: Download actions pending (wire to export endpoints)
- Tests: N/A (frontend; backend export covered separately)

Status
- Implementation: Planned (not implemented)
- Tests: N/A

## Errors & Diagnostics

- Toasts and diagnostics panel for protocol, replay, and injection issues
- Anomaly hints (unknown neurons/collaterals, missing hopIndex) with guidance

Status
- Implementation: Medium-High (error-centric filters in UI: Only errors, error text; live replay log; error count badge; quick exports for errors)
- Tests: Low (UI); Server filters covered by integration tests

## Type Safety

- Strict TypeScript, no `any` in ingest/DTO layers
- Type guards for network messages; safe handling of `unknown` in viewers

Status
- Implementation: High (ingest and DTO paths strict; remaining casts isolated in viewer inputs)
- Tests: Lint/type checks green; no dedicated type‑tests

---
Status: draft · Owner: DevTools Team · Version: 0.1
