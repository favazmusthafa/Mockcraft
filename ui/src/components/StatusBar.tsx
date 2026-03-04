import { FC } from 'react';

interface StatusBarProps {
    config: { port: number; ai: { provider: string }; proxy: { target: string } | null } | null;
    connected: boolean;
    eventCount: number;
}

export const StatusBar: FC<StatusBarProps> = ({ config, connected, eventCount }) => {
    return (
        <footer className="border-t border-zinc-800/50 bg-surface-1/50 backdrop-blur-sm px-6 py-2">
            <div className="max-w-7xl mx-auto flex items-center justify-between text-[11px] text-zinc-600">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                        <span className={`status-dot ${connected ? 'text-emerald-500' : 'text-zinc-700'}`} />
                        WebSocket {connected ? 'connected' : 'disconnected'}
                    </span>
                    <span>Events: {eventCount}</span>
                </div>

                <div className="flex items-center gap-4">
                    {config?.ai.provider !== 'none' && (
                        <span>AI: {config?.ai.provider}</span>
                    )}
                    {config?.proxy && (
                        <span>Proxy: active</span>
                    )}
                    <span className="font-mono">localhost:{config?.port || 3000}</span>
                </div>
            </div>
        </footer>
    );
};
