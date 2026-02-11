# LLCApp - Hybrid Developer Coding Agent

A CLI coding agent that uses local LLMs (Ollama) for free, with cloud fallback for complex tasks. Plan-review-run workflow ensures you always approve changes before they're applied.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment variables (optional - Ollama works without keys)
cp .env.example .env.local

# Run a coding task
node bin/llcapp.js "add a hello world function" --project ./my-project

# Rollback last changes
node bin/llcapp.js --rollback --project ./my-project

# View session history
node bin/llcapp.js --history
```

## Requirements

- Node.js 18+
- Ollama (recommended, for free local inference): https://ollama.com
  - Pull a code model: `ollama pull qwen2.5-coder:14b`

## How It Works

1. You submit a coding task via CLI
2. The agent classifies complexity and routes to local (Ollama) or cloud LLM
3. LLM generates a plan with file changes
4. You review colored diffs in the terminal
5. Approve to apply, reject to discard, or edit to modify
6. All actions logged to `sessions/` directory

## Provider Priority (free-first)

1. Ollama (local, free)
2. Groq (free tier)
3. Cerebras (free tier)
4. Together (free $25 credit)
5. Mistral (free tier)
6. Claude (paid fallback)
7. OpenAI (last resort)

## License

MIT
