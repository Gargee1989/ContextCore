(() => {
	"use strict";

	const CACHE_KEY = "contentCoreLookupCache";
	const MAX_CONTEXT_LENGTH = 5000;
	let selectionTimer;
	let selectedText = "";
	let selectedContext = "";
	let selectionData = null;
	let currentDefinition = "";
	let currentTone = "";
	let currentSynonym = "";
	let lookupHost = null;
	let shadowRoot = null;
	let savedRange = null;

	const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text || "";
		return div.innerHTML;
	}

	function findNearestHeading(element) {
		const headingSelector = "h1, h2, h3, h4, h5, h6, [role='heading']";
		let current = element;
		while (current && current !== document.body && current !== document.documentElement) {
			let sibling = current.previousElementSibling;
			while (sibling) {
				if (sibling.matches(headingSelector)) {
					const text = clean(sibling.innerText || sibling.textContent || "");
					if (text) return text;
				}
				const headings = sibling.querySelectorAll(headingSelector);
				if (headings.length > 0) {
					for (let i = headings.length - 1; i >= 0; i--) {
						const text = clean(headings[i].innerText || headings[i].textContent || "");
						if (text) return text;
					}
				}
				sibling = sibling.previousElementSibling;
			}
			current = current.parentElement;
			if (current && current !== document.body && current !== document.documentElement) {
				if (current.matches(headingSelector)) {
					const text = clean(current.innerText || current.textContent || "");
					if (text) return text;
				}
			}
		}
		return "";
	}

	function getContext(selection) {
		const selected = clean(selection.toString());
		const anchor = selection.anchorNode;
		const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
		const contextElement = anchorElement?.closest("p, li, blockquote, article, section") || anchorElement;
		const text = clean(contextElement?.innerText || contextElement?.textContent || document.body?.innerText || "");
		if (!selected || !text) return selected;

		let baseContext = text;
		const index = text.toLowerCase().indexOf(selected.toLowerCase());
		if (index < 0) {
			baseContext = text.slice(0, MAX_CONTEXT_LENGTH);
		} else if (text.length > MAX_CONTEXT_LENGTH) {
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
			baseContext = text.slice(sentenceStart, sentenceEnd).trim();
		}

		const heading = findNearestHeading(contextElement);
		const fullContext = heading ? `[Heading: ${heading}] ${baseContext}` : baseContext;
		return fullContext.slice(0, MAX_CONTEXT_LENGTH);
	}

	function removeCard() {
		lookupHost?.remove();
		lookupHost = null;
		shadowRoot = null;
	}

	// Helper to check if selection range intersects any existing highlight
	function isRangeHighlighted(range) {
		if (!range) return false;
		const startParent = range.startContainer.nodeType === Node.ELEMENT_NODE
			? range.startContainer
			: range.startContainer.parentElement;
		const endParent = range.endContainer.nodeType === Node.ELEMENT_NODE
			? range.endContainer
			: range.endContainer.parentElement;

		if (startParent?.closest(".cc-web-highlight") || endParent?.closest(".cc-web-highlight")) {
			return true;
		}
		if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
			if (range.commonAncestorContainer.closest(".cc-web-highlight")) return true;
			if (range.commonAncestorContainer.querySelector(".cc-web-highlight")) return true;
		}
		return false;
	}

	// Unwrap highlight mark cleanly
	function unwrapHighlight(mark) {
		const parent = mark.parentNode;
		if (!parent) return;
		while (mark.firstChild) {
			parent.insertBefore(mark.firstChild, mark);
		}
		parent.removeChild(mark);
		parent.normalize();
	}

	// Temporary Highlight toggle on normal webpage
	function toggleHighlight() {
		const range = savedRange || (window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null);
		if (!range) return;

		const startParent = range.startContainer.nodeType === Node.ELEMENT_NODE
			? range.startContainer
			: range.startContainer.parentElement;
		const endParent = range.endContainer.nodeType === Node.ELEMENT_NODE
			? range.endContainer
			: range.endContainer.parentElement;

		const existingMarks = new Set();
		const m1 = startParent?.closest(".cc-web-highlight");
		const m2 = endParent?.closest(".cc-web-highlight");
		if (m1) existingMarks.add(m1);
		if (m2) existingMarks.add(m2);

		if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
			const m3 = range.commonAncestorContainer.closest(".cc-web-highlight");
			if (m3) existingMarks.add(m3);
			range.commonAncestorContainer.querySelectorAll(".cc-web-highlight").forEach((el) => {
				if (range.intersectsNode(el)) existingMarks.add(el);
			});
		}

		if (existingMarks.size > 0) {
			// Unhighlight cleanly without stacking
			existingMarks.forEach((mark) => unwrapHighlight(mark));
			const highlightBtn = shadowRoot?.querySelector('[data-action="highlight"]');
			highlightBtn?.classList.remove("active");
		} else {
			// Apply soft yellow temporary highlight
			try {
				if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
					const mark = document.createElement("mark");
					mark.className = "cc-web-highlight";
					range.surroundContents(mark);
				} else {
					const walker = document.createTreeWalker(
						range.commonAncestorContainer,
						NodeFilter.SHOW_TEXT,
						{
							acceptNode: (node) => {
								if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
								if (!node.textContent.trim()) return NodeFilter.FILTER_SKIP;
								return NodeFilter.FILTER_ACCEPT;
							}
						}
					);
					const nodes = [];
					while (walker.nextNode()) nodes.push(walker.currentNode);
					for (const node of nodes) {
						if (node.parentElement?.closest(".cc-web-highlight")) continue;
						const nodeRange = document.createRange();
						if (node === range.startContainer) {
							nodeRange.setStart(node, range.startOffset);
							nodeRange.setEnd(node, node.length);
						} else if (node === range.endContainer) {
							nodeRange.setStart(node, 0);
							nodeRange.setEnd(node, range.endOffset);
						} else {
							nodeRange.selectNodeContents(node);
						}
						if (!nodeRange.collapsed) {
							const mark = document.createElement("mark");
							mark.className = "cc-web-highlight";
							nodeRange.surroundContents(mark);
						}
					}
				}
				const highlightBtn = shadowRoot?.querySelector('[data-action="highlight"]');
				highlightBtn?.classList.add("active");
			} catch (e) {
				console.error("[ContentCore] Highlight error:", e);
			}
		}

		// Clear selection and remove floating pill after highlight action
		window.getSelection()?.removeAllRanges();
		setTimeout(removeCard, 350);
	}

	async function getCache() {
		return (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
	}

	function renderCardError(cardBody, title, desc, hint = "") {
		cardBody.innerHTML = `
			<div class="cc-card-error-container">
				<div class="cc-error-title">${escapeHtml(title)}</div>
				<div class="cc-error-desc">${escapeHtml(desc)}</div>
				${hint ? `<div class="cc-error-hint">${escapeHtml(hint)}</div>` : ""}
			</div>
		`;
	}

	// Call backend API /define
	async function explainSelection(cardBody) {
		if (!shadowRoot || !selectedText) return;

		let settings;
		try {
			settings = await ContentCoreCrypto.readSettings();
		} catch (err) {
			console.error("[ContentCore] Failed to read settings:", err);
			settings = {};
		}

		const hasCredential = Boolean(
			settings.contentCoreCredentialId && settings.contentCoreCredentialToken
		);

		if (!hasCredential) {
			renderCardError(
				cardBody,
				"API Key Setup Required",
				"Please configure your AI provider (Google Gemini, OpenAI, or NVIDIA NIM) in the ContentCore extension settings to get word definitions.",
				"Click the ContentCore icon in your browser toolbar to enter your key."
			);
			return;
		}

		const context = selectedContext;
		const cacheKey = `${location.href}::${selectedText.toLowerCase()}::${context}`;
		const cache = await getCache();

		if (cache[cacheKey]) {
			const cached = cache[cacheKey];
			const meaning = typeof cached === "object" ? cached.meaning : cached;
			const tone = typeof cached === "object" ? cached.tone : "";
			const synonym = typeof cached === "object" ? cached.synonym : "";
			currentDefinition = meaning;
			currentTone = tone;
			currentSynonym = synonym;
			renderCardDefinition(cardBody, meaning, tone, synonym);
			return;
		}

		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			renderCardError(
				cardBody,
				"No Internet Connection",
				"Your device appears to be offline. Please check your network and try again."
			);
			return;
		}

		cardBody.innerHTML = `
			<div class="cc-card-loading">
				<div class="cc-card-spinner"></div>
				<span>Getting explanation...</span>
			</div>
		`;

		try {
			const endpoint = settings.contentCoreEndpoint || ContentCoreCrypto.BACKEND_ENDPOINT;

			const payload = {
				word: selectionData.word,
				target: selectionData.word,
				context: selectionData.context,
				credential_id: settings.contentCoreCredentialId,
				credential_token: settings.contentCoreCredentialToken
			};

			let response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(payload)
				});
			} catch (networkError) {
				if (typeof navigator !== "undefined" && navigator.onLine === false) {
					renderCardError(
						cardBody,
						"No Internet Connection",
						"Your device appears to be offline. Please check your network and try again."
					);
				} else {
					renderCardError(
						cardBody,
						"Connection Failed",
						"Could not connect to the ContentCore backend. Please ensure the backend server is running and reachable."
					);
				}
				return;
			}

			if (!response.ok) {
				let errTitle = "Service Error";
				let errDesc = `Request failed (${response.status})`;
				try {
					const errorData = await response.json();
					const message = errorData.message || errorData.detail || "";
					if (response.status === 400) {
						const lower = message.toLowerCase();
						if (lower.includes("key") || lower.includes("credential") || lower.includes("auth") || lower.includes("token")) {
							errTitle = "Invalid API Key";
						} else {
							errTitle = "Invalid Request";
						}
						errDesc = message || "Please check your settings or selected text.";
					} else if (response.status === 429) {
						errTitle = "Rate Limit Exceeded";
						errDesc = message || "Too many requests. Please wait a moment before trying again.";
					} else if (response.status === 504) {
						errTitle = "Request Timed Out";
						errDesc = message || "The AI provider took too long to respond. Please try again.";
					} else if (response.status === 503) {
						errTitle = "Service Unavailable";
						errDesc = message || "The definition service is temporarily unavailable. Please try again later.";
					} else {
						errDesc = message || errDesc;
					}
				} catch {
					if (response.status === 429) {
						errTitle = "Rate Limit Exceeded";
						errDesc = "Too many requests. Please wait a moment before trying again.";
					} else if (response.status === 504) {
						errTitle = "Request Timed Out";
						errDesc = "The AI provider took too long to respond. Please try again.";
					} else if (response.status === 503) {
						errTitle = "Service Unavailable";
						errDesc = "The definition service is temporarily unavailable. Please try again later.";
					}
				}
				renderCardError(cardBody, errTitle, errDesc);
				return;
			}

			const result = await response.json();
			const meaning = clean(String(result.meaning || result.definition || result.explanation || result.answer || ""));
			if (!meaning || meaning === "No definition") {
				renderCardError(cardBody, "No Definition", "The AI provider did not return an explanation for this selection.");
				return;
			}

			currentDefinition = meaning;
			currentTone = clean(String(result.tone || ""));
			currentSynonym = clean(String(result.synonym || ""));

			cache[cacheKey] = {
				meaning: currentDefinition,
				tone: currentTone,
				synonym: currentSynonym
			};
			await chrome.storage.local.set({ [CACHE_KEY]: cache });
			renderCardDefinition(cardBody, currentDefinition, currentTone, currentSynonym);
		} catch (error) {
			renderCardError(cardBody, "Unexpected Error", error.message || "An unexpected error occurred.");
		}
	}

	function renderCardDefinition(cardBody, meaning, tone, synonym) {
		let metaHtml = "";
		if (tone || synonym) {
			metaHtml = `<div class="cc-card-meta">`;
			if (tone) {
				metaHtml += `
					<div class="cc-card-meta-row">
						<span class="cc-meta-badge">Tone:</span>
						<span class="cc-meta-value">${escapeHtml(tone)}</span>
					</div>
				`;
			}
			if (synonym) {
				metaHtml += `
					<div class="cc-card-meta-row">
						<span class="cc-meta-badge">Synonym:</span>
						<span class="cc-meta-value">${escapeHtml(synonym)}</span>
					</div>
				`;
			}
			metaHtml += `</div>`;
		}

		cardBody.innerHTML = `
			<div class="cc-card-definition">${escapeHtml(meaning)}</div>
			${metaHtml}
		`;
	}

	async function saveSelection() {
		if (!selectionData || !selectionData.word) return;
		const saved = (await chrome.storage.local.get("contentCoreSavedWords")).contentCoreSavedWords || [];
		const existingIndex = saved.findIndex((item) => item.word === selectedText && item.url === location.href);

		const itemData = {
			word: selectionData.word,
			context: selectionData.context,
			definition: currentDefinition || "",
			url: location.href,
			savedAt: Date.now()
		};

		if (existingIndex >= 0) {
			saved[existingIndex] = itemData;
		} else {
			saved.unshift(itemData);
		}

		await chrome.storage.local.set({ contentCoreSavedWords: saved.slice(0, 100) });

		const saveBtn = shadowRoot?.querySelector('[data-action="save"]');
		if (saveBtn) {
			saveBtn.classList.add("saved-success");
			saveBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
		}
	}

	function createCard(rect, context) {
		removeCard();
		selectedContext = context;
		currentDefinition = "";
		currentTone = "";
		currentSynonym = "";
		selectionData = { word: selectedText, context: selectedContext };

		lookupHost = document.createElement("div");
		lookupHost.setAttribute("data-contentcore-host", "true");
		shadowRoot = lookupHost.attachShadow({ mode: "closed" });

		const isHighlighted = isRangeHighlighted(savedRange);

		shadowRoot.innerHTML = `
			<style>
				*, *::before, *::after {
					box-sizing: border-box;
					margin: 0;
					padding: 0;
				}

				.cc-floating-pill-container {
					position: fixed;
					z-index: 2147483647;
					display: flex;
					flex-direction: column;
					align-items: flex-start;
					filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.12));
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
					font-size: 14px;
					line-height: 1.5;
					color: #1f2937;
				}

				.cc-floating-pill {
					display: flex;
					align-items: center;
					background: #ffffff;
					border: 1px solid #e0e0e0;
					border-radius: 8px;
					box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
					padding: 4px 6px;
					gap: 4px;
					user-select: none;
				}

				/* 1. "Explain this" button */
				.cc-explain-btn {
					background: transparent;
					border: none;
					color: #1f2937;
					font-size: 13px;
					font-weight: 500;
					padding: 5px 10px;
					border-radius: 5px;
					cursor: pointer;
					white-space: nowrap;
					font-family: inherit;
					transition: background 0.15s, color 0.15s;
				}

				.cc-explain-btn:hover {
					background: #f3f4f6;
					color: #111827;
				}

				/* 2. Thin vertical separator line (|) */
				.cc-pill-separator {
					width: 1px;
					height: 18px;
					background-color: #e5e7eb;
					margin: 0 2px;
				}

				/* 3 & 4. Icon buttons */
				.cc-pill-icon-btn {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 28px;
					height: 28px;
					border: none;
					background: transparent;
					border-radius: 5px;
					color: #4b5563;
					cursor: pointer;
					padding: 0;
					transition: background 0.15s, color 0.15s;
				}

				.cc-pill-icon-btn:hover {
					background: #f3f4f6;
					color: #111827;
				}

				.cc-pill-icon-btn.active {
					background: #fef08a;
					color: #854d0e;
				}

				.cc-pill-icon-btn.saved-success {
					color: #10b981;
					background: #ecfdf5;
				}

				/* Dropdown Card */
				.cc-dropdown-card {
					margin-top: 8px;
					width: 320px;
					background: #ffffff;
					border: 1px solid #e5e7eb;
					border-radius: 8px;
					box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.06);
					padding: 14px;
					font-family: inherit;
					color: #1f2937;
					animation: ccCardFadeIn 0.15s ease-out;
				}

				@keyframes ccCardFadeIn {
					from { opacity: 0; transform: translateY(-4px); }
					to { opacity: 1; transform: translateY(0); }
				}

				.cc-card-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					margin-bottom: 8px;
					padding-bottom: 6px;
					border-bottom: 1px solid #f3f4f6;
				}

				.cc-card-word {
					font-size: 15px;
					font-weight: 700;
					color: #111827;
					overflow-wrap: anywhere;
				}

				.cc-card-close {
					border: none;
					background: transparent;
					color: #9ca3af;
					cursor: pointer;
					font-size: 18px;
					line-height: 1;
					padding: 2px 6px;
					border-radius: 4px;
				}

				.cc-card-close:hover {
					background: #f3f4f6;
					color: #4b5563;
				}

				.cc-card-body {
					font-size: 13.5px;
					line-height: 1.5;
					color: #374151;
				}

				.cc-card-loading {
					display: flex;
					align-items: center;
					gap: 8px;
					color: #6b7280;
					font-size: 13px;
					padding: 8px 0;
				}

				.cc-card-spinner {
					width: 16px;
					height: 16px;
					border: 2px solid #e5e7eb;
					border-top-color: #2563eb;
					border-radius: 50%;
					animation: ccSpin 0.7s linear infinite;
				}

				@keyframes ccSpin {
					to { transform: rotate(360deg); }
				}

				.cc-card-error {
					color: #dc2626;
					font-size: 13px;
					padding: 4px 0;
				}

				.cc-card-error-container {
					padding: 6px 0;
				}

				.cc-error-title {
					font-size: 13.5px;
					font-weight: 600;
					color: #b91c1c;
					margin-bottom: 4px;
				}

				.cc-error-desc {
					font-size: 12.5px;
					line-height: 1.45;
					color: #374151;
					margin-bottom: 4px;
				}

				.cc-error-hint {
					font-size: 11.5px;
					color: #6b7280;
					font-style: italic;
				}

				.cc-card-definition {
					margin-top: 4px;
					max-height: 160px;
					overflow-y: auto;
					padding-right: 2px;
				}

				.cc-card-meta {
					display: flex;
					flex-direction: column;
					gap: 6px;
					margin-top: 10px;
					padding-top: 8px;
					border-top: 1px dashed #e5e7eb;
					font-size: 12px;
				}

				.cc-card-meta-row {
					display: flex;
					align-items: flex-start;
					gap: 6px;
				}

				.cc-meta-badge {
					font-weight: 600;
					color: #4b5563;
					min-width: 60px;
				}

				.cc-meta-value {
					color: #1f2937;
					flex: 1;
				}
			</style>

			<div class="cc-floating-pill-container">
				<div class="cc-floating-pill">
					<button type="button" class="cc-explain-btn" data-action="explain">Explain this</button>
					<div class="cc-pill-separator"></div>
					<button type="button" class="cc-pill-icon-btn ${isHighlighted ? "active" : ""}" data-action="highlight" title="Highlight text" aria-label="Highlight text">
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
							<path d="m9 11-6 6v3h3l6-6"/>
							<path d="m22 7-4.5-4.5a2.12 2.12 0 0 0-3 0l-4.5 4.5 7.5 7.5 4.5-4.5a2.12 2.12 0 0 0 0-3Z"/>
							<line x1="14.5" y1="5.5" x2="18.5" y2="9.5"/>
						</svg>
					</button>
					<button type="button" class="cc-pill-icon-btn" data-action="save" title="Save word" aria-label="Save word">
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
							<polyline points="14 2 14 8 20 8"/>
							<line x1="16" y1="13" x2="8" y2="13"/>
							<line x1="16" y1="17" x2="8" y2="17"/>
							<polyline points="10 9 9 9 8 9"/>
						</svg>
					</button>
				</div>
			</div>
		`;

		document.documentElement.appendChild(lookupHost);

		const pillContainer = shadowRoot.querySelector(".cc-floating-pill-container");
		const pill = shadowRoot.querySelector(".cc-floating-pill");

		// Prevent mousedown on pill from deselecting text on the host page
		lookupHost.addEventListener("mousedown", (e) => {
			e.stopPropagation();
			e.preventDefault();
		});

		lookupHost.addEventListener("mouseup", (e) => e.stopPropagation());

		const pillWidth = 210;
		const pillHeight = 36;
		let top = rect.top - pillHeight - 8;
		if (top < 10) {
			top = rect.bottom + 8;
		}
		let left = Math.max(12, Math.min(window.innerWidth - pillWidth - 12, rect.left + (rect.width - pillWidth) / 2));

		pillContainer.style.top = `${Math.round(top)}px`;
		pillContainer.style.left = `${Math.round(left)}px`;

		const explainBtn = shadowRoot.querySelector('[data-action="explain"]');
		const highlightBtn = shadowRoot.querySelector('[data-action="highlight"]');
		const saveBtn = shadowRoot.querySelector('[data-action="save"]');

		explainBtn.addEventListener("click", () => {
			const existingCard = shadowRoot.querySelector(".cc-dropdown-card");
			if (existingCard) {
				existingCard.remove();
				return;
			}
			const card = document.createElement("div");
			card.className = "cc-dropdown-card";
			card.innerHTML = `
				<div class="cc-card-header">
					<span class="cc-card-word">${escapeHtml(selectedText)}</span>
					<button type="button" class="cc-card-close" aria-label="Close">&times;</button>
				</div>
				<div class="cc-card-body"></div>
			`;
			card.querySelector(".cc-card-close").addEventListener("click", removeCard);
			pillContainer.appendChild(card);
			explainSelection(card.querySelector(".cc-card-body"));
		});

		highlightBtn.addEventListener("click", toggleHighlight);
		saveBtn.addEventListener("click", saveSelection);
	}

	function showSelectionCard() {
		const selection = window.getSelection();
		selectedText = clean(selection?.toString() || "");

		if (!selectedText || selectedText.length > 160 || !selection.rangeCount) return;

		try {
			const range = selection.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				savedRange = range.cloneRange();
				createCard(rect, getContext(selection));
			}
		} catch (e) {
			console.error("Selection error:", e);
		}
	}

	// Inject subtle page-level CSS for the temporary highlight mark only
	function injectPageHighlightStyles() {
		if (document.getElementById("cc-web-highlight-style")) return;
		const style = document.createElement("style");
		style.id = "cc-web-highlight-style";
		style.textContent = `
			mark.cc-web-highlight {
				background-color: rgba(255, 235, 59, 0.45) !important;
				color: inherit !important;
				border-radius: 2px;
				cursor: pointer;
				box-decoration-break: clone;
				-webkit-box-decoration-break: clone;
				padding: 1px 0;
			}
		`;
		(document.head || document.documentElement).appendChild(style);
	}

	injectPageHighlightStyles();

	document.addEventListener("mouseup", (e) => {
		if (lookupHost?.contains(e.target)) return;
		clearTimeout(selectionTimer);
		selectionTimer = setTimeout(showSelectionCard, 80);
	});

	document.addEventListener("mousedown", (e) => {
		if (lookupHost && !lookupHost.contains(e.target)) {
			removeCard();
		}
	});

	document.addEventListener("scroll", removeCard, { passive: true });
})();
