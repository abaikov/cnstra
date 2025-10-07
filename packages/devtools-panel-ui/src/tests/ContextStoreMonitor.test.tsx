import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContextStoreMonitor } from '../ui/ContextStoreMonitor';

// Mock the database
jest.mock('../model', () => ({
    db: {
        stimulations: {
            getAll: jest.fn(() => []),
        },
        responses: {
            getAll: jest.fn(() => []),
        },
        neurons: {
            getAll: jest.fn(() => []),
        },
    }
}));

// Mock OIMDB React hooks
jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(() => []),
}));

import { db } from '../model';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';

const mockDb = db as jest.Mocked<typeof db>;
const mockUseSelectEntitiesByIndexKey = useSelectEntitiesByIndexKey as jest.MockedFunction<typeof useSelectEntitiesByIndexKey>;

describe('ContextStoreMonitor', () => {
    const mockContextData = [
        {
            id: 'ctx1',
            appId: 'test-app',
            context: 'user-session',
            key: 'userId',
            value: '12345',
            timestamp: Date.now() - 5000,
            source: 'auth-service',
        },
        {
            id: 'ctx2',
            appId: 'test-app',
            context: 'shopping-cart',
            key: 'items',
            value: [{ id: 1, name: 'Product A' }, { id: 2, name: 'Product B' }],
            timestamp: Date.now() - 3000,
            source: 'cart-service',
        },
        {
            id: 'ctx3',
            appId: 'test-app',
            context: 'user-preferences',
            key: 'theme',
            value: 'dark',
            timestamp: Date.now() - 1000,
            source: 'ui-service',
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockUseSelectEntitiesByIndexKey.mockReturnValue(mockContextData);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Component Rendering', () => {
        test('renders context store monitor header', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Context Store Monitor')).toBeInTheDocument();
        });

        test('renders with no selected app', () => {
            render(<ContextStoreMonitor selectedAppId={null} />);

            expect(screen.getByText('Context Store Monitor')).toBeInTheDocument();
            expect(screen.getByText('No app selected')).toBeInTheDocument();
        });

        test('renders context list when app is selected', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Context Stores')).toBeInTheDocument();
            expect(screen.getByText('user-session')).toBeInTheDocument();
            expect(screen.getByText('shopping-cart')).toBeInTheDocument();
            expect(screen.getByText('user-preferences')).toBeInTheDocument();
        });

        test('displays context count', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Total Contexts: 3')).toBeInTheDocument();
        });
    });

    describe('Context Filtering and Search', () => {
        test('filters contexts by name', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const filterInput = screen.getByPlaceholderText('Filter contexts...');
            fireEvent.change(filterInput, { target: { value: 'user' } });

            expect(screen.getByText('user-session')).toBeInTheDocument();
            expect(screen.getByText('user-preferences')).toBeInTheDocument();
            expect(screen.queryByText('shopping-cart')).not.toBeInTheDocument();
        });

        test('searches within context values', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const searchInput = screen.getByPlaceholderText('Search context values...');
            fireEvent.change(searchInput, { target: { value: 'Product A' } });

            expect(screen.getByText('shopping-cart')).toBeInTheDocument();
            expect(screen.queryByText('user-session')).not.toBeInTheDocument();
        });

        test('case-insensitive filtering', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const filterInput = screen.getByPlaceholderText('Filter contexts...');
            fireEvent.change(filterInput, { target: { value: 'USER-SESSION' } });

            expect(screen.getByText('user-session')).toBeInTheDocument();
        });

        test('combines filter and search', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const filterInput = screen.getByPlaceholderText('Filter contexts...');
            const searchInput = screen.getByPlaceholderText('Search context values...');

            fireEvent.change(filterInput, { target: { value: 'user' } });
            fireEvent.change(searchInput, { target: { value: 'dark' } });

            expect(screen.getByText('user-preferences')).toBeInTheDocument();
            expect(screen.queryByText('user-session')).not.toBeInTheDocument();
        });
    });

    describe('Context Details Display', () => {
        test('shows context details when clicked', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-session');
            fireEvent.click(contextItem);

            expect(screen.getByText('Context Details')).toBeInTheDocument();
            expect(screen.getByText('Context: user-session')).toBeInTheDocument();
            expect(screen.getByText('Key: userId')).toBeInTheDocument();
            expect(screen.getByText('Source: auth-service')).toBeInTheDocument();
        });

        test('displays context value in formatted JSON', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('shopping-cart');
            fireEvent.click(contextItem);

            expect(screen.getByText('Value:')).toBeInTheDocument();
            expect(screen.getByText('"name": "Product A"')).toBeInTheDocument();
            expect(screen.getByText('"name": "Product B"')).toBeInTheDocument();
        });

        test('shows timestamp information', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-preferences');
            fireEvent.click(contextItem);

            expect(screen.getByText(/Updated:/)).toBeInTheDocument();
            expect(screen.getByText(/seconds ago/)).toBeInTheDocument();
        });

        test('handles primitive values correctly', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-preferences');
            fireEvent.click(contextItem);

            expect(screen.getByText('"dark"')).toBeInTheDocument();
        });

        test('closes details when clicked again', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-session');
            fireEvent.click(contextItem);
            expect(screen.getByText('Context Details')).toBeInTheDocument();

            fireEvent.click(contextItem);
            expect(screen.queryByText('Context Details')).not.toBeInTheDocument();
        });
    });

    describe('Context Grouping', () => {
        test('groups contexts by context name', () => {
            const groupedContextData = [
                ...mockContextData,
                {
                    id: 'ctx4',
                    appId: 'test-app',
                    context: 'user-session',
                    key: 'email',
                    value: 'user@example.com',
                    timestamp: Date.now() - 2000,
                    source: 'auth-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(groupedContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Group by Context')).toBeInTheDocument();

            const groupToggle = screen.getByLabelText('Group contexts');
            fireEvent.click(groupToggle);

            expect(screen.getByText('user-session (2 keys)')).toBeInTheDocument();
            expect(screen.getByText('shopping-cart (1 key)')).toBeInTheDocument();
        });

        test('expands grouped contexts', () => {
            const groupedContextData = [
                ...mockContextData,
                {
                    id: 'ctx4',
                    appId: 'test-app',
                    context: 'user-session',
                    key: 'email',
                    value: 'user@example.com',
                    timestamp: Date.now() - 2000,
                    source: 'auth-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(groupedContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const groupToggle = screen.getByLabelText('Group contexts');
            fireEvent.click(groupToggle);

            const userSessionGroup = screen.getByText('user-session (2 keys)');
            fireEvent.click(userSessionGroup);

            expect(screen.getByText('userId')).toBeInTheDocument();
            expect(screen.getByText('email')).toBeInTheDocument();
        });
    });

    describe('Real-time Updates', () => {
        test('updates when context data changes', async () => {
            const { rerender } = render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Total Contexts: 3')).toBeInTheDocument();

            const newContextData = [
                ...mockContextData,
                {
                    id: 'ctx4',
                    appId: 'test-app',
                    context: 'new-context',
                    key: 'newKey',
                    value: 'newValue',
                    timestamp: Date.now(),
                    source: 'new-service',
                },
            ];

            act(() => {
                mockUseSelectEntitiesByIndexKey.mockReturnValue(newContextData);
            });

            rerender(<ContextStoreMonitor selectedAppId="test-app" />);

            await waitFor(() => {
                expect(screen.getByText('Total Contexts: 4')).toBeInTheDocument();
                expect(screen.getByText('new-context')).toBeInTheDocument();
            });
        });

        test('highlights recently updated contexts', async () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const recentContextData = [
                ...mockContextData,
                {
                    id: 'ctx4',
                    appId: 'test-app',
                    context: 'recent-update',
                    key: 'data',
                    value: 'fresh',
                    timestamp: Date.now() - 100, // Very recent
                    source: 'service',
                },
            ];

            act(() => {
                mockUseSelectEntitiesByIndexKey.mockReturnValue(recentContextData);
                jest.advanceTimersByTime(1000);
            });

            await waitFor(() => {
                const recentItem = screen.getByText('recent-update');
                expect(recentItem).toHaveClass('context-recent');
            });
        });

        test('maintains selection when data updates', async () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-session');
            fireEvent.click(contextItem);

            expect(screen.getByText('Context Details')).toBeInTheDocument();

            // Update data
            act(() => {
                mockUseSelectEntitiesByIndexKey.mockReturnValue([...mockContextData]);
            });

            await waitFor(() => {
                expect(screen.getByText('Context Details')).toBeInTheDocument();
            });
        });
    });

    describe('Context Value Types', () => {
        test('handles string values', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-preferences');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: string')).toBeInTheDocument();
            expect(screen.getByText('"dark"')).toBeInTheDocument();
        });

        test('handles object values', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('shopping-cart');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: object')).toBeInTheDocument();
        });

        test('handles array values', () => {
            const arrayContextData = [
                {
                    id: 'ctx1',
                    appId: 'test-app',
                    context: 'tags',
                    key: 'userTags',
                    value: ['admin', 'premium', 'beta'],
                    timestamp: Date.now(),
                    source: 'user-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(arrayContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('tags');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: array')).toBeInTheDocument();
            expect(screen.getByText('"admin"')).toBeInTheDocument();
            expect(screen.getByText('"premium"')).toBeInTheDocument();
        });

        test('handles number values', () => {
            const numberContextData = [
                {
                    id: 'ctx1',
                    appId: 'test-app',
                    context: 'stats',
                    key: 'loginCount',
                    value: 42,
                    timestamp: Date.now(),
                    source: 'analytics-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(numberContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('stats');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: number')).toBeInTheDocument();
            expect(screen.getByText('42')).toBeInTheDocument();
        });

        test('handles boolean values', () => {
            const booleanContextData = [
                {
                    id: 'ctx1',
                    appId: 'test-app',
                    context: 'features',
                    key: 'darkModeEnabled',
                    value: true,
                    timestamp: Date.now(),
                    source: 'ui-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(booleanContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('features');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: boolean')).toBeInTheDocument();
            expect(screen.getByText('true')).toBeInTheDocument();
        });

        test('handles null values', () => {
            const nullContextData = [
                {
                    id: 'ctx1',
                    appId: 'test-app',
                    context: 'temp',
                    key: 'tempData',
                    value: null,
                    timestamp: Date.now(),
                    source: 'service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(nullContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('temp');
            fireEvent.click(contextItem);

            expect(screen.getByText('Type: null')).toBeInTheDocument();
            expect(screen.getByText('null')).toBeInTheDocument();
        });
    });

    describe('Context History', () => {
        test('shows context change history', () => {
            const historyContextData = [
                {
                    id: 'ctx1-v1',
                    appId: 'test-app',
                    context: 'user-theme',
                    key: 'color',
                    value: 'light',
                    timestamp: Date.now() - 10000,
                    source: 'ui-service',
                    version: 1,
                },
                {
                    id: 'ctx1-v2',
                    appId: 'test-app',
                    context: 'user-theme',
                    key: 'color',
                    value: 'dark',
                    timestamp: Date.now() - 5000,
                    source: 'ui-service',
                    version: 2,
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(historyContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-theme');
            fireEvent.click(contextItem);

            expect(screen.getByText('Show History')).toBeInTheDocument();

            const historyButton = screen.getByText('Show History');
            fireEvent.click(historyButton);

            expect(screen.getByText('Context History')).toBeInTheDocument();
            expect(screen.getByText('"light"')).toBeInTheDocument();
            expect(screen.getByText('"dark"')).toBeInTheDocument();
        });

        test('displays history timestamps', () => {
            const historyContextData = [
                {
                    id: 'ctx1-v1',
                    appId: 'test-app',
                    context: 'user-theme',
                    key: 'color',
                    value: 'light',
                    timestamp: Date.now() - 10000,
                    source: 'ui-service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(historyContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('user-theme');
            fireEvent.click(contextItem);

            const historyButton = screen.getByText('Show History');
            fireEvent.click(historyButton);

            expect(screen.getByText(/10 seconds ago/)).toBeInTheDocument();
        });
    });

    describe('Context Export', () => {
        test('shows export button', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Export Contexts')).toBeInTheDocument();
        });

        test('exports context data', () => {
            // Mock URL.createObjectURL and related methods
            global.URL.createObjectURL = jest.fn(() => 'mock-url');
            global.URL.revokeObjectURL = jest.fn();

            const mockLink = {
                href: '',
                download: '',
                click: jest.fn(),
            };
            jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            jest.spyOn(document.body, 'appendChild').mockImplementation();
            jest.spyOn(document.body, 'removeChild').mockImplementation();

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const exportButton = screen.getByText('Export Contexts');
            fireEvent.click(exportButton);

            expect(document.createElement).toHaveBeenCalledWith('a');
            expect(mockLink.click).toHaveBeenCalled();
        });

        test('exports filtered contexts only', () => {
            global.URL.createObjectURL = jest.fn(() => 'mock-url');
            const mockLink = {
                href: '',
                download: '',
                click: jest.fn(),
            };
            jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            jest.spyOn(document.body, 'appendChild').mockImplementation();
            jest.spyOn(document.body, 'removeChild').mockImplementation();

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const filterInput = screen.getByPlaceholderText('Filter contexts...');
            fireEvent.change(filterInput, { target: { value: 'user' } });

            const exportButton = screen.getByText('Export Contexts');
            fireEvent.click(exportButton);

            expect(mockLink.click).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        test('handles database errors gracefully', () => {
            mockUseSelectEntitiesByIndexKey.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => {
                render(<ContextStoreMonitor selectedAppId="test-app" />);
            }).not.toThrow();

            expect(screen.getByText('Error loading contexts')).toBeInTheDocument();
        });

        test('handles malformed context data', () => {
            const malformedData = [
                {
                    id: null,
                    appId: undefined,
                    context: '',
                    key: null,
                    value: undefined,
                    timestamp: 'invalid',
                    source: null,
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(malformedData as any);

            expect(() => {
                render(<ContextStoreMonitor selectedAppId="test-app" />);
            }).not.toThrow();
        });

        test('handles circular reference in context values', () => {
            const circularObj: any = { name: 'test' };
            circularObj.self = circularObj;

            const circularContextData = [
                {
                    id: 'ctx1',
                    appId: 'test-app',
                    context: 'circular',
                    key: 'data',
                    value: circularObj,
                    timestamp: Date.now(),
                    source: 'service',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(circularContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const contextItem = screen.getByText('circular');
            fireEvent.click(contextItem);

            expect(screen.getByText('Circular reference detected')).toBeInTheDocument();
        });
    });

    describe('Performance Optimization', () => {
        test('handles large context datasets efficiently', () => {
            const largeContextData = Array.from({ length: 1000 }, (_, i) => ({
                id: `ctx${i}`,
                appId: 'test-app',
                context: `context${i}`,
                key: `key${i}`,
                value: `value${i}`,
                timestamp: Date.now() - i * 1000,
                source: `service${i}`,
            }));

            mockUseSelectEntitiesByIndexKey.mockReturnValue(largeContextData);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            // Should limit displayed contexts
            const contextItems = screen.getAllByText(/context\d+/);
            expect(contextItems.length).toBeLessThanOrEqual(100);
        });

        test('virtualizes long context lists', () => {
            const manyContexts = Array.from({ length: 500 }, (_, i) => ({
                id: `ctx${i}`,
                appId: 'test-app',
                context: `context${i}`,
                key: `key${i}`,
                value: `value${i}`,
                timestamp: Date.now() - i * 1000,
                source: 'service',
            }));

            mockUseSelectEntitiesByIndexKey.mockReturnValue(manyContexts);

            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByText('Show More')).toBeInTheDocument();
        });

        test('debounces filter input', async () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const filterInput = screen.getByPlaceholderText('Filter contexts...');

            // Rapidly type
            fireEvent.change(filterInput, { target: { value: 'u' } });
            fireEvent.change(filterInput, { target: { value: 'us' } });
            fireEvent.change(filterInput, { target: { value: 'use' } });
            fireEvent.change(filterInput, { target: { value: 'user' } });

            // Should debounce and only filter once
            await waitFor(() => {
                expect(screen.getByText('user-session')).toBeInTheDocument();
            });
        });
    });

    describe('Accessibility', () => {
        test('provides proper ARIA attributes', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Context list');
            expect(screen.getByPlaceholderText('Filter contexts...')).toHaveAttribute('aria-label', 'Filter contexts');
        });

        test('supports keyboard navigation', () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const firstContext = screen.getByText('user-session');

            fireEvent.keyDown(firstContext, { key: 'Enter' });
            expect(screen.getByText('Context Details')).toBeInTheDocument();

            fireEvent.keyDown(firstContext, { key: 'Escape' });
            expect(screen.queryByText('Context Details')).not.toBeInTheDocument();
        });

        test('provides screen reader announcements', async () => {
            render(<ContextStoreMonitor selectedAppId="test-app" />);

            const newContextData = [
                ...mockContextData,
                {
                    id: 'ctx4',
                    appId: 'test-app',
                    context: 'new-context',
                    key: 'key',
                    value: 'value',
                    timestamp: Date.now(),
                    source: 'service',
                },
            ];

            act(() => {
                mockUseSelectEntitiesByIndexKey.mockReturnValue(newContextData);
            });

            await waitFor(() => {
                expect(screen.getByLabelText(/New context added/)).toBeInTheDocument();
            });
        });
    });
});