# ContentCore

ContentCore is a Chrome/Edge browser extension for looking up words while reading webpages and PDFs.

It sends the selected word and nearby text to an LLM backend. The backend returns a short explanation that matches the way the word is used in the document.

## How To Use It

1. Open `chrome://extensions`.
2. Turn on Developer mode and load the `extension` folder as an unpacked extension.
3. Open the ContentCore extension popup.
4. Add the HTTPS backend endpoint and API key, then save the settings.
5. For a PDF, click **Open ContentCore PDF Reader** and choose a PDF file.
6. Highlight a word or phrase.
7. Click **Explain**.
8. The extension sends the selected text and nearby context to the backend.
9. After a valid explanation is returned, click **Save** if you want to keep it.

Chrome's built-in PDF viewer is isolated from extensions. PDFs must be opened through the ContentCore PDF Reader.

## What Is Complete

- Text selection on normal webpages.
- Local PDF upload and PDF.js rendering.
- Selectable text layer over each PDF page.
- Lookup card near the selected text.
- Context extraction around the selected text.
- Page-local context extraction for PDFs.
- Backend request with `word` and `context`.
- Clear error when the endpoint or API key is missing.
- Explanation display after a successful backend response.
- Local lookup caching for webpages.
- Save button shown only after a valid explanation.
- Local saved history containing the word, context, explanation, document or URL, and time saved.
- Maximum of 100 saved entries.
- Settings validation for HTTPS endpoints.

## What Save Does

Save stores the lookup in Chrome local storage under `contentCoreSavedWords`.

It does not change the original PDF file. The saved entry contains:

```json
{
	"word": "selected word",
	"context": "nearby document text",
	"definition": "returned explanation",
	"document": "file name",
	"savedAt": 0
}
```

## Extension Files

| File | Purpose |
|------|---------|
| `extension/manifest.json` | Chrome extension configuration, permissions, popup, and webpage script. |
| `extension/popup.html` | Settings screen for the backend endpoint and API key. |
| `extension/popup.js` | Loads and saves settings in Chrome storage. |
| `extension/content.js` | Adds selection lookup cards to normal webpages. It extracts context, calls the backend, caches results, and saves entries. |
| `extension/pdf-viewer.html` | PDF reader screen with file picker, toolbar, PDF pages, and selectable text. |
| `extension/pdf-reader.js` | Loads PDFs, extracts page text, handles selection, calls the backend, and saves entries. |
| `extension/lib/pdfjs/pdf.min.js` | Local PDF.js rendering library. |
| `extension/lib/pdfjs/pdf.worker.min.js` | Worker used by PDF.js to process PDF files. |
| `LICENSE` | Project license. |

## Backend Contract

The extension expects an HTTPS endpoint configured by the user.

### Request

```http
POST /explain
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

```json
{
	"word": "serendipity",
	"context": "By sheer serendipity, I found the old letter."
}
```

### Successful response

```json
{
	"definition": "A lucky or useful discovery made by chance."
}
```

The backend should reject invalid input, limit request size, protect the LLM key on the server, handle LLM failures, and apply rate limits.

## Pending Work

- Create the backend API server.
- Connect the backend to Claude, OpenAI, or Gemini.
- Add backend authentication and rate limiting.
- Deploy the backend over HTTPS.
- Test the complete extension-to-backend flow.
- Add a feedback form.
- Add privacy documentation.
- Add optional user accounts, cloud sync, and reading analytics later.