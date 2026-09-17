# Context Core

Context Core is an AI-powered browser extension that provides PDF and e-book readers with instant, context-aware word meanings directly on the page, without opening new tabs or causing interruptions. It uses an LLM to explain what a word means in the context of what you are reading, helping you stay focused and finish books faster.

---

## Features

- **Context-Aware Definitions**: Explains words and phrases based on their surrounding sentence context rather than generic dictionary entries.
- **Dedicated PDF Reader with Find and Zoom**: Includes a customized PDF.js viewer with full in-document search/find navigation and adjustable zoom levels for local or remote PDFs.
- **In-Page Highlighting and Saving**: Save and highlight words or phrases directly within any webpage or PDF document as you read.
- **Vocabulary Review Section**: View, search, and manage all your saved words, definitions, tone indicators, and original contexts in the dedicated Vocabulary dashboard.
- **Multi-Provider LLM Support**: Connects to Google Gemini, OpenAI, and NVIDIA NIM.
- **Secure Bring Your Own Key (BYOK)**: Allows users to provide their own provider API keys with automated key/model validation, server-side AES-GCM encryption, and zero plaintext key storage in the browser extension.
- **Easy Key Management**: Easily add a new key or click **Remove saved provider key** to clear or update your credentials anytime.

---

## Architecture & Security Overview

- **Browser Extension**: Built with Manifest V3. Handles text selection, local caching, encrypted credential token management, and communication with the backend.
- **FastAPI Backend (`backend/app.py`)**: Central API gateway. Handles credential encryption/decryption, prompt assembly, and communication with LLM provider endpoints.
- **Security & Privacy**:
  - Provider API credentials are never sent from the backend to the extension.
  - In BYOK mode, user keys are registered via `POST /credentials`, encrypted server-side using AES-GCM (`CREDENTIAL_ENCRYPTION_KEY`), and referenced only by an opaque credential token.
  - The extension never stores plaintext LLM API keys in `chrome.storage`.

---

## Getting Started

### 1. Prerequisites & Environment Setup

All commands should be run from the repository root (`ContextCore`):

1. **Create the Python virtual environment**:
   ```bash
   python3 -m venv .venv
   ```
   *(Use `python` or `py` if `python3` is not found on Windows)*

2. **Activate the virtual environment**:
   - **macOS / Linux**:
     ```bash
     source .venv/bin/activate
     ```
   - **Windows (PowerShell)**:
     ```powershell
     .venv\Scripts\activate
     ```

3. **Install dependencies**:
   ```bash
   python -m pip install -r backend/requirements.txt
   ```

---

### 2. Configure LLM Provider & Environment Variables

1. **Generate a credential encryption key**:
   ```powershell
   python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
   ```

2. **Create `backend/.env`**:
   Create a `.env` file in the `backend/` directory:

   ```env
   CREDENTIAL_ENCRYPTION_KEY=your_generated_encryption_key_here
   ```

