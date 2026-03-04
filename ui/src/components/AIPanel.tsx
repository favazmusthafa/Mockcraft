import { FC, useState } from 'react';

interface AIPanelProps {
    config: {
        ai: {
            provider: string;
            model: string;
            hasApiKey: boolean;
            temperature: number;
        };
    } | null;
}

interface AIResult {
    success: boolean;
    response?: { status: number; body: unknown; provider: string; model: string };
    error?: string;
}

export const AIPanel: FC<AIPanelProps> = ({ config }) => {
    const [method, setMethod] = useState('GET');
    const [path, setPath] = useState('/api/users');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AIResult | null>(null);

    const isEnabled = config?.ai.provider !== 'none';

    const handleGenerate = async () => {
        setLoading(true);
        setResult(null);

        try {
            const res = await fetch('/__mockcraft__/api/ai/regenerate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method, path }),
            });

            const data = await res.json();

            if (res.ok) {
                setResult({ success: true, response: data.response });
            } else {
                setResult({ success: false, error: data.error || 'Generation failed' });
            }
        } catch {
            setResult({ success: false, error: 'Failed to connect to server' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h2 className="text-lg font-semibold text-zinc-100">AI Studio</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                    Generate realistic mock responses using AI — saved automatically as fixtures
                </p>
            </div>

            {/* Provider Status Card */}
            <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-300">Provider Configuration</h3>
                    <span className={`
            px-2.5 py-1 rounded-full text-[11px] font-medium
            ${isEnabled
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-700/30 text-zinc-500 border border-zinc-600/30'
                        }
          `}>
                        {isEnabled ? '● Active' : '○ Inactive'}
                    </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-600 block mb-1">Provider</label>
                        <div className="text-sm text-zinc-300 font-mono">{config?.ai.provider || 'none'}</div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-600 block mb-1">Model</label>
                        <div className="text-sm text-zinc-300 font-mono">{config?.ai.model || '—'}</div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-600 block mb-1">API Key</label>
                        <div className="text-sm text-zinc-300">
                            {config?.ai.provider === 'ollama'
                                ? <span className="text-zinc-500">Not needed</span>
                                : config?.ai.hasApiKey
                                    ? <span className="text-emerald-400">●●●●●●</span>
                                    : <span className="text-red-400">Not set</span>
                            }
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-600 block mb-1">Temperature</label>
                        <div className="text-sm text-zinc-300 font-mono">{config?.ai.temperature ?? 0.7}</div>
                    </div>
                </div>
            </div>

            {/* Generate Form */}
            <div className="glass-card p-5">
                <h3 className="text-sm font-medium text-zinc-300 mb-4">🤖 Regenerate with AI</h3>

                <div className="flex gap-3 mb-4">
                    {/* Method select */}
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-surface-3 border border-zinc-700/50 text-sm text-zinc-300 font-mono focus:outline-none focus:border-brand-500/50 transition-colors"
                    >
                        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>

                    {/* Path input */}
                    <input
                        type="text"
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder="/api/endpoint"
                        className="flex-1 px-3 py-2 rounded-lg bg-surface-3 border border-zinc-700/50 text-sm text-zinc-300 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/50 transition-colors"
                    />

                    {/* Generate button */}
                    <button
                        onClick={handleGenerate}
                        disabled={loading || !isEnabled || !path}
                        className={`btn-primary flex items-center gap-2 ${(loading || !isEnabled) ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                    >
                        {loading ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                Generating...
                            </>
                        ) : (
                            <>
                                <span>✨</span>
                                Generate
                            </>
                        )}
                    </button>
                </div>

                {!isEnabled && (
                    <p className="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                        ⚠️ AI provider is not configured. Set <code className="font-mono">ai.provider</code> in your mockcraft.config.ts
                    </p>
                )}
            </div>

            {/* Result */}
            {result && (
                <div className={`glass-card p-5 ${result.success ? '' : 'border-red-500/20'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-zinc-300">
                            {result.success ? '✅ Generated Response' : '❌ Error'}
                        </h3>
                        {result.response && (
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <span className="font-mono">{result.response.provider}/{result.response.model}</span>
                                <span className={`font-bold ${result.response.status < 300 ? 'text-emerald-400' : 'text-amber-400'
                                    }`}>
                                    {result.response.status}
                                </span>
                            </div>
                        )}
                    </div>

                    {result.success && result.response ? (
                        <pre className="text-xs text-zinc-400 font-mono overflow-x-auto p-3 rounded-lg bg-surface-0/50 max-h-80 overflow-y-auto">
                            {JSON.stringify(result.response.body, null, 2)}
                        </pre>
                    ) : (
                        <p className="text-sm text-red-400">{result.error}</p>
                    )}
                </div>
            )}

            {/* Quick presets */}
            <div className="glass-card p-5">
                <h3 className="text-sm font-medium text-zinc-300 mb-3">Quick Presets</h3>
                <div className="flex flex-wrap gap-2">
                    {[
                        { m: 'GET', p: '/api/users', label: 'List Users' },
                        { m: 'GET', p: '/api/users/1', label: 'Get User' },
                        { m: 'POST', p: '/api/users', label: 'Create User' },
                        { m: 'GET', p: '/api/products', label: 'List Products' },
                        { m: 'POST', p: '/api/auth/login', label: 'Login' },
                        { m: 'GET', p: '/api/orders', label: 'List Orders' },
                    ].map((preset) => (
                        <button
                            key={`${preset.m}-${preset.p}`}
                            onClick={() => { setMethod(preset.m); setPath(preset.p); }}
                            className="px-3 py-1.5 rounded-lg text-xs bg-surface-3 hover:bg-surface-4 text-zinc-400 hover:text-zinc-300 border border-zinc-800/50 hover:border-zinc-700/50 transition-all"
                        >
                            <span className="font-mono text-[10px] mr-1 opacity-60">{preset.m}</span>
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
