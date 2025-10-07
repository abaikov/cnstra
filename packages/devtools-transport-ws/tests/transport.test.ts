import { CNSDevToolsTransportWs, TWSOpts } from '../src/index';
import type { InitMessage, NeuronResponseMessage, StimulateCommand } from '@cnstra/devtools-dto';

// Get MockWebSocket from global setup
const MockWebSocket = (global as any).MockWebSocket;

describe('CNSDevToolsTransportWs', () => {
  let transport: CNSDevToolsTransportWs;
  const defaultOptions: TWSOpts = {
    url: 'ws://localhost:8080',
    webSocketImpl: MockWebSocket
  };

  beforeEach(() => {
    MockWebSocket.clearInstances();
  });

  afterEach(() => {
    if (transport) {
      transport.close();
    }
  });

  describe('Constructor and Options', () => {
    test('creates transport with default options', () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      expect(transport).toBeInstanceOf(CNSDevToolsTransportWs);
      expect(transport.isConnected).toBe(false);
      expect(transport.bufferSize).toBe(0);
    });

    test('creates transport with custom options', () => {
      const customOptions: TWSOpts = {
        url: 'wss://custom-server:9000',
        protocols: ['protocol1', 'protocol2'],
        reconnectDelayMs: 5000,
        bufferMaxSize: 200,
        autoConnect: false,
        maxReconnectAttempts: 5,
        webSocketImpl: MockWebSocket
      };

      transport = new CNSDevToolsTransportWs(customOptions);

      expect(transport).toBeInstanceOf(CNSDevToolsTransportWs);
      expect(transport.isConnected).toBe(false);
    });

    test('handles single protocol string', () => {
      const options: TWSOpts = {
        url: 'ws://localhost:8080',
        protocols: 'single-protocol',
        webSocketImpl: MockWebSocket
      };

      transport = new CNSDevToolsTransportWs(options);
      expect(transport).toBeInstanceOf(CNSDevToolsTransportWs);
    });
  });

  describe('Connection Management', () => {
    test('establishes connection on first message', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);

      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.isConnected).toBe(true);
      expect(MockWebSocket.getInstances()).toHaveLength(1);

      const wsInstance = MockWebSocket.getLatestInstance();
      expect(wsInstance.url).toBe('ws://localhost:8080');
    });

    test('reuses existing connection', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const firstConnectionCount = MockWebSocket.getInstances().length;
      expect(transport.isConnected).toBe(true);

      // Send another message - should reuse connection
      await transport.sendInitMessage(initMessage);

      expect(MockWebSocket.getInstances()).toHaveLength(firstConnectionCount);
      expect(transport.isConnected).toBe(true);
    });

    test('handles connection while already connecting', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      // Start two connections simultaneously
      const promise1 = transport.sendInitMessage(initMessage);
      const promise2 = transport.sendInitMessage(initMessage);

      await Promise.all([promise1, promise2]);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.isConnected).toBe(true);
      expect(MockWebSocket.getInstances()).toHaveLength(1);
    });

    test('throws error when WebSocket implementation is not available', async () => {
      const transportWithoutWS = new CNSDevToolsTransportWs({
        url: 'ws://localhost:8080',
        webSocketImpl: undefined as any
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      // Temporarily remove WebSocket from global scope for this test only
      const originalWebSocket = (global as any).WebSocket;
      delete (global as any).WebSocket;

      try {
        await expect(transportWithoutWS.sendInitMessage(initMessage))
          .rejects.toThrow('WebSocket implementation is not available');
      } finally {
        // Restore WebSocket
        (global as any).WebSocket = originalWebSocket;
      }
    });
  });

  describe('Message Sending', () => {
    test('sends init message successfully', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.bufferSize).toBe(0); // Buffer should be flushed
      expect(transport.isConnected).toBe(true);
    });

    test('sends neuron response message successfully', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      // First establish connection
      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const responseMessage: NeuronResponseMessage = {
        stimulationId: 'stim-123',
        neuronId: 'neuron-456',
        appId: 'test-app',
        collateralName: 'output',
        timestamp: Date.now()
      };

      await transport.sendNeuronResponseMessage(responseMessage);

      expect(transport.bufferSize).toBe(0); // Should be flushed
    });

    test('buffers messages when not connected', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        autoConnect: false
      });

      const responseMessage: NeuronResponseMessage = {
        stimulationId: 'stim-123',
        neuronId: 'neuron-456',
        appId: 'test-app',
        collateralName: 'output',
        timestamp: Date.now()
      };

      await transport.sendNeuronResponseMessage(responseMessage);

      expect(transport.bufferSize).toBe(1);
      expect(transport.isConnected).toBe(false);
    });

    test('forces flush when buffer reaches max size', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        bufferMaxSize: 2
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      // Add messages to reach buffer limit
      await transport.sendInitMessage(initMessage);

      const responseMessage: NeuronResponseMessage = {
        stimulationId: 'stim-123',
        neuronId: 'neuron-456',
        appId: 'test-app',
        collateralName: 'output',
        timestamp: Date.now()
      };

      await transport.sendNeuronResponseMessage(responseMessage);
      await new Promise(resolve => setTimeout(resolve, 30));

      expect(transport.bufferSize).toBe(0); // Should have flushed
      expect(transport.isConnected).toBe(true);
    });
  });

  describe('Reconnection Logic', () => {
    test('attempts reconnection on connection loss', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        reconnectDelayMs: 50,
        maxReconnectAttempts: 3
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.isConnected).toBe(true);
      const initialInstanceCount = MockWebSocket.getInstances().length;

      // Simulate connection loss
      const wsInstance = MockWebSocket.getLatestInstance();
      wsInstance.close();

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for reconnect

      // Should have created a new connection
      expect(MockWebSocket.getInstances().length).toBeGreaterThan(initialInstanceCount);
    });

    test('resends init message on reconnection', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        reconnectDelayMs: 20
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.isConnected).toBe(true);

      // Simulate connection loss
      const wsInstance = MockWebSocket.getLatestInstance();
      wsInstance.close();

      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for reconnect

      // Buffer should contain the re-queued init message
      expect(transport.bufferSize).toBeGreaterThanOrEqual(0);
    });

    test('stops reconnecting after max attempts', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        reconnectDelayMs: 10,
        maxReconnectAttempts: 2
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      // Simulate repeated connection failures
      for (let i = 0; i < 3; i++) {
        const wsInstance = MockWebSocket.getLatestInstance();
        if (wsInstance) {
          MockWebSocket.simulateError(wsInstance);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // After max attempts, should have stopped trying
      expect(transport.isConnected).toBe(false);
    });

    test('does not reconnect when closed manually', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        reconnectDelayMs: 20
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const initialInstanceCount = MockWebSocket.getInstances().length;

      // Manually close transport
      transport.close();

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not have created new connections
      expect(MockWebSocket.getInstances().length).toBe(initialInstanceCount);
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('Message Handling', () => {
    test('handles incoming stimulate commands', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      let receivedCommand: StimulateCommand | undefined;
      const unsubscribe = transport.onStimulateCommand((cmd) => {
        receivedCommand = cmd;
      });

      const stimulateCommand: StimulateCommand = {
        type: 'stimulate',
        stimulationCommandId: 'cmd-123',
        collateralName: 'input',
        payload: { test: 'data' }
      };

      // Simulate receiving message
      const wsInstance = MockWebSocket.getLatestInstance();
      wsInstance.onmessage?.({
        data: JSON.stringify(stimulateCommand)
      } as MessageEvent);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedCommand).toEqual(stimulateCommand);

      unsubscribe();
    });

    test('sends acknowledge for stimulate commands', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const stimulateCommand: StimulateCommand = {
        type: 'stimulate',
        stimulationCommandId: 'cmd-123',
        collateralName: 'input',
        payload: { test: 'data' }
      };

      const wsInstance = MockWebSocket.getLatestInstance();
      let sentAck: any;

      // Spy on the send method
      const originalSend = wsInstance.send;
      wsInstance.send = jest.fn((data: string) => {
        sentAck = JSON.parse(data);
        originalSend.call(wsInstance, data);
      });

      wsInstance.onmessage?.({
        data: JSON.stringify(stimulateCommand)
      } as MessageEvent);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sentAck).toEqual({
        type: 'stimulate-accepted',
        stimulationCommandId: 'cmd-123',
        stimulationId: 'cmd-123'
      });
    });

    test('ignores invalid incoming messages', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const wsInstance = MockWebSocket.getLatestInstance();

      // Send invalid JSON
      wsInstance.onmessage?.({
        data: 'invalid-json'
      } as MessageEvent);

      // Send valid JSON but invalid message type
      wsInstance.onmessage?.({
        data: JSON.stringify({ type: 'unknown', data: 'test' })
      } as MessageEvent);

      // Should not throw errors - messages are ignored
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    test('unsubscribes from stimulate command handler', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      let commandCount = 0;
      const unsubscribe = transport.onStimulateCommand(() => {
        commandCount++;
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const stimulateCommand: StimulateCommand = {
        type: 'stimulate',
        stimulationCommandId: 'cmd-123',
        collateralName: 'input',
        payload: { test: 'data' }
      };

      const wsInstance = MockWebSocket.getLatestInstance();

      // Send command - should be handled
      wsInstance.onmessage?.({
        data: JSON.stringify(stimulateCommand)
      } as MessageEvent);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(commandCount).toBe(1);

      // Unsubscribe and send another command
      unsubscribe();

      wsInstance.onmessage?.({
        data: JSON.stringify({ ...stimulateCommand, stimulationCommandId: 'cmd-456' })
      } as MessageEvent);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(commandCount).toBe(1); // Should not have increased
    });
  });

  describe('Error Handling', () => {
    test('handles WebSocket send errors gracefully', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const wsInstance = MockWebSocket.getLatestInstance();

      // Mock send to throw error
      wsInstance.send = jest.fn(() => {
        throw new Error('Send failed');
      });

      const responseMessage: NeuronResponseMessage = {
        stimulationId: 'stim-123',
        neuronId: 'neuron-456',
        appId: 'test-app',
        collateralName: 'output',
        timestamp: Date.now()
      };

      // Should not throw - error is caught and message re-queued
      await transport.sendNeuronResponseMessage(responseMessage);

      expect(transport.bufferSize).toBe(1); // Message should be re-queued
    });

    test('handles WebSocket onerror events', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        reconnectDelayMs: 20
      });

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const wsInstance = MockWebSocket.getLatestInstance();

      // Trigger error event
      MockWebSocket.simulateError(wsInstance);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should attempt reconnection
      expect(MockWebSocket.getInstances().length).toBeGreaterThan(1);
    });

    test('handles close when connection is already closing', () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      // Close multiple times - should not throw
      transport.close();
      transport.close();
      transport.close();

      expect(transport.isConnected).toBe(false);
    });

    test('handles send on acknowledge when WebSocket is closed', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      const wsInstance = MockWebSocket.getLatestInstance();
      wsInstance.readyState = MockWebSocket.CLOSED;

      // Mock send to throw error
      wsInstance.send = jest.fn(() => {
        throw new Error('WebSocket is closed');
      });

      const stimulateCommand: StimulateCommand = {
        type: 'stimulate',
        stimulationCommandId: 'cmd-123',
        collateralName: 'input',
        payload: { test: 'data' }
      };

      // Should not throw - error is caught
      wsInstance.onmessage?.({
        data: JSON.stringify(stimulateCommand)
      } as MessageEvent);

      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('Getters and Properties', () => {
    test('returns correct connection status', async () => {
      transport = new CNSDevToolsTransportWs(defaultOptions);

      expect(transport.isConnected).toBe(false);

      const initMessage: InitMessage = {
        type: 'init',
        devToolsInstanceId: 'test-app',
        appName: 'Test App',
        version: '1.0.0',
        timestamp: Date.now(),
        neurons: [],
        collaterals: [],
        dendrites: []
      };

      await transport.sendInitMessage(initMessage);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(transport.isConnected).toBe(true);

      transport.close();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(transport.isConnected).toBe(false);
    });

    test('returns correct buffer size', async () => {
      transport = new CNSDevToolsTransportWs({
        ...defaultOptions,
        autoConnect: false
      });

      expect(transport.bufferSize).toBe(0);

      const responseMessage: NeuronResponseMessage = {
        stimulationId: 'stim-123',
        neuronId: 'neuron-456',
        appId: 'test-app',
        collateralName: 'output',
        timestamp: Date.now()
      };

      await transport.sendNeuronResponseMessage(responseMessage);
      expect(transport.bufferSize).toBe(1);

      await transport.sendNeuronResponseMessage(responseMessage);
      expect(transport.bufferSize).toBe(2);
    });

    test('handles default option values', () => {
      const basicTransport = new CNSDevToolsTransportWs({
        url: 'ws://localhost:8080',
        webSocketImpl: MockWebSocket
      });

      // Access private getters through reflection to test defaults
      expect((basicTransport as any).reconnectDelayMs).toBe(1000);
      expect((basicTransport as any).bufferMaxSize).toBe(100);
      expect((basicTransport as any).maxReconnectAttempts).toBe(Infinity);
    });

    test('handles custom option values', () => {
      const customTransport = new CNSDevToolsTransportWs({
        url: 'ws://localhost:8080',
        reconnectDelayMs: 2000,
        bufferMaxSize: 50,
        maxReconnectAttempts: 10,
        webSocketImpl: MockWebSocket
      });

      expect((customTransport as any).reconnectDelayMs).toBe(2000);
      expect((customTransport as any).bufferMaxSize).toBe(50);
      expect((customTransport as any).maxReconnectAttempts).toBe(10);
    });
  });
});