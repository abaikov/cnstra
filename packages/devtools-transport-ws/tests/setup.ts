// Mock WebSocket for testing
class MockWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSING = 2;
  public readonly CLOSED = 3;

  public readyState = MockWebSocket.CONNECTING;
  public url: string;
  public protocol?: string | string[];

  public onopen?: (event: Event) => void;
  public onclose?: (event: CloseEvent) => void;
  public onerror?: (event: Event) => void;
  public onmessage?: (event: MessageEvent) => void;

  private static instances: MockWebSocket[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocol = protocols;
    MockWebSocket.instances.push(this);

    // Simulate connection after short delay
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
      }
    }, 10);
  }

  public send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    // Echo back for testing
    setTimeout(() => {
      this.onmessage?.(new MessageEvent('message', { data }));
    }, 1);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.OPEN || this.readyState === MockWebSocket.CONNECTING) {
      this.readyState = MockWebSocket.CLOSING;
      setTimeout(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close', { code, reason }));
      }, 1);
    }
  }

  public static simulateError(instance: MockWebSocket): void {
    setTimeout(() => {
      instance.onerror?.(new Event('error'));
      instance.readyState = MockWebSocket.CLOSED;
      instance.onclose?.(new CloseEvent('close', { code: 1006, reason: 'Connection error' }));
    }, 1);
  }

  public static getInstances(): MockWebSocket[] {
    return [...MockWebSocket.instances];
  }

  public static clearInstances(): void {
    MockWebSocket.instances = [];
  }

  public static getLatestInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

// Set up global WebSocket mock
(global as any).WebSocket = MockWebSocket;
(global as any).MockWebSocket = MockWebSocket;

// Mock MessageEvent and CloseEvent if not available
if (typeof MessageEvent === 'undefined') {
  (global as any).MessageEvent = class MessageEvent {
    public data: any;
    public type: string;

    constructor(type: string, eventInitDict?: { data?: any }) {
      this.type = type;
      this.data = eventInitDict?.data;
    }
  };
}

if (typeof CloseEvent === 'undefined') {
  (global as any).CloseEvent = class CloseEvent {
    public code: number;
    public reason: string;
    public type: string;

    constructor(type: string, eventInitDict?: { code?: number; reason?: string }) {
      this.type = type;
      this.code = eventInitDict?.code || 1000;
      this.reason = eventInitDict?.reason || '';
    }
  };
}

// Reset mocks before each test
beforeEach(() => {
  MockWebSocket.clearInstances();
  jest.clearAllMocks();
});