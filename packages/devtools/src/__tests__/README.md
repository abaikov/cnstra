# DevTools Tests

Comprehensive test suite for `@cnstra/devtools` package.

## Test Files

### `integration.test.ts`
Integration tests covering basic DevTools functionality:
- Init message sending on CNS registration
- Response message handling
- Error handling (missing outputSignal)
- Message ordering
- JSON serialization (circular refs, errors)

### `protocol.test.ts`
Complete protocol verification tests:
- **Initialization**: Init message structure and content
- **Response Messages**: Field validation, neuronId derivation
- **Message Order**: Sequence verification, timestamp ordering
- **Data Completeness**: Graph reconstruction, signal flow tracking
- **Key Invariants**:
  - DevTools sends ONLY `init` + `response` messages (NO stimulations)
  - All responses contain full data for signal flow reconstruction
  - Stimulations are derived from response `inputSignal` data

## Running Tests

```bash
# Run all tests
npm test --workspace=@cnstra/devtools

# Watch mode
npm test --workspace=@cnstra/devtools -- --watch

# Coverage
npm test --workspace=@cnstra/devtools -- --coverage
```

## Test Strategy

1. **Unit Tests**: Individual DevTools methods (safeJson, neuronId derivation)
2. **Integration Tests**: End-to-end message flow
3. **Protocol Tests**: Message structure and ordering guarantees

## Key Test Principles

- ✅ All tests use mocked CNS/transport - no real WebSocket connections
- ✅ Tests verify WHAT is sent, WHEN, and in WHAT ORDER
- ✅ Tests ensure DevTools can reconstruct graph topology from messages alone
- ✅ No deprecated stimulation messages are sent

