---
name: Provider Chain Reference
description: Quick reference for LLM and image provider chains, API formats, and troubleshooting.
---

# Provider Chain Reference

## LLM Providers (UniversalLLMClient)

Config: `config/llm-providers.yaml`

| Priority | Provider | API Format | Auth Header | Free? |
|----------|----------|-----------|-------------|-------|
| 1 | Ollama | OpenAI-compat | None | Yes (local) |
| 2 | Groq | OpenAI-compat | Bearer token | Free tier |
| 3 | Cerebras | OpenAI-compat | Bearer token | Free |
| 4 | Together | OpenAI-compat | Bearer token | $25 credit |
| 5 | Mistral | OpenAI-compat | Bearer token | Free tier |
| 5 | Gemini | Native (`generateContent`) | API key in URL | Free tier |
| 6 | Claude | Native (`/messages`) | `x-api-key` header | Paid |
| 7 | OpenAI | OpenAI-compat | Bearer token | Paid |
| 99 | OpenRouter | OpenAI-compat | Bearer token | Aggregator |

## Image Providers (ImageClient)

Config: `config/image-providers.yaml`

| Priority | Provider | Auth | Method |
|----------|----------|------|--------|
| 1 | Pollinations.ai | None | GET (URL-encoded prompt) |
| 2 | Together AI | TOGETHER_API_KEY | POST (FLUX.1 Schnell Free) |
| 3 | Gemini | GEMINI_API_KEY | POST (generativelanguage API) |
| 4 | Stability AI | STABILITY_API_KEY | POST (25 free credits) |

## Adding a New Provider

1. Add entry to the appropriate YAML config file
2. For LLM: Add API format handling in `src/core/llm-client.js` if non-OpenAI-compatible
3. For Image: Add provider method in `src/core/image-client.js`
4. Add env var to `.env.local`
5. Test with the appropriate `--test` command

## Troubleshooting

- **Provider skipped**: Check API key in `.env.local`, check `enabled: true` in YAML
- **Budget exceeded**: Daily limit is $1.00, resets at midnight
- **Ollama unavailable**: Run `ollama serve` or check if port 11434 is open
- **Rate limited**: Provider chain auto-falls through to next available provider
