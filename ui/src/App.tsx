import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { RequestLog } from './components/RequestLog';
import { FixturePanel } from './components/FixturePanel';
import { AIPanel } from './components/AIPanel';
import { StatusBar } from './components/StatusBar';

// ─── Types ───────────────────────────────────────────────────

interface MockcraftEvent {
    type: string;
    method?: string;
    path?: string;
    status?: number;
    source?: string;
    timestamp: number;
    data?: Record<string, unknown>;
}

interface ServerConfig {
    port: number;
    fixturesDir: string;
    schemaPath: string | null;
    proxy: { target: string; record: boolean; forwardAuth: boolean } | null;
    ai: {
        provider: string;
        model: string;
        temperature: number;
        maxTokens: number;
        hasApiKey: boolean;
        baseUrl?: string;
    };
}

type Tab = 'requests' | 'fixtures' | 'ai';

// ─── App Component ───────────────────────────────────────────

export default function App() {
    const [events, setEvents] = useState<MockcraftEvent[]>([]);
    const [config, setConfig] = useState<ServerConfig | null>(null);
    const [connected, setConnected] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('requests');
    const wsRef = useRef<WebSocket | null>(null);

    // Fetch server config
    useEffect(() => {
        fetch('/__mockcraft__/api/health')
            .then(r => r.json())
            .then(() => {
                return fetch('/__mockcraft__/api/config');
            })
            .then(r => r.json())
            .then(setConfig)
            .catch(console.error);
    }, []);

    // WebSocket connection for live events
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/__mockcraft__/ws`;

        function connect() {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data) as MockcraftEvent;
                    setEvents(prev => [data, ...prev].slice(0, 200)); // Keep last 200 events
                } catch {
                    // Ignore malformed messages
                }
            };

            ws.onclose = () => {
                setConnected(false);
                // Reconnect after 3s
                setTimeout(connect, 3000);
            };

            ws.onerror = () => {
                ws.close();
            };
        }

        connect();
        return () => {
            wsRef.current?.close();
        };
    }, []);

    const clearEvents = useCallback(() => setEvents([]), []);

    return (
        <div className="min-h-screen bg-surface-0 flex flex-col">
            <Header config={config} connected={connected} />

            {/* Tab Navigation */}
            <div className="border-b border-zinc-800/50 bg-surface-1/50 backdrop-blur-sm sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6">
                    <nav className="flex gap-1" aria-label="Tabs">
                        {([
                            { key: 'requests' as Tab, label: 'Live Requests', icon: '⚡' },
                            { key: 'fixtures' as Tab, label: 'Fixtures', icon: '📦' },
                            { key: 'ai' as Tab, label: 'AI Studio', icon: '🤖' },
                        ]).map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`
                  px-4 py-3 text-sm font-medium transition-all duration-200
                  border-b-2 -mb-[1px]
                  ${activeTab === tab.key
                                        ? 'border-brand-500 text-white'
                                        : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                                    }
                `}
                            >
                                <span className="mr-1.5">{tab.icon}</span>
                                {tab.label}
                                {tab.key === 'requests' && events.length > 0 && (
                                    <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-brand-600/20 text-brand-400">
                                        {events.length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Content */}
            <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
                {activeTab === 'requests' && (
                    <RequestLog events={events} onClear={clearEvents} />
                )}
                {activeTab === 'fixtures' && (
                    <FixturePanel config={config} />
                )}
                {activeTab === 'ai' && (
                    <AIPanel config={config} />
                )}
            </main>

            <StatusBar config={config} connected={connected} eventCount={events.length} />
        </div>
    );
}
