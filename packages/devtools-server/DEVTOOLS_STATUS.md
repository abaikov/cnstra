# 🧠 @cnstra/devtools-server — Implementation & Test Coverage

## Message Handling & Routing

- Handles: `init`, `response-batch`, `stimulation`, `stimulate`, `apps:get-topology`, `apps:get-stimulations`, `apps:list`, `apps:get-cns`, `cns:get-*`
- `stimulate` routing: prefer `cnsId` → all CNS by `appId` → broadcast fallback

Status
- Implementation: High (repo‑agnostic in‑memory store + routing)
- Tests: High‑Moderate (topology return, stimulation/response handling; routing smoke)

## Topology & Caching

- Stores last init per CNS; maps `cnsByApp`; caches neurons/collaterals/dendrites/responses by cnsId
- Serves topology and recent records with limits

Status
- Implementation: High
- Tests: Moderate (in‑memory repository integration; limits smoke)

## Acknowledgements & Streams

- Forwards `stimulate-accepted/rejected` to clients; streams `stimulation-batch`

Status
- Implementation: Medium‑High (acks passthrough; streaming works)
- Tests: Moderate (integration with example‑app)

## Replay History

- Server tracks `stimulate` commands per app with timestamps and ack result
- Endpoint: `apps:get-replays` (supports from/to/offset/limit)

Status
- Implementation: High (in-memory ring per app, capped; ack correlation)
- Tests: Added (integration checks for accepted results and retrieval)

## Export & Integrations

- JSON export over WS:
  - `apps:export-topology` (optionally by appId)
  - `apps:export-stimulations` (from/to/offset/limit)
  - `cns:export-responses` (from/to/offset/limit)
  - `apps:export-snapshot` (topology + recent stimulations/responses with limits)

Status
- Implementation: High (server endpoints wired with shared filtering)
- Tests: Added (export window/pagination, snapshot shape, sanitization/size); size guard warning added when >5MB

## Type Safety & DTOs

- Uses DTO contracts; tolerant parsing for legacy/new fields (appId/cnsId)

Status
- Implementation: High (guards; optional legacy fields)
- Tests: Lint/type checks green

## Repository Abstraction

- In‑memory repository with `upsertApp`, `listApps`, `saveMessage`

Status
- Implementation: High
- Tests: High (repository unit/integration in memory)

## Persistence (Pluggable Storage)

- File-backed repository package `@cnstra/devtools-server-repository-file` (JSON/JSONL)

Status
- Implementation: High (apps.json + messages.jsonl with trim to last N)
- Tests: Added (apps/messages persisted across instances)

## Known Gaps / Next

- Pagination/time filters for `cns:get-responses` and `apps:get-stimulations`
  - Implementation: High (server-side filtering with from/to/offset/limit)
  - Tests: Added (unit tests covering window + pagination)
- Persist responses/stimulations beyond memory (pluggable storage) — Implemented via file-backed repository
- RequestId correlation for strict RPC semantics (optional)

