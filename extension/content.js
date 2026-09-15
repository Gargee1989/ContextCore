(() => {
	"use strict";

	const CACHE_KEY = "contentCoreLookupCache";
	const MAX_CONTEXT_LENGTH = 5000;
	let selectionTimer;
	let selectedText = "";
	let selectedContext = "";
	let selectionData = null;
	let currentDefinition = "";
	let lookupCard;

	const clean = (value) => value.replace(/\s+/g, " ").trim();

	function getContext(selection) {
		const selected = clean(selection.toString());
		const anchor = selection.anchorNode;
		const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		const contextElement = anchorElement?.closest("p, li, blockquote, article, section") || anchorElement;
		const text = clean(contextElement?.innerText || contextElement?.textContent || document.body?.innerText || "");
		if (!selected || !text) return selected;

		const index = text.toLowerCase().indexOf(selected.toLowerCase());
		if (index < 0) return text.slice(0, MAX_CONTEXT_LENGTH);
		if (text.length <= MAX_CONTEXT_LENGTH) return text;

		const sentenceStart = Math.max(
			text.lastIndexOf(".", index - 1),
			text.lastIndexOf("!", index - 1),
			text.lastIndexOf("?", index - 1)
		) + 1;
		const sentenceEndCandidates = [
			text.indexOf(".", index + selected.length),
			text.indexOf("!", index + selected.length),
			text.indexOf("?", index + selected.length)
		].filter((position) => position >= 0);
		const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) + 1 : text.length;
		return text.slice(sentenceStart, sentenceEnd).trim().slice(0, MAX_CONTEXT_LENGTH);
	}

	function removeCard() {
		lookupCard?.remove();
		lookupCard = null;
	}

	function createCard(rect, context) {
		removeCard();
		selectedContext = context;
		currentDefinition = "";
		selectionData = { word: selectedText, context: selectedContext };
		console.log("[ContentCore] Selection captured:", selectionData);
		lookupCard = document.createElement("section");
		lookupCard.setAttribute("data-contentcore", "lookup-card");
		lookupCard.innerHTML = `
			<div class="cc-header">
				<strong>Context Core</strong>
				<button type="button" data-cc-close aria-label="Close">&times;</button>
			</div>
			<div class="cc-word"></div>
			<div class="cc-status" aria-live="polite"></div>
			<div class="cc-actions">
				<button type="button" class="cc-primary" data-cc-explain>Explain</button>
				<button type="button" class="cc-secondary" data-cc-save hidden>Save</button>
			</div>
			<div class="cc-result" hidden></div>
		`;
		document.documentElement.appendChild(lookupCard);
		lookupCard.querySelector(".cc-word").textContent = selectedText;

		const top = Math.min(window.innerHeight - 24, rect.bottom + 10);
		const left = Math.max(12, Math.min(window.innerWidth - 332, rect.left));
		lookupCard.style.top = `${top}px`;
		lookupCard.style.left = `${left}px`;

		lookupCard.addEventListener("mouseup", (event) => event.stopPropagation());
		lookupCard.querySelector("[data-cc-close]").addEventListener("click", removeCard);
		lookupCard.querySelector("[data-cc-explain]").addEventListener("click", explainSelection);
		lookupCard.querySelector("[data-cc-save]").addEventListener("click", saveSelection);
	}

	function showSelectionCard() {
		const selection = window.getSelection();
		selectedText = clean(selection?.toString() || "");

		if (!selectedText || selectedText.length > 160 || !selection.rangeCount) return;

		try {
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			if (rect.width > 0) {
				createCard(rect, getContext(selection));
			}
		} catch (e) {
			console.error("Selection error:", e);
		}
	}

	function setStatus(message, isError = false) {
		const status = lookupCard?.querySelector(".cc-status");
		if (status) {
			status.textContent = message;
			status.classList.toggle("cc-error", isError);
		}
	}

	function showMessage(message, isError = false) {
		setStatus(message, isError);
	}

	async function getCache() {
		return (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
	}

	async function explainSelection() {
		if (!lookupCard || !selectedText) return;

		const context = selectedContext;
		const cacheKey = `${location.href}::${selectedText.toLowerCase()}::${context}`;
		const cache = await getCache();

		if (cache[cacheKey]) {
			renderResult(cache[cacheKey], true);
			return;
		}

		const button = lookupCard.querySelector("[data-cc-explain]");
		button.disabled = true;
		setStatus("Fetching...");

		try {
			const settings = await ContentCoreCrypto.readSettings();
			const endpoint = settings.contentCoreEndpoint || ContentCoreCrypto.BACKEND_ENDPOINT;

			const payload = { ...selectionData };
			if (settings.contentCoreCredentialId && settings.contentCoreCredentialToken) {
				payload.credential_id = settings.contentCoreCredentialId;
				payload.credential_token = settings.contentCoreCredentialToken;
			}

			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const result = await response.json();
			const definition = clean(String(result.definition || result.meaning || result.explanation || result.answer || "No definition"));
				if (!definition || definition === "No definition") throw new Error("The API returned no explanation.");

			cache[cacheKey] = definition;
			await chrome.storage.local.set({ [CACHE_KEY]: cache });
			renderResult(definition);
		} catch (error) {
			setStatus(`Error: ${error.message}`, true);
			button.disabled = false;
		}
	}

	function renderResult(definition, fromCache = false) {
		if (!lookupCard) return;
		currentDefinition = definition;
		lookupCard.querySelector(".cc-status").textContent = fromCache ? "From cache" : "✓ Done";
		lookupCard.querySelector(".cc-result").textContent = definition;
		lookupCard.querySelector(".cc-result").hidden = false;
		lookupCard.querySelector("[data-cc-explain]").hidden = true;
		lookupCard.querySelector("[data-cc-save]").hidden = false;
	}

	async function saveSelection() {
		const saved = (await chrome.storage.local.get("contentCoreSavedWords")).contentCoreSavedWords || [];
		if (!saved.some((item) => item.word === selectedText && item.url === location.href)) {
			saved.unshift({
					word: selectionData.word,
					context: selectionData.context,
					definition: currentDefinition,
				url: location.href,
				savedAt: Date.now()
			});
			await chrome.storage.local.set({ contentCoreSavedWords: saved.slice(0, 100) });
		}
		setStatus("✓ Saved");
	}

	function injectStyles() {
		const style = document.createElement("style");
		style.textContent = `
			[data-contentcore="lookup-card"] {
				position: fixed; z-index: 999999999; width: 320px; padding: 14px;
				color: #17211b; background: #f8f7f1; border: 1px solid #c6c9bb;
				border-radius: 8px; box-shadow: 0 12px 32px rgba(18, 28, 20, .2);
				font: 14px/1.45 Georgia, serif;
			}
			[data-contentcore="lookup-card"] * { box-sizing: border-box; }
			.cc-header, .cc-actions { display: flex; align-items: center; gap: 8px; }
			.cc-actions { justify-content: flex-end; margin-top: 12px; }
			.cc-header { color: #35644a; font: 700 12px/1.2 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
			.cc-header button { border: 0; background: transparent; color: #667066; cursor: pointer; font-size: 20px; line-height: 1; }
			.cc-word { margin-top: 12px; font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
			.cc-status { min-height: 20px; color: #35644a; font: 12px/1.4 Arial, sans-serif; }
			.cc-error { color: #a53e32; }
			.cc-actions button { padding: 8px 12px; border-radius: 5px; cursor: pointer; font: 600 12px Arial, sans-serif; }
			.cc-primary { border: 1px solid #35644a; background: #35644a; color: white; }
			.cc-secondary { border: 1px solid #b8beb2; background: transparent; color: #35644a; }
			.cc-actions button:disabled { cursor: wait; opacity: .55; }
			.cc-result { margin-top: 8px; color: #263228; font-size: 15px; max-height: 120px; overflow-y: auto; }
		`;
		const target = document.head || document.documentElement;
		if (target) {
			target.appendChild(style);
		} else {
			document.addEventListener("DOMContentLoaded", () => document.head?.appendChild(style), { once: true });
		}
	}

	injectStyles();

	document.addEventListener("mouseup", () => {
		clearTimeout(selectionTimer);
		selectionTimer = setTimeout(showSelectionCard, 80);
	});
	document.addEventListener("scroll", removeCard, { passive: true });
})();
