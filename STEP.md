# ContentCore Setup Steps

This project uses **FastAPI**, not Flask.

## 1. Open the project folder

All commands below should be run from the repository root:

```text
/Users/rajuram/Desktop/ContentCore
```

In a terminal:

```bash
cd /Users/rajuram/Desktop/ContentCore
```

## 2. Create the Python environment

Create the environment once:

```bash
python3 -m venv .venv
```

Activate it whenever you work on the backend:

macOS/Linux:

```bash
source .venv/bin/activate
```

Windows:

```powershell
.venv\Scripts\activate
```

After activation, the terminal should show `(.venv)`.

## 3. Install backend packages

With the environment activated, run:

```bash
python -m pip install -r backend/requirements.txt
```

The backend uses:

- FastAPI
- Uvicorn
- Pydantic
- OpenAI-compatible client
- HTTPX
- python-dotenv
- pytest

## 4. Add the LLM provider key

Create this file:

```text
backend/.env
```

For OpenAI:

```env
OPENAI_API_KEY=put_your_real_key_here
LLM_MODEL=gpt-4o-mini
```

For NVIDIA NIM:

```env
NVIDIA_API_KEY=put_your_real_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_MODEL=your-model-name
```

Never commit `backend/.env` or send the key in chat. `.env` is ignored by Git.

The backend reads this file through:

```text
backend/config.py
```

## 5. Start the FastAPI backend

From the repository root, with `.venv` active:

```bash
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

Keep this terminal running.

The local backend URL is:

```text
http://127.0.0.1:8000
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

The response should contain `"status":"healthy"`.

## 6. Test the definition endpoint

Run this in a second terminal:

```bash
curl -X POST http://127.0.0.1:8000/define \
  -H "Content-Type: application/json" \
  -d '{"word":"bank","context":"She sat beside the bank of the river."}'
```

A successful response contains fields such as:

```json
{
  "status": "success",
  "meaning": "...",
  "tone": "...",
  "synonym": "...",
  "example": "...",
  "simplified_passage": "..."
}
```

If the response says the definition service is unavailable, check that the provider key exists in `backend/.env` and restart Uvicorn.

## 7. Run backend tests

With `.venv` active:

```bash
python -m pytest backend/tests -q
```

All tests should pass before pushing backend changes.

## 8. Load the browser extension

1. Open Chrome or Edge.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:

```text
/Users/rajuram/Desktop/ContentCore/extension
```

6. Click the ContentCore extension icon.
7. In **Lookup endpoint**, enter:

```text
http://127.0.0.1:8000/define
```

8. Leave the extension API key empty for the local FastAPI setup.
9. Click **Save settings**.

## 9. Test the complete flow

### Webpage

1. Open any webpage with selectable text.
2. Highlight a word or phrase.
3. Click **Explain**.
4. The extension sends `word` and nearby `context` to `POST /define`.
5. The returned `meaning` appears in the popup.
6. Click **Save** to store the lookup locally in Chrome storage.

### PDF

1. Open the extension popup.
2. Click **Open ContentCore PDF Reader**.
3. Choose a local PDF.
4. Highlight text in the PDF.
5. Click **Explain**.
6. After a successful response, click **Save**.

Chrome's built-in PDF viewer is isolated from the extension. Use the ContentCore PDF Reader for PDFs.

## 10. Files and their roles

- `backend/app.py`: FastAPI application with `POST /define` and `GET /health`.
- `backend/config.py`: Reads provider keys and backend settings from `.env`.
- `backend/schemas.py`: Validates request and response data.
- `backend/prompts.py`: Contains the LLM instructions.
- `backend/services/llm_service.py`: Calls the configured LLM provider.
- `backend/exceptions.py`: Defines backend error responses.
- `backend/requirements.txt`: Python dependencies.
- `extension/manifest.json`: Browser extension configuration.
- `extension/popup.html`: Endpoint and API key settings page.
- `extension/popup.js`: Saves extension settings locally.
- `extension/content.js`: Webpage selection, context extraction, lookup, caching, and Save.
- `extension/pdf-viewer.html`: Dedicated PDF reader page.
- `extension/pdf-reader.js`: PDF rendering, PDF text selection, lookup, and Save.
- `extension/lib/pdfjs/`: Bundled PDF.js files.

## 11. Git workflow for the team

Before starting work:

```bash
git fetch origin
git switch dev-2
git merge origin/main
```

After making changes:

```bash
git status
git add .
git commit -m "Describe the change"
git push origin dev-2
```

Do not add secrets, `.env` files, virtual environments, or `node_modules` to Git.
