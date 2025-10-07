import { CNSDevToolsServerRepositoryInMemory } from '../src/index';
import { DevToolsApp } from '@cnstra/devtools-dto';

describe('CNSDevToolsServerRepositoryInMemory', () => {
  let repository: CNSDevToolsServerRepositoryInMemory;

  beforeEach(() => {
    repository = new CNSDevToolsServerRepositoryInMemory();
  });

  describe('Constructor', () => {
    test('creates repository with empty state', () => {
      expect(repository.listApps()).toEqual([]);
      expect(repository.getMessages()).toEqual([]);
    });
  });

  describe('App Management', () => {
    test('upserts new app with correct timestamps', () => {
      const now = Date.now();
      const app: DevToolsApp = {
        appId: 'test-app-1',
        appName: 'Test App',
        version: '1.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      };

      repository.upsertApp(app);
      const apps = repository.listApps();

      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({
        appId: 'test-app-1',
        appName: 'Test App',
        version: '1.0.0'
      });
      expect(apps[0].lastSeenAt).toBeGreaterThanOrEqual(now);
      expect(apps[0].firstSeenAt).toBeGreaterThanOrEqual(now);
      expect(apps[0].firstSeenAt).toBeLessThanOrEqual(apps[0].lastSeenAt);
    });

    test('updates existing app preserving firstSeenAt', () => {
      const app: DevToolsApp = {
        appId: 'test-app-1',
        appName: 'Test App',
        version: '1.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      };

      // First upsert
      repository.upsertApp(app);
      const firstApps = repository.listApps();
      const originalFirstSeen = firstApps[0].firstSeenAt;

      // Wait a small amount to ensure different timestamps
      const delay = () => new Promise(resolve => setTimeout(resolve, 1));
      return delay().then(() => {
        // Second upsert with same appId
        const updatedApp: DevToolsApp = {
          appId: 'test-app-1',
          appName: 'Updated Test App',
          version: '2.0.0',
          lastSeenAt: 0,
          firstSeenAt: 0
        };

        repository.upsertApp(updatedApp);
        const updatedApps = repository.listApps();

        expect(updatedApps).toHaveLength(1);
        expect(updatedApps[0]).toMatchObject({
          appId: 'test-app-1',
          appName: 'Updated Test App',
          version: '2.0.0'
        });
        expect(updatedApps[0].firstSeenAt).toBe(originalFirstSeen);
        expect(updatedApps[0].lastSeenAt).toBeGreaterThan(originalFirstSeen);
      });
    });

    test('handles multiple apps', () => {
      const app1: DevToolsApp = {
        appId: 'app-1',
        appName: 'App One',
        version: '1.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      };

      const app2: DevToolsApp = {
        appId: 'app-2',
        appName: 'App Two',
        version: '2.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      };

      repository.upsertApp(app1);
      repository.upsertApp(app2);

      const apps = repository.listApps();
      expect(apps).toHaveLength(2);

      const appIds = apps.map(app => app.appId).sort();
      expect(appIds).toEqual(['app-1', 'app-2']);
    });

    test('listApps returns empty array for new repository', () => {
      expect(repository.listApps()).toEqual([]);
    });
  });

  describe('Message Management', () => {
    test('saves message with receivedAt timestamp', () => {
      const now = Date.now();
      const message = {
        type: 'test-message',
        data: { value: 123 }
      };

      repository.saveMessage(message);
      const messages = repository.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        type: 'test-message',
        data: { value: 123 }
      });
      expect(messages[0].receivedAt).toBeGreaterThanOrEqual(now);
    });

    test('preserves message order', () => {
      const messages = [
        { type: 'message-1', id: 1 },
        { type: 'message-2', id: 2 },
        { type: 'message-3', id: 3 }
      ];

      messages.forEach(msg => repository.saveMessage(msg));
      const saved = repository.getMessages();

      expect(saved).toHaveLength(3);
      expect(saved[0].id).toBe(1);
      expect(saved[1].id).toBe(2);
      expect(saved[2].id).toBe(3);
    });

    test('limits messages to 1000', () => {
      // Save 1005 messages
      for (let i = 0; i < 1005; i++) {
        repository.saveMessage({ id: i, data: `message-${i}` });
      }

      const messages = repository.getMessages();
      expect(messages).toHaveLength(1000);

      // Should contain the last 1000 messages (5 through 1004)
      expect(messages[0].id).toBe(5);
      expect(messages[999].id).toBe(1004);
    });

    test('handles message limit boundary correctly', () => {
      // Save exactly 1000 messages
      for (let i = 0; i < 1000; i++) {
        repository.saveMessage({ id: i, data: `message-${i}` });
      }

      let messages = repository.getMessages();
      expect(messages).toHaveLength(1000);
      expect(messages[0].id).toBe(0);
      expect(messages[999].id).toBe(999);

      // Add one more message
      repository.saveMessage({ id: 1000, data: 'message-1000' });

      messages = repository.getMessages();
      expect(messages).toHaveLength(1000);
      expect(messages[0].id).toBe(1);
      expect(messages[999].id).toBe(1000);
    });

    test('getMessages returns copy of messages array', () => {
      const message = { type: 'test', data: 'original' };
      repository.saveMessage(message);

      const messages1 = repository.getMessages();
      const messages2 = repository.getMessages();

      // Should be different array instances
      expect(messages1).not.toBe(messages2);

      // But have same content
      expect(messages1).toEqual(messages2);

      // Modifying returned array shouldn't affect repository
      messages1.push({ type: 'modified' } as any);
      expect(repository.getMessages()).toHaveLength(1);
    });

    test('getMessages returns empty array for new repository', () => {
      expect(repository.getMessages()).toEqual([]);
    });
  });

  describe('Clear functionality', () => {
    test('clears all apps and messages', () => {
      // Add some apps
      repository.upsertApp({
        appId: 'app-1',
        appName: 'Test App',
        version: '1.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      });

      // Add some messages
      repository.saveMessage({ type: 'test-message', data: 'test' });

      // Verify data exists
      expect(repository.listApps()).toHaveLength(1);
      expect(repository.getMessages()).toHaveLength(1);

      // Clear everything
      repository.clear();

      // Verify everything is cleared
      expect(repository.listApps()).toEqual([]);
      expect(repository.getMessages()).toEqual([]);
    });

    test('clear works on empty repository', () => {
      repository.clear();
      expect(repository.listApps()).toEqual([]);
      expect(repository.getMessages()).toEqual([]);
    });

    test('repository functions normally after clear', () => {
      // Add and clear data
      repository.upsertApp({
        appId: 'app-1',
        appName: 'Test App',
        version: '1.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      });
      repository.saveMessage({ type: 'test', data: 'test' });
      repository.clear();

      // Add new data after clear
      repository.upsertApp({
        appId: 'app-2',
        appName: 'New App',
        version: '2.0.0',
        lastSeenAt: 0,
        firstSeenAt: 0
      });
      repository.saveMessage({ type: 'new-message', data: 'new' });

      expect(repository.listApps()).toHaveLength(1);
      expect(repository.listApps()[0].appId).toBe('app-2');
      expect(repository.getMessages()).toHaveLength(1);
      expect(repository.getMessages()[0].type).toBe('new-message');
    });
  });

  describe('Edge Cases', () => {
    test('handles app with minimal data', () => {
      const minimalApp: DevToolsApp = {
        appId: 'minimal',
        appName: '',
        version: '',
        lastSeenAt: 0,
        firstSeenAt: 0
      };

      repository.upsertApp(minimalApp);
      const apps = repository.listApps();

      expect(apps).toHaveLength(1);
      expect(apps[0].appId).toBe('minimal');
      expect(apps[0].appName).toBe('');
      expect(apps[0].version).toBe('');
    });

    test('handles empty message object', () => {
      repository.saveMessage({});
      const messages = repository.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toHaveProperty('receivedAt');
    });

    test('handles null/undefined message properties', () => {
      const message = {
        type: null,
        data: undefined,
        value: 'test'
      };

      repository.saveMessage(message);
      const messages = repository.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBeNull();
      expect(messages[0].data).toBeUndefined();
      expect(messages[0].value).toBe('test');
    });
  });
});