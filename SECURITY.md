# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in C33D, please report it privately. Do not open a public issue.

## API Key Security

C33D is designed as a client-side architecture for executing LLM-generated node graphs.
- **Bring Your Own Key (BYOK)**: Users provide their own API keys (e.g., Gemini, OpenAI).
- **Local Storage**: API keys are stored exclusively in your browser's local storage.
- **No Telemetry**: C33D does not phone home, log your keys, or send your keys to any external server other than the direct API endpoints of the respective AI providers.

If you are hosting C33D, ensure that no secrets or API keys are committed to the repository (e.g., verify that `.vercel/` or `.env` files are in `.gitignore`).
