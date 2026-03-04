// Example: Basic Mockcraft configuration
// No AI, no proxy — just fixtures

export default {
    port: 3000,
    fixturesDir: './fixtures',

    ai: {
        provider: 'none' as const,
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 800,
    },
};
