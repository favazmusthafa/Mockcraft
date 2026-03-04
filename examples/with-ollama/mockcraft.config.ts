// Example: Mockcraft with Ollama (local AI)
// Requires Ollama running at http://localhost:11434

export default {
    port: 3000,
    fixturesDir: './fixtures',

    ai: {
        provider: 'ollama' as const,
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 800,
    },
};
