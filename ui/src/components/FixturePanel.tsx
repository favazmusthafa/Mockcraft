import { FC, useState, useEffect } from 'react';

interface FixtureEntry {
    filename: string;
    method: string;
    path: string;
    source: string;
    createdAt: string;
}

interface FixturePanelProps {
    config: { fixturesDir: string } | null;
}

const METHOD_COLORS: Record<string, string> = {
    GET: 'method-get',
    POST: 'method-post',
    PUT: 'method-put',
    PATCH: 'method-patch',
    DELETE: 'method-delete',
};

const SOURCE_ICONS: Record<string, string> = {
    manual: '✏️',
    proxy: '↗️',
    ai: '🤖',
};

export const FixturePanel: FC<FixturePanelProps> = ({ config }) => {
    const [fixtures, setFixtures] = useState<FixtureEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedFixture, setSelectedFixture] = useState<string | null>(null);
    const [fixtureDetail, setFixtureDetail] = useState<unknown>(null);

    // Fetch fixtures
    const fetchFixtures = async () => {
        setLoading(true);
        try {
            const res = await fetch('/__mockcraft__/api/fixtures');
            const data = await res.json();
            setFixtures(data.fixtures || []);
            setError(null);
        } catch {
            setError('Failed to load fixtures');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchFixtures(); }, []);

    // Delete fixture
    const handleDelete = async (filename: string) => {
        try {
            await fetch(`/__mockcraft__/api/fixtures/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
            });
            setFixtures(prev => prev.filter(f => f.filename !== filename));
            if (selectedFixture === filename) {
                setSelectedFixture(null);
                setFixtureDetail(null);
            }
        } catch {
            // silently fail
        }
    };

    // View fixture detail
    const handleView = async (fixture: FixtureEntry) => {
        if (selectedFixture === fixture.filename) {
            setSelectedFixture(null);
            setFixtureDetail(null);
            return;
        }
        try {
            const res = await fetch(
                `/__mockcraft__/api/fixtures/${fixture.method.toLowerCase()}/${fixture.path.replace(/^\//, '')}`,
            );
            const data = await res.json();
            setSelectedFixture(fixture.filename);
            setFixtureDetail(data);
        } catch {
            setFixtureDetail({ error: 'Failed to load fixture' });
            setSelectedFixture(fixture.filename);
        }
    };

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-100">Fixtures</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        Saved mock responses — from manual creation, proxy recording, or AI generation
                    </p>
                </div>
                <button onClick={fetchFixtures} className="btn-secondary text-xs">
                    ↻ Refresh
                </button>
            </div>

            {/* Loading */}
            {loading && (
                <div className="glass-card p-8 text-center">
                    <div className="animate-spin text-2xl mb-2">⏳</div>
                    <p className="text-sm text-zinc-500">Loading fixtures...</p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="glass-card p-4 border-red-500/20 bg-red-500/5">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            {/* Empty */}
            {!loading && !error && fixtures.length === 0 && (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-4">📦</div>
                    <h3 className="text-zinc-300 font-medium mb-2">No fixtures yet</h3>
                    <p className="text-sm text-zinc-500 max-w-md mx-auto">
                        Fixtures are created automatically from proxy recordings and AI-generated responses.
                        You can also create them manually.
                    </p>
                </div>
            )}

            {/* Fixture list */}
            {fixtures.length > 0 && (
                <div className="glass-card overflow-hidden">
                    <div className="divide-y divide-zinc-800/50">
                        {fixtures.map((fixture) => (
                            <div key={fixture.filename}>
                                <div
                                    className="px-4 py-3 flex items-center gap-4 hover:bg-surface-3/50 transition-colors cursor-pointer"
                                    onClick={() => handleView(fixture)}
                                >
                                    {/* Source icon */}
                                    <span className="text-sm shrink-0">
                                        {SOURCE_ICONS[fixture.source] || '📄'}
                                    </span>

                                    {/* Method badge */}
                                    <span className={`
                    px-2 py-0.5 rounded text-[11px] font-bold tracking-wider
                    border shrink-0 w-16 text-center
                    ${METHOD_COLORS[fixture.method] || 'bg-zinc-700/30 text-zinc-400 border-zinc-600/30'}
                  `}>
                                        {fixture.method}
                                    </span>

                                    {/* Path */}
                                    <span className="text-sm text-zinc-300 font-mono truncate flex-1">
                                        {fixture.path}
                                    </span>

                                    {/* Source label */}
                                    <span className="text-[10px] uppercase tracking-wider text-zinc-600 shrink-0">
                                        {fixture.source}
                                    </span>

                                    {/* Created */}
                                    <span className="text-xs text-zinc-600 font-mono shrink-0">
                                        {fixture.createdAt ? new Date(fixture.createdAt).toLocaleDateString() : '—'}
                                    </span>

                                    {/* Delete */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(fixture.filename); }}
                                        className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Delete fixture"
                                    >
                                        🗑
                                    </button>
                                </div>

                                {/* Detail expand */}
                                {selectedFixture === fixture.filename && fixtureDetail && (
                                    <div className="px-4 pb-4 bg-surface-3/30">
                                        <pre className="text-xs text-zinc-400 font-mono overflow-x-auto p-3 rounded-lg bg-surface-0/50 max-h-64 overflow-y-auto">
                                            {JSON.stringify(fixtureDetail, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
