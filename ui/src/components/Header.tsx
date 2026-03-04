import { FC } from 'react';

interface ServerConfig {
    port: number;
    ai: { provider: string; model: string; hasApiKey: boolean };
    proxy: { target: string } | null;
}

interface HeaderProps {
    config: ServerConfig | null;
    connected: boolean;
}

export const Header: FC<HeaderProps> = ({ config, connected }) => {
    return (
        <header className="border-b border-zinc-800/50 bg-surface-1/80 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-pink-500 flex items-center justify-center text-lg shadow-lg shadow-brand-600/20">
                        ⚡
                    </div>
                    <div>
                        <h1 className="text-lg font-bold gradient-text">Mockcraft</h1>
                        <p className="text-xs text-zinc-500">Inspector v0.1.0</p>
                    </div>
                </div>

                {/* Status indicators */}
                <div className="flex items-center gap-4">
                    {/* Connection status */}
                    <div className="flex items-center gap-2 text-xs">
                        <span className={`status-dot ${connected ? 'text-emerald-400' : 'text-zinc-600'}`} />
                        <span className={connected ? 'text-zinc-400' : 'text-zinc-600'}>
                            {connected ? 'Live' : 'Disconnected'}
                        </span>
                    </div>

                    {/* AI provider */}
                    {config?.ai.provider !== 'none' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-3 border border-zinc-800/50 text-xs">
                            <span className="text-pink-400">🤖</span>
                            <span className="text-zinc-400">{config?.ai.provider}</span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-zinc-500 font-mono">{config?.ai.model}</span>
                        </div>
                    )}

                    {/* Proxy indicator */}
                    {config?.proxy && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-3 border border-zinc-800/50 text-xs">
                            <span className="text-amber-400">↗</span>
                            <span className="text-zinc-400 font-mono truncate max-w-[150px]">
                                {config.proxy.target}
                            </span>
                        </div>
                    )}

                    {/* Port */}
                    <div className="text-xs text-zinc-600 font-mono">
                        :{config?.port || 3000}
                    </div>
                </div>
            </div>
        </header>
    );
};
