---
id: devtools-advanced
title: DevTools Advanced Features
sidebar_label: Advanced
sidebar_position: 4
slug: /devtools/advanced
---

# Advanced Features

Explore advanced capabilities of CNStra DevTools.

## Stimulations Page

The Stimulations page provides a unified view of all stimulations and responses in your application.

### Features

- **Unified Feed**: Combined view showing both stimulations (initial signals) and responses (processing results)
- **Filtering**: Search by input collateral name with partial matching
- **Replay**: Click the ▶️ Replay button on any stimulation to re-execute it
- **Response Details**: Inspect full payloads:
  - Input payload: Original signal data
  - Output payload: Result from processing
  - Response payload: Final response data
- **Trace View**: See step-by-step signal flow per stimulation ID
- **Replay Indicator**: Responses from replay are marked with 🔁 Replay badge
- **Timestamps**: Formatted timestamps showing when each item occurred
- **Error Display**: Visual indicators for errors with error details

### Using Filters

Type in the search box to filter by input collateral name. The filter performs partial matching, so typing "user" will match "userCreated", "userUpdated", etc.

### Replay Feature

1. Click the **▶️ Replay** button on any stimulation
2. Wait for "Replay accepted" confirmation
3. New responses will appear with 🔁 Replay indicator
4. Use replay to debug issues by reproducing exact signal flows

## Signal Debugger

Manually inject signals into your neural network for testing and debugging.

### Signal Injection

- **Select Collateral**: Choose the collateral to inject into
- **Payload Editor**: JSON editor for signal payload
- **Context Editor**: JSON editor for stimulation context (optional)
- **Options Editor**: JSON editor for stimulation options (optional)
- **History**: Track all injected signals with success/failure status

### Use Cases

- Test edge cases
- Debug specific signal flows
- Verify neuron behavior
- Reproduce bugs

## Neuron Details Panel

Click any neuron in the graph to open the details panel.

### Information Shown

- **Activity Metrics**: 
  - Stimulation count
  - Response count
  - Error count
  - Average duration
- **Recent Stimulations**: Last 10 stimulations for this neuron
- **Signal Analysis**: Types and intensity averages
- **Real-time Updates**: Panel updates automatically as new stimulations occur

### Use Cases

- Debug specific neurons
- Monitor neuron activity
- Identify bottlenecks
- Analyze error patterns

## Performance Monitor

Real-time performance metrics and monitoring.

### Metrics

- **Stimulations/sec**: Signal processing rate
- **Active Neurons**: Currently processing neurons
- **Response Times**: Average response durations
- **Memory Usage**: JavaScript heap size
- **Error Rate**: Percentage of failed stimulations
- **Queue Utilization**: Signal queue status
- **Hop Count**: Signal traversal depth

### Thresholds

- **Response Time**: 
  - Green: < 100ms
  - Yellow: < 500ms
  - Red: ≥ 500ms
- **Error Rate**: 
  - Green: < 5%
  - Yellow: < 15%
  - Red: ≥ 15%
- **Hop Count**: 
  - Green: ≤ 3
  - Yellow: ≤ 7
  - Red: > 7

## Analytics Dashboard

Comprehensive analytics for your neural network.

### Features

- **Neuron Activity**: Activity metrics per neuron
- **Collateral Usage**: Most and least used collaterals
- **Error Analysis**: Error rates and patterns
- **Performance Trends**: Historical performance data

## Context Store Monitor

Monitor and inspect context stores in real-time.

### Features

- **Context Inspection**: View all active context stores
- **Context Values**: Real-time context value tracking
- **Context Deltas**: Track changes in context over time

## Export & Share

Export data for offline analysis or sharing.

### Export Options

- **Topology Export**: Export neural network structure
- **Stimulations Export**: Export stimulations and responses
  - Time range filtering
  - Error-only filtering
  - Limit and offset support
- **Snapshot Export**: Export full application snapshots

### Import

Import previously exported data for analysis or replay.

## Snapshots & Replay

Capture and replay complete stimulation sessions.

### Snapshots

- Capture snapshots of signals, responses, and context transitions
- Export snapshots as JSON files
- Import snapshots for analysis
- Share snapshots with your team

### Replay

- Deterministic replay engine reproduces sessions step-by-step
- Replay responses are marked with 🔁 Replay indicator
- Useful for:
  - Bug reproduction
  - CI regression tests
  - Performance analysis
  - Team debugging

## Keyboard Shortcuts

- **Cmd/Ctrl+K**: Command palette (if available)
- **Cmd/Ctrl+F**: Focus search (if available)

