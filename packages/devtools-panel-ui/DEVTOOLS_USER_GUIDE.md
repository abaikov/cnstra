# 🧠 CNStra DevTools - User Guide

## Overview

CNStra DevTools is a comprehensive debugging and monitoring interface for CNStra applications. It provides real-time visualization of neural networks, performance monitoring, signal debugging, context tracking, and advanced analytics.

## 🚀 Getting Started

### Prerequisites
- CNStra application with DevTools transport configured
- Modern web browser (Chrome, Firefox, Safari, Edge)
- DevTools server running (usually on localhost:8080)

### Launching DevTools
1. Start your CNStra application with DevTools enabled
2. Start the DevTools server
3. Open DevTools in your browser at `http://localhost:8080`
4. Your application should appear in the "Connected Apps" panel

## 🎛️ Interface Overview

### Main Layout
- **Left Sidebar**: App selection, monitoring tools, and controls
- **Main Panel**: Network visualization or detailed views
- **Bottom Panel**: Status information and quick stats

### Sidebar Components
The sidebar contains five main monitoring components:

1. **📊 Performance Monitor**
2. **🔧 Signal Debugger**
3. **🧮 Context Store Monitor**
4. **📊 Analytics Dashboard**
5. **📱 Connected Apps**

## 📊 Performance Monitor

### Features
- **Real-time CNStra Metrics**: Stimulations/sec, active neurons, response times
- **Memory Usage**: JavaScript heap monitoring with trends
- **Error Tracking**: Error rates with visual alerts
- **Network Health**: Queue utilization and hop count analysis

### Compact View
Shows essential metrics at a glance:
- Memory usage percentage
- Stimulations per second
- Active neuron count
- Error rate (when > 0%)

### Expanded View
Detailed metrics with:
- CNStra-specific performance data
- Memory and stimulation trend charts
- Queue utilization and hop count statistics
- Performance thresholds with color coding

### Performance Thresholds
- **Response Time**: Green < 100ms, Yellow < 500ms, Red ≥ 500ms
- **Error Rate**: Green < 5%, Yellow < 15%, Red ≥ 15%
- **Hop Count**: Green ≤ 3, Yellow ≤ 7, Red > 7

## 🔧 Signal Debugger

### Purpose
Inject custom signals into your CNStra application for testing and debugging.

### Signal Injection
1. **Select Target Collateral**: Choose from available collaterals in the dropdown
2. **Edit Payload**: Enter JSON payload data
3. **Advanced Options** (optional):
   - Contexts: Additional context data
   - Options: Stimulation options (maxHops, concurrency, etc.)
4. **Inject Signal**: Click the inject button to send

### Recent Stimulations Inspector
- View last 10 stimulations from your application
- Copy stimulation data to injection form
- Inspect payloads and metadata

### Injection History
- Track successful and failed injections
- Error details for debugging injection issues
- Timestamps for all injection attempts

### Best Practices
- Start with simple payloads to test connectivity
- Use contexts for stateful testing scenarios
- Monitor injection history for patterns
- Copy real stimulations as templates

## 🧮 Context Store Monitor

### Purpose
Monitor stimulation flows and context data propagation through your neural network.

### Flow Visualization
- **Stimulation Flows**: End-to-end signal propagation
- **Response Chains**: Detailed response sequences
- **Hop Tracking**: Network traversal analysis
- **Context Analysis**: Context key usage and patterns

### Context Statistics
- **Total Flows**: All stimulation flows
- **Context Utilization**: Percentage of flows with contexts
- **Context Keys**: Number of unique context keys
- **Average Hops**: Network complexity metric

### Flow Filtering
- Toggle "Show only flows with contexts" for focused analysis
- Click flows to expand response chains
- View payloads and context data in detail

### Use Cases
- Debug context propagation issues
- Analyze network complexity
- Monitor hop count patterns
- Understand signal flow paths

## 📊 Analytics Dashboard

### Comprehensive Metrics
Real-time and historical analysis with:

#### Core Metrics
- **Stimulations**: Total count and rate
- **Responses**: Success/failure analysis
- **Neurons**: Active neuron tracking
- **Connections**: Network topology size
- **Performance**: Response times and error rates

#### Time Range Analysis
- **5 minutes**: Recent activity
- **1 hour**: Short-term trends
- **24 hours**: Daily patterns
- **All time**: Complete history

#### Top Performing Neurons
- Ranked by stimulation count
- Average response times
- Error counts per neuron
- Performance comparisons

#### Network Complexity
- Maximum hop counts
- Average hop distribution
- Complexity patterns

### Data Export
Export analytics data in two formats:
- **JSON**: Complete data with metadata
- **CSV**: Simplified metrics table

Export includes:
- Current analytics snapshot
- Raw data (stimulations, responses, neurons)
- Timestamp and app information
- Selected time range

### Performance Analysis
Use analytics to:
- Identify bottleneck neurons
- Track performance degradation
- Monitor error patterns
- Analyze network efficiency

## 📱 Connected Apps

### App Management
- **Automatic Discovery**: Apps appear when they connect
- **App Switching**: Click to switch between applications
- **Connection Status**: Real-time connection monitoring
- **Multi-app Support**: Monitor multiple applications simultaneously

### App Information
Each connected app shows:
- App name and ID
- Connection status
- Version information (if available)
- Last seen timestamp

