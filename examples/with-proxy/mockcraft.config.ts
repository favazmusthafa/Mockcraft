// Example: Mockcraft with proxy recording
// Records real API responses as fixtures for replay

export default {
    port: 3000,
    fixturesDir: './fixtures',

    proxy: {
        target: 'https://jsonplaceholder.typicode.com',
        record: true,
        forwardAuth: false,
    },

    ai: {
        provider: 'none' as const,
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 800,
    },
};
