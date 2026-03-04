import { FC } from 'react';

interface MockcraftEvent {
    type: string;
    method?: string;
    path?: string;
    status?: number;
    source?: string;
    timestamp: number;
    data?: Record<string, unknown>;
}

interface RequestLogProps {
    events: MockcraftEvent[];
    onClear: () => void;
}

const METHOD_CLASSES: Record<string, string> = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    PATCH: 'method-patch',
    DELETE: 'method-delete',
};

const SOURCE_CLASSES: Record<string, string> = {
    fixture: 'source-fixture',
    schema: 'source-schema',
    proxy: 'source-proxy',
    ai: 'source-ai',
};

const STATUS_COLORS: Record<string, string> = {
    '2': 'text-emerald-400',
    '3': 'text-blue-400',
    '4': 'text-amber-400',
    '5': 'text-red-400',
};

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function getStatusColor(status: number | undefined): string {
    if (!status) return 'text-zinc-500';
    const category = String(Math.floor(status / 100));
    return STATUS_COLORS[category] || 'text-zinc-500';
}

export const RequestLog: FC<RequestLogProps> = ({ events, onClear }) => {
    const requests = events.filter(e => e.type === 'request' || e.type === 'response');

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-100">Live Requests</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        Real-time request & response stream via WebSocket
                    </p>
                </div>
                <button onClick={onClear} className="btn-secondary text-xs">
                    Clear ({requests.length})
                </button>
            </div>

            {/* Empty state */}
            {requests.length === 0 && (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-4">⚡</div>
                    <h3 className="text-zinc-300 font-medium mb-2">Waiting for requests...</h3>
                    <p className="text-sm text-zinc-500 max-w-md mx-auto">
                        Send requests to your mock server and they'll appear here in real-time.
                        <br />
                        Try: <code className="text-brand-400 bg-surface-3 px-1.5 py-0.5 rounded text-xs">
                            curl http://localhost:3000/api/users
                        </code>
                    </p>
                </div>
            )}

            {/* Event list */}
            {requests.length > 0 && (
                <div className="glass-card overflow-hidden">
                    <div className="divide-y divide-zinc-800/50">
                        {requests.map((event, i) => (
                            <div
                                key={`${event.timestamp}-${i}`}
                                className="px-4 py-3 flex items-center gap-4 hover:bg-surface-3/50 transition-colors duration-150 animate-slide-up"
                            >
                                {/* Time */}
                                <span className="text-xs text-zinc-600 font-mono w-20 shrink-0">
                                    {formatTime(event.timestamp)}
                                </span>

                                {/* Type indicator */}
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${event.type === 'request' ? 'bg-blue-400' : 'bg-emerald-400'
                                    }`} />

                                {/* Method badge */}
                                {event.method && (
                                    <span className={`
                    px-2 py-0.5 rounded text-[11px] font-bold tracking-wider
                    border shrink-0 w-16 text-center
                    ${METHOD_CLASSES[event.method] || 'bg-zinc-700/30 text-zinc-400 border-zinc-600/30'}
                  `}>
                                        {event.method}
                                    </span>
                                )}

                                {/* Path */}
                                <span className="text-sm text-zinc-300 font-mono truncate flex-1">
                                    {event.path}
                                </span>

                                {/* Status */}
                                {event.status && (
                                    <span className={`text-xs font-mono font-bold shrink-0 ${getStatusColor(event.status)}`}>
                                        {event.status}
                                    </span>
                                )}

                                {/* Source */}
                                {event.source && (
                                    <span className={`
                    px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider shrink-0
                    ${SOURCE_CLASSES[event.source] || 'bg-zinc-700/20 text-zinc-500'}
                  `}>
                                        {event.source}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