### Navigation
- **Network Topology**: Main visualization view
- **Stimulations**: Detailed stimulation history
- **App-specific Data**: Filtered by selected application

## 🗺️ Network Topology Visualization

### Interactive Graph
- **Neurons**: Nodes representing processing units
- **Connections**: Edges showing signal paths
- **Real-time Updates**: Live network changes
- **Click Interactions**: Select neurons for details

### Visual Elements
- **Node Colors**: Different types (input, processing, output)
- **Node Sizes**: Based on activity levels
- **Connection Thickness**: Based on usage
- **Animations**: Signal flow visualization

### Neuron Details Panel
Click any neuron to view:
- Stimulation history
- Connection information
- Performance metrics
- Recent activity

## ⚡ Stimulations Page

### Detailed View
Access via sidebar navigation or URL routing:
- Comprehensive stimulation history
- Response details and timing
- Error tracking and analysis
- Searchable and filterable data

### Data Organization
- **Chronological Order**: Most recent first
- **Response Mapping**: Linked stimulation-response pairs
- **Metadata Display**: Contexts, options, timing
- **Error Highlighting**: Failed stimulations marked

## 🎯 Performance Limits & Data Management

### Automatic Data Retention
DevTools implements smart limits to prevent memory issues:

- **Stimulations**: Maximum 10,000 retained
- **Responses**: Maximum 15,000 retained
- **Retention Time**: 24 hours automatic cleanup
- **UI Limits**: Display limits for optimal performance

### Memory Management
- **Automatic Cleanup**: Every 30 seconds
- **Progressive Removal**: Oldest data removed first
- **App-specific Cleanup**: Disconnected apps cleaned
- **Memory Monitoring**: Built-in usage tracking

### Performance Thresholds
Built-in warnings when approaching limits:
- 80% of maximum data counts
- High memory usage (>50MB)
- Performance degradation detection

## 🔧 Troubleshooting

### Common Issues

#### No Connected Apps
- Check DevTools server is running
- Verify WebSocket connection (default: ws://localhost:8080)
- Ensure your app has DevTools transport configured
- Check browser console for connection errors

#### Missing Data
- Verify your app is generating stimulations
- Check network connectivity between app and DevTools
- Review console logs for data flow issues
- Ensure proper DevTools initialization in your app

#### Performance Issues
- Check data retention limits
- Monitor memory usage in Performance Monitor
- Reduce visualization complexity if needed
- Clear old data manually if necessary

#### Signal Injection Failures
- Verify collateral names are correct
- Check JSON payload syntax
- Ensure target app is connected
- Review injection history for error details

### Browser Compatibility
- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support
- **Mobile Browsers**: Limited support

### WebSocket Configuration
DevTools connects via WebSocket:
- Default: `ws://localhost:8080`
- Custom: Set `window.__CNSTRA_DEVTOOLS_WS__`
- HTTPS: Use `wss://` protocol
- Network: Ensure port accessibility

## 📈 Best Practices

### Development Workflow
1. **Start DevTools Early**: Connect before development
2. **Monitor Continuously**: Keep DevTools open while coding
3. **Test Signal Flows**: Use injection for edge cases
4. **Analyze Patterns**: Review analytics regularly
5. **Export Data**: Save important debugging sessions

### Performance Optimization
1. **Watch Memory Usage**: Monitor in Performance panel
2. **Limit Data Retention**: Configure shorter retention if needed
3. **Use Filtering**: Focus on relevant data subsets
4. **Regular Cleanup**: Let automatic cleanup work
5. **Export Analysis**: Move detailed analysis offline

### Debugging Strategies
1. **Start with Topology**: Understand network structure
2. **Inject Simple Signals**: Test basic connectivity
3. **Follow Signal Paths**: Trace through Context Monitor
4. **Analyze Performance**: Use Analytics Dashboard
5. **Compare Sessions**: Export data for comparison

### Production Considerations
- **Disable in Production**: Remove DevTools transport
- **Security**: Ensure DevTools not exposed publicly
- **Performance Impact**: Monitor app performance with DevTools
- **Data Privacy**: Be cautious with sensitive payloads

## 🆘 Support & Resources

### Getting Help
- Check console logs for detailed error messages
- Use browser developer tools for network debugging
- Review CNStra documentation for transport setup
- File issues with specific reproduction steps

### Additional Resources
- **CNStra Core Documentation**: Framework concepts
- **DevTools Architecture**: Technical implementation details
- **API Reference**: DevTools transport protocols
- **Examples**: Sample applications with DevTools

## 🎉 Advanced Features

### Keyboard Shortcuts
- **Space**: Toggle expanded view for focused component
- **Esc**: Close neuron details panel
- **Tab**: Navigate between sidebar components
- **Enter**: Inject signal (when injection form focused)

### URL Navigation
- **#/apps**: Main application list
- **#/apps/{appId}**: Specific application view
- **#/apps/{appId}/stimulations**: Stimulations page

### Browser Integration
- **Bookmarks**: Save specific app views
- **History**: Browser back/forward navigation
- **Refresh**: Maintains connection state
- **Multiple Tabs**: Each tab is independent

---

*This guide covers the essential features of CNStra DevTools. For technical implementation details, see the Architecture documentation.*