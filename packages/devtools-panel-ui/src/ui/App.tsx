import React from 'react';
import { useDevtoolsSocket } from './hooks/useDevtoolsSocket';
import { useAppSelection } from './hooks/useAppSelection';
import TopologyView from './TopologyView';
import {
    HashRouter,
    Routes,
    Route,
    useNavigate,
    useParams,
    useLocation,
    Navigate,
} from 'react-router-dom';
import StimulationsPage from './StimulationsPage';
import { Sidebar } from './Sidebar';

// Generate an opaque requestId for the request/response query protocol.
const genRequestId = (): string =>
    `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const App: React.FC = () => {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Navigate to="/apps" replace />} />
                <Route path="/apps" element={<AppInner />} />
                <Route path="/apps/:appId" element={<AppInner />} />
                <Route
                    path="/apps/:appId/stimulations"
                    element={<AppInner />}
                />
            </Routes>
        </HashRouter>
    );
};

export const AppInner: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const params = useParams();
    const routeAppId = params.appId as string | undefined;

    // WebSocket connection to the DevTools server (lifecycle + reconnect).
    const { wsRef, connectionStatus, send } = useDevtoolsSocket();

    // App / CNS selection state machine (selection + topology/stimulation queries).
    const {
        connectedApps,
        selectedAppId,
        selectedCnsId,
        effectiveSelectedAppId,
        selectApp,
        selectCns,
    } = useAppSelection({ send, navigate, routeAppId });

    return (
        <div
            className="no-smooth pixel-perfect"
            style={{
                display: 'flex',
                height: '100vh',
                width: '100vw',
                fontFamily: 'var(--font-primary)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
            }}
        >
            {/* Sidebar with app info */}
            <Sidebar
                connectionStatus={connectionStatus}
                connectedApps={connectedApps}
                selectedAppId={selectedAppId}
                effectiveSelectedAppId={effectiveSelectedAppId}
                selectedCnsId={selectedCnsId}
                wsRef={wsRef}
                send={send}
                onSelectApp={selectApp}
                onSelectCns={selectCns}
                onRefresh={() => {
                    send({
                        type: 'apps.query',
                        requestId: genRequestId(),
                    });
                    send({
                        type: 'topology.query',
                        requestId: genRequestId(),
                    });
                }}
            />

            {/* Main content area */}
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-primary)',
                    border: `1px solid var(--border-primary)`,
                    overflow: 'hidden',
                }}
            >
                {location.pathname.endsWith('/stimulations') ? (
                    <StimulationsPage
                        appId={effectiveSelectedAppId || ''}
                        wsRef={wsRef}
                        cnsId={selectedCnsId}
                    />
                ) : (
                    <TopologyView
                        appId={effectiveSelectedAppId}
                        cnsId={selectedCnsId}
                    />
                )}
            </div>
        </div>
    );
};
