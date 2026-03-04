# ⚡ Mockcraft

> **The smartest local mock server ever built** — AI-powered fixtures, proxy recording, and a beautiful inspector UI. Zero config, instant start.

[![CI](https://github.com/favazmusthafa/Mockcraft/actions/workflows/ci.yml/badge.svg)](https://github.com/favazmusthafa/Mockcraft/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)

---

## ✨ Features

- **🚀 Instant Start** — `npx mockcraft` and you're running in < 90 seconds
- **🤖 AI Fallback** — No fixture? No schema? AI generates realistic responses via **Ollama**, **Grok**, or **Claude**
- **📦 Smart Fixtures** — Hash-based replay/record with auto-save from AI and proxy
- **↗️ Proxy Recording** — Record real API responses for offline replay
- **📋 OpenAPI Support** — Auto-serve example responses from your OpenAPI 3.x schema
- **🖥️ Beautiful Inspector** — Dark-mode dashboard with live WebSocket stream
- **🔒 Security Hardened** — SSRF protection, path traversal prevention, rate limiting, API key redaction
- **📡 Programmatic API** — Use as a library in your Node.js applications

## 🚀 Quick Start

```bash
# Start immediately (zero config)
npx mockcraft

# Initialize a project with config file
npx mockcraft init

# Start with options
npx mockcraft --port 4000
npx mockcraft --proxy https://api.real.com

# Generate fixtures with AI
npx mockcraft generate --prompt "SaaS todo API with auth" --provider ollama
```

Open **<http://localhost:3000/__mockcraft>__** for the inspector UI.

## 📦 Installation

```bash
npm install -g mockcraft
# or use directly
npx mockcraft
```

## ⚙️ Configuration

Create `mockcraft.config.ts` (or `.json`) in your project root:

```typescript
export default {
  port: 3000,
  schemaPath: './openapi.json',
  fixturesDir: './fixtures',

  proxy: {
    target: 'https://api.real.com',
    record: true,
    forwardAuth: false,
  },

  ai: {
    provider: 'ollama',        // 'ollama' | 'grok' | 'claude' | 'none'
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    temperature: 0.7,
    maxTokens: 800,
  },
};
```

### AI Providers

| Provider | Setup | Cost |
|----------|-------|------|
| **Ollama** | `ollama serve` + `ollama pull llama3.2` | Free (local) |
| **Grok** | Set `GROK_API_KEY` env var | API pricing |
| **Claude** | Set `ANTHROPIC_API_KEY` env var | API pricing |

> **Security Note:** API keys are loaded exclusively from environment variables — never from config files, never logged, never returned in API responses.

## 🔀 Route Resolution Order

Mockcraft resolves requests in this priority:

1. **Fixture** — Saved responses (manual, proxy-recorded, or AI-generated)
2. **OpenAPI Schema** — Example responses from your spec
3. **Proxy** — Forward to real API (with optional recording)
4. **AI Fallback** — Generate realistic response on-the-fly

## 🖥️ Inspector UI

The built-in dashboard at `/__mockcraft__` provides:

- **Live Requests** — Real-time request/response stream via WebSocket
- **Fixtures Browser** — View, expand, and delete saved fixtures
- **AI Studio** — Generate mock responses with one click, choose presets

## 🔒 Security

Mockcraft is hardened for local development:

- **SSRF Protection** — Ollama restricted to `localhost:*`, remote providers require `https://`
- **Path Traversal** — All file operations validate paths with `path.resolve()` + `realpathSync()`
- **Rate Limiting** — 10 AI calls/minute per endpoint
- **Input Validation** — 1MB body limit, Zod schema validation
- **CORS** — Locked to `localhost` and `127.0.0.1` only
- **Header Stripping** — Auth/Cookie headers stripped from proxy requests by default
- **Redaction** — API keys and tokens never appear in logs or responses
- **Security Headers** — `X-Content-Type-Options`, `X-Frame-Options`, CSP, and more

## 📡 Programmatic API

```typescript
import { createServer } from 'mockcraft';

const server = await createServer({
  port: 3000,
  fixturesDir: './fixtures',
  ai: { provider: 'ollama', model: 'llama3.2', temperature: 0.7, maxTokens: 800 },
});

// server.app — Hono instance
// server.close() — shutdown
```

## 🧪 Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
npm run lint       # Type check
```

## 📂 Project Structure

```
mockcraft/
├── src/
│   ├── cli.ts          # CLI entry point (init, serve, generate)
│   ├── server.ts       # Hono server with middleware stack
│   ├── config.ts       # Config loader with Zod validation
│   ├── security.ts     # Shared security helpers
│   ├── fixtures.ts     # Fixture management (CRUD + hashing)
│   ├── schema.ts       # OpenAPI 3.x parser
│   ├── ai.ts           # AI providers (Ollama, Grok, Claude)
│   ├── proxy.ts        # Reverse proxy with recording
│   ├── ws.ts           # WebSocket live inspector
│   └── api.ts          # Internal API for UI dashboard
├── ui/                 # React + Tailwind inspector dashboard
├── tests/              # Vitest test suites
├── examples/           # Example configurations
└── fixtures/           # Saved mock responses (gitignored)
```

## 🤝 Contributing

Contributions welcome! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) and submit PRs.

## 📄 License

[MIT](LICENSE) © Mockcraft Contributors

---

<p align="center">
  <strong>⚡ Built for developers who hate waiting.</strong>
</p>
