# BrightForge - Hybrid Developer Coding + Design Agent

A CLI coding and design agent that uses local LLMs (Ollama) for free, with cloud fallback for complex tasks. Features AI-powered image generation and HTML layout creation. Plan-review-run workflow ensures you always approve changes before they're applied.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment variables (optional - Ollama works without keys)
cp .env.example .env.local

# Run a coding task
node bin/brightforge.js "add a hello world function" --project ./my-project

# Generate a design
node bin/brightforge.js --design "landing page for a coffee shop" --style blue-glass

# Rollback last changes
node bin/brightforge.js --rollback --project ./my-project

# View session history
node bin/brightforge.js --history

# Start web dashboard
npm run server
```

## Requirements

- Node.js 18+
- Ollama (recommended, for free local inference): https://ollama.com
  - Pull a code model: `ollama pull qwen2.5-coder:14b`

## How It Works

### Coding Workflow

1. You submit a coding task via CLI
2. The agent classifies complexity and routes to local (Ollama) or cloud LLM
3. LLM generates a plan with file changes
4. You review colored diffs in the terminal
5. Approve to apply, reject to discard, or edit to modify
6. All actions logged to `sessions/` directory

### Design Engine

1. Describe your design (e.g., "landing page for a coffee shop")
2. Select a style (default, blue-glass, dark-industrial)
3. BrightForge generates images via free-tier AI providers (Pollinations, Together AI, Gemini)
4. LLM creates semantic HTML layout with inline CSS
5. Preview design in terminal or web dashboard
6. Approve to export HTML + images to `output/designs/`

**Design Features:**
- Free-first image generation (no API keys required for Pollinations)
- Multiple design styles with customizable palettes
- Responsive layouts with semantic HTML5
- Web dashboard with live preview
- Export to standalone HTML files

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
