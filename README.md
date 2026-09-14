# Context Core
Context Core is an AI-powered browser extension that gives PDF and e-book readers instant, context-aware word meanings — right on the page, with no new tabs or interruptions. It uses an LLM to explain what a word means in the context of what you're reading, helping readers stay focused and finish books faster.

## PDF reader

Open the extension popup and choose **Open PDF reader**. Select a local PDF or enter a PDF URL to open it with the bundled PDF.js viewer. Text rendered by the viewer can be selected for the existing Context Core lookup flow.

## Backend

The official backend is the Python FastAPI app in `backend/app.py`.

Run it from the project root with:

```bash
uvicorn backend.app:app --reload --port 8000
```

Configure this endpoint in the extension settings:

```text
http://127.0.0.1:8000/define
```

The extension sends `POST /define` with `word` and `context`. It can also send `provider`, `api_key`, and `model` directly for Google Gemini, OpenAI, or NVIDIA NIM. When those fields are omitted, the backend falls back to its `.env` configuration. The backend accepts the word aliases used by the extension and returns a response containing `meaning`, which the extension displays as the explanation.

The backend supports Google Gemini, OpenAI, and NVIDIA NIM. For direct browser-to-backend configuration, enter the provider, LLM API key, and optional model in the extension settings. API keys are stored in extension-local storage and sent only to the configured backend endpoint.
