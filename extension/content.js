(() => {
	"use strict";

	const CACHE_KEY = "contentCoreLookupCache";
	const MAX_CONTEXT_LENGTH = 1200;
	let selectionTimer;
	let selectedText = "";
	let lookupCard;

	const clean = (value) => value.replace(/\s+/g, " ").trim();

	function getContext(selection) {
		const pageText = clean(document.body?.innerText || "");
		const selected = clean(selection.toString());
		if (!selected || !pageText) return selected;

		const selectedIndex = pageText.toLocaleLowerCase().indexOf(selected.toLocaleLowerCase());
		if (selectedIndex < 0) return pageText.slice(0, MAX_CONTEXT_LENGTH);

		const halfWindow = Math.floor((MAX_CONTEXT_LENGTH - selected.length) / 2);
		const start = Math.max(0, selectedIndex - halfWindow);
		const end = Math.min(pageText.length, selectedIndex + selected.length + halfWindow);
		return pageText.slice(start, end).trim();
	}

	function removeCard() {
		lookupCard?.remove();
		lookupCard = null;
	}

	function createCard(rect) {
		removeCard();
		lookupCard = document.createElement("section");
		lookupCard.setAttribute("data-contentcore", "lookup-card");
		lookupCard.innerHTML = `
			<div class="cc-header">
				<strong>Context Core</strong>
				<button type="button" data-cc-close aria-label="Close">&times;</button>
			</div>
			<div class="cc-word"></div>
			<p class="cc-context"></p>
			<div class="cc-status" aria-live="polite"></div>
			<div class="cc-actions">
				<button type="button" class="cc-primary" data-cc-explain>Explain</button>
				<button type="button" class="cc-secondary" data-cc-save>Save</button>
			</div>
			<div class="cc-result" hidden></div>
		`;
		document.documentElement.appendChild(lookupCard);
		lookupCard.querySelector(".cc-word").textContent = selectedText;
		lookupCard.querySelector(".cc-context").textContent = `“${getContext(window.getSelection())}”`;
		lookupCard.style.top = `${Math.min(window.innerHeight - 24, rect.bottom + 10 + window.scrollY)}px`;
		lookupCard.style.left = `${Math.max(12, Math.min(window.innerWidth - 332, rect.left + window.scrollX))}px`;
		lookupCard.querySelector("[data-cc-close]").addEventListener("click", removeCard);
		lookupCard.querySelector("[data-cc-explain]").addEventListener("click", explainSelection);
		lookupCard.querySelector("[data-cc-save]").addEventListener("click", saveSelection);
	}

	function showSelectionCard() {
		const selection = window.getSelection();
		selectedText = clean(selection?.toString() || "");
		if (!selectedText || selectedText.length > 160 || !selection.rangeCount) return;
		createCard(selection.getRangeAt(0).getBoundingClientRect());
	}

	function setStatus(message, isError = false) {
		const status = lookupCard?.querySelector(".cc-status");
		if (status) {
			status.textContent = message;
			status.classList.toggle("cc-error", isError);
		}
	}

	async function getCache() {
		const stored = await chrome.storage.local.get(CACHE_KEY);
		return stored[CACHE_KEY] || {};
	}

	async function explainSelection() {
		if (!lookupCard || !selectedText) return;
		const context = getContext(window.getSelection());
		const cacheKey = `${location.href}::${selectedText.toLocaleLowerCase()}::${context}`;
		const cache = await getCache();
		if (cache[cacheKey]) {
			renderResult(cache[cacheKey], true);
			return;
		}

		const button = lookupCard.querySelector("[data-cc-explain]");
		button.disabled = true;
		setStatus("Reading the surrounding passage...");
		try {
			const settings = await chrome.storage.local.get(["contentCoreEndpoint", "contentCoreApiKey"]);
			let result;
			if (settings.contentCoreEndpoint) {
				const response = await fetch(settings.contentCoreEndpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(settings.contentCoreApiKey ? { Authorization: `Bearer ${settings.contentCoreApiKey}` } : {})
					},
					body: JSON.stringify({ word: selectedText, context })
				});
				if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
				result = await response.json();
			} else {
				result = localExplanation(selectedText, context);
			}
			const definition = clean(String(result.definition || result.meaning || result.explanation || result.answer || "No explanation was returned."));
			cache[cacheKey] = definition;
			await chrome.storage.local.set({ [CACHE_KEY]: cache });
			renderResult(definition);
		} catch (error) {
			setStatus(error.message || "Definition service unavailable. Try again.", true);
			button.disabled = false;
		}
	}

	function localExplanation(word, context) {
		const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const sentence = context.replace(new RegExp(`\\b${escapedWord}\\b`, "i"), "the selected word");
		return { definition: `The selected word appears in this passage: “${sentence.slice(0, 180)}”. Add an API endpoint in extension settings for a full AI explanation.` };
	}

	function renderResult(definition, fromCache = false) {
		if (!lookupCard) return;
		lookupCard.querySelector(".cc-status").textContent = fromCache ? "From this reading session" : "Contextual meaning";
		lookupCard.querySelector(".cc-result").textContent = definition;
		lookupCard.querySelector(".cc-result").hidden = false;
		lookupCard.querySelector(".cc-actions").hidden = true;
	}

	async function saveSelection() {
		const saved = (await chrome.storage.local.get("contentCoreSavedWords")).contentCoreSavedWords || [];
		if (!saved.some((item) => item.word === selectedText && item.url === location.href)) {
			saved.unshift({ word: selectedText, context: getContext(window.getSelection()), url: location.href, savedAt: Date.now() });
			await chrome.storage.local.set({ contentCoreSavedWords: saved.slice(0, 100) });
		}
		setStatus("Saved for later.");
	}

	function injectStyles() {
		const style = document.createElement("style");
		style.textContent = `
			[data-contentcore="lookup-card"] { position: absolute; z-index: 2147483647; width: 300px; padding: 14px; color: #17211b; background: #f8f7f1; border: 1px solid #c6c9bb; border-radius: 8px; box-shadow: 0 12px 32px rgba(18, 28, 20, .2); font: 14px/1.45 Georgia, serif; }
			[data-contentcore="lookup-card"] * { box-sizing: border-box; }
			.cc-header, .cc-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
			.cc-header { color: #35644a; font: 700 12px/1.2 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
			.cc-header button { border: 0; background: transparent; color: #667066; cursor: pointer; font-size: 20px; line-height: 1; }
			.cc-word { margin-top: 12px; font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
			.cc-context { max-height: 74px; margin: 7px 0 12px; color: #667066; overflow: auto; font-size: 12px; }
			.cc-status { min-height: 20px; color: #35644a; font: 12px/1.4 Arial, sans-serif; }
			.cc-error { color: #a53e32; }
			.cc-actions button { padding: 8px 12px; border-radius: 5px; cursor: pointer; font: 600 12px Arial, sans-serif; }
			.cc-primary { border: 1px solid #35644a; background: #35644a; color: white; }
			.cc-secondary { border: 1px solid #b8beb2; background: transparent; color: #35644a; }
			.cc-actions button:disabled { cursor: wait; opacity: .55; }
			.cc-result { margin-top: 8px; color: #263228; font-size: 15px; }
		`;
		document.documentElement.appendChild(style);
	}

	injectStyles();
	document.addEventListener("mouseup", () => {
		clearTimeout(selectionTimer);
		selectionTimer = setTimeout(showSelectionCard, 80);
	});
	document.addEventListener("scroll", removeCard, { passive: true });
})();

const settingsForm = document.querySelector("#settings-form");
if (settingsForm) {
	const endpoint = document.querySelector("#endpoint");
	const apiKey = document.querySelector("#api-key");
	const status = document.querySelector("#status");

	chrome.storage.local.get(["contentCoreEndpoint", "contentCoreApiKey"], (settings) => {
		endpoint.value = settings.contentCoreEndpoint || "";
		apiKey.value = settings.contentCoreApiKey || "";
	});

	settingsForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		let endpointUrl;
		try {
			endpointUrl = endpoint.value ? new URL(endpoint.value) : null;
		} catch {
			endpointUrl = null;
		}
		if (endpoint.value && (!endpoint.validity.valid || endpointUrl?.protocol !== "https:")) {
			status.textContent = "Enter a valid HTTPS endpoint.";
			return;
		}
		await chrome.storage.local.set({
			contentCoreEndpoint: endpoint.value.trim(),
			contentCoreApiKey: apiKey.value.trim()
		});
		status.textContent = "Settings saved.";
	});
}
