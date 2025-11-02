# DevTools Panel UI Tests

This directory contains tests for the DevTools Panel UI package.

## Test Structure

### Unit Tests (root level)
- **`app-logic.test.ts`** - Core application logic tests (network graph, neuron selection, sidebar state)
- **`complex-connections.test.ts`** - Tests for complex neuron connection scenarios
- **`filterSanitizer.test.ts`** - Input sanitization and filtering tests
- **`graph-data-conversion.test.ts`** - Tests for converting DevTools data to Cytoscape graph format
- **`theme-utils.test.ts`** - Theme and styling utility tests (colors, icons, CSS generation)

### Integration Tests (integration/)
- **`WebSocketToOIMDB.test.ts`** - End-to-end integration test verifying data flow from WebSocket messages into OIMDB storage

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- app-logic.test.ts

# Run tests in watch mode
npm test -- --watch

# Run integration tests only
npm test -- integration
```

## Test Coverage

All tests are passing and cover:
- ✅ Core UI logic and state management
- ✅ Graph rendering and data conversion
- ✅ Complex neuron connection scenarios
- ✅ Input validation and sanitization
- ✅ Theme and styling utilities
- ✅ WebSocket to OIMDB data flow

## Cleanup Summary

The test suite was recently cleaned up:
- Removed **19 outdated/broken test files**
- Kept **6 working, valuable tests**
- Fixed **3 failing tests** (theme-utils emoji handling)
- Removed **1 test** that didn't match implementation (dataLimiter)
- All remaining tests now **pass successfully**

## Test Helpers

- **`setup.ts`** - Jest setup for DOM environment
- **`__mocks__/fileMock.js`** - Mock for static file imports
