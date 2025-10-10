# 🧠 @cnstra/devtools (SDK) — Implementation & Test Coverage

## Transport & Connectivity

- WebSocket transport (`@cnstra/devtools-transport-ws`) buffer/flush, reconnect, onStimulate handler
- Batch envelope support; init replay on reconnect

Status
- Implementation: High (stable sendInit/sendNeuronResponse batching; onStimulate → CNS)
- Tests: High‑Moderate (transport unit/integration tests; SDK smoke in example‑app)

## DTO Emission (Init, Responses)

- InitMessage emits appId/cnsId; neurons/collaterals/dendrites qualified by cnsId
- NeuronResponseMessage includes: inputCollateralName/outputCollateralName, contexts, responsePayload, duration, hopIndex (optional)

Status
- Implementation: High (SDK stamps appId/cnsId; response fields emitted)
- Tests: Moderate (field mapping asserted in panel tests; SDK path covered indirectly)

## Stimulate Handling (Inbound)

- onStimulateCommand wiring; options → CNS (timeout, hops, concurrency, allowName)
- Acks are produced by transport layer and relayed by server

Status
- Implementation: High (CNS invocation with options; idempotent)
- Tests: Moderate (transport ack tests; SDK path smoke via example‑app)

## Type Safety

- Strict TS across SDK; no `any` in public APIs
- Safe JSON serialization for contexts/payloads (circular protection)

Status
- Implementation: High (type guards; safeJson helpers)
- Tests: Lint/type checks green; no dedicated property‑based tests

## Packaging & Exports

- ESM/CJS/Types; tsup build; peer on @cnstra/core

Status
- Implementation: High
- Tests: Build verified in workspace; no publish pipeline tests

## Known Gaps / Next

- Add explicit unit tests for response field stamping (input/output/hopIndex)
- Expose small helpers for building requestIds (if RPC is introduced)
- Sample recipes for multi‑CNS registration patterns