3. **Configure your preferred default provider** (for fallback / server-managed mode):

   - **Google Gemini**:
     ```env
     GEMINI_API_KEY=your_gemini_api_key_here
     LLM_MODEL=gemini-2.5-flash
     ```
     *(The backend uses Gemini's OpenAI-compatible endpoint automatically. Override with `GEMINI_BASE_URL` if needed.)*

   - **OpenAI**:
     ```env
     OPENAI_API_KEY=your_openai_api_key_here
     LLM_MODEL=gpt-4o-mini
     ```

   - **NVIDIA NIM**:
     ```env
     NVIDIA_API_KEY=your_nvidia_api_key_here
     NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
     LLM_MODEL=your-model-name
     ```

> **Note**: Never commit `backend/.env` or expose API keys. `backend/.env` is ignored by Git.

---

### 3. Start the Backend Server

From the repository root with `.venv` activated:

```bash
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

- **Local Backend URL**: `http://127.0.0.1:8000`
- **Health Check**:
  ```bash
  curl http://127.0.0.1:8000/health
  ```
  *Expected response:* `{"status":"healthy"}`

- **Test Definition Endpoint**:
  ```bash
  curl -X POST http://127.0.0.1:8000/define \
    -H "Content-Type: application/json" \
    -d '{"word":"bank","context":"She sat beside the bank of the river."}'
  ```

---

### 4. Run Backend Tests

Run automated tests with `pytest`:

```bash
python -m pytest backend/tests -q
```

---

### 5. Load and Configure the Browser Extension

1. Open Chrome, Edge, or Brave.
2. Navigate to `chrome://extensions`.
3. Toggle on **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the `extension/` directory from this project.
6. Click the Context Core extension icon in your browser toolbar to open the popup.
7. Under **Bring Your Own Provider Key**, select your provider (Google Gemini, OpenAI, or NVIDIA NIM).
8. Enter your provider API key and an optional model override.
9. Click **Save settings**.
   - The extension immediately verifies whether the entered API key and model are correct and functional with the backend.
   - If valid, the key is registered and encrypted server-side. The plaintext key is removed from the extension interface.
10. **Managing Keys**: To change your key or remove an existing one, click **Remove saved provider key** in the popup, then enter your new provider credentials.

> **Note**: The backend URL is configured in `extension/crypto.js` (`BACKEND_ENDPOINT`). When deploying to production, update this URL to your deployed API (e.g., `https://api.yourdomain.com/define`).

---

### 6. Verify API Key Encryption

To verify that the provider API key is not stored in plaintext:

1. Open the Context Core popup.
2. Right-click inside the popup and choose **Inspect**.
3. Select a provider, enter a test key (e.g., `test-key-not-real`), and click **Save settings**.
4. In DevTools Console, run:
   ```javascript
   const data = await chrome.storage.local.get(null);
   console.log(data);
   ```
5. Confirm storage contains encrypted values (`contextCoreCredentialId`, `contextCoreCredentialTokenEncrypted`, `contextCoreEncryptionKey`) and does **not** contain plaintext keys (`contextCoreApiKey`, `contextCoreLlmApiKey`).
6. Verify settings decryption in extension memory:
   ```javascript
   const settings = await ContextCoreCrypto.readSettings();
   console.log(Boolean(settings.contextCoreCredentialToken));
   ```
   *Should print `true`.*

---

### 7. Usage Flow

#### Webpages
1. Highlight any word or phrase on a webpage.
2. Click **Explain** in the floating tooltip to see the instant, context-aware definition.
3. Click **Save** to highlight the word directly on the page and save it to your vocabulary list.

#### PDF Reader
1. Open the extension popup and click **Open PDF reader**.
2. Choose a local PDF file or enter a PDF URL.
3. **Find in Document**: Use the search input in the toolbar to find terms, view match counts, and jump between previous/next occurrences.
4. **Zoom Controls**: Use the zoom in (`+`) and zoom out (`-`) buttons or view the zoom percentage badge to adjust page scaling.
5. **Explain & Save**: Select any text in the PDF reader, click **Explain**, and click **Save** to highlight the term in the document and store it in your vocabulary.

#### Vocabulary Section
1. Open the extension popup and click **Vocabulary** (or open the Saved Words page).
2. Browse all saved words along with their definitions, tone, contextual sentences, and timestamps.
3. Search and filter through your personal vocabulary list for study and review.

---

## Repository Structure

```text
ContextCore/
├── backend/
│   ├── app.py                     # FastAPI application endpoints (POST /define, GET /health, POST /credentials)
│   ├── config.py                  # Environment and provider credential management
│   ├── exceptions.py              # Custom error definitions and handlers
│   ├── prompts.py                 # LLM system and user prompt definitions
│   ├── requirements.txt           # Python dependencies
│   ├── schemas.py                 # Pydantic models for request/response validation
│   ├── services/
│   │   ├── credential_service.py  # Server-side credential encryption & token handling
│   │   └── llm_service.py         # Provider client integration (Gemini, OpenAI, NVIDIA)
│   └── tests/                     # Unit, integration, and scenario tests
├── extension/
│   ├── manifest.json              # Chrome extension manifest (v3)
│   ├── content.js                 # Webpage text selection, UI tooltips, and lookup handlers
│   ├── crypto.js                  # Client-side encryption & API configuration
│   ├── popup.html / popup.js      # Extension popup UI & BYOK settings
│   ├── saved-words.html / .js     # Saved words dashboard
│   ├── pdf-viewer.html            # Dedicated PDF viewer page
│   ├── pdf-reader.js              # PDF text selection & explanation handler
│   └── lib/pdfjs/                 # Bundled PDF.js library
├── LICENSE
├── README.md
└── SRS.md
```

---

## Git Workflow for Contributors

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

> Remember: Never commit secrets, `.env` files, or virtual environment directories.
