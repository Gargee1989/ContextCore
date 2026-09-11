(() => {
	"use strict";

	const fileInput = document.querySelector("#file-input");
	const renderTarget = document.querySelector("#pdf-render");
	const status = document.querySelector("#status");
	let pageText = "";
	let currentPageText = "";
	let selectedText = "";
	let selectionData = null;
	let currentDefinition = "";
	let currentDocument = "";
	let lookupCard;

	const clean = (value) => value.replace(/\s+/g, " ").trim();

	function contextFor(selection, sourceText = pageText) {
		const selected = clean(selection.toString());
		const index = sourceText.toLowerCase().indexOf(selected.toLowerCase());
		if (!selected || index < 0) return sourceText.slice(0, 1200);
		if (sourceText.length <= 5000) return sourceText;
		const sentenceStart = Math.max(
			sourceText.lastIndexOf(".", index - 1),
			sourceText.lastIndexOf("!", index - 1),
			sourceText.lastIndexOf("?", index - 1)
		) + 1;
		const sentenceEndCandidates = [
			sourceText.indexOf(".", index + selected.length),
			sourceText.indexOf("!", index + selected.length),
			sourceText.indexOf("?", index + selected.length)
		].filter((position) => position >= 0);
		const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) + 1 : sourceText.length;
		return sourceText.slice(sentenceStart, sentenceEnd).trim().slice(0, 5000);
	}

	function removeCard() {
		lookupCard?.remove();
		lookupCard = null;
	}

	function setStatus(message, error = false) {
		const node = lookupCard?.querySelector(".cc-status");
		if (node) {
			node.textContent = message;
			node.classList.toggle("cc-error", error);
		}
	}

	function showMessage(message, error = false) {
		setStatus(message, error);
	}

	function createCard(rect, context) {
		removeCard();
		currentDefinition = "";
		selectionData = { word: selectedText, context };
		console.log("[ContentCore] Selection captured:", selectionData);
		lookupCard = document.createElement("section");
		lookupCard.setAttribute("data-contentcore", "lookup-card");
		lookupCard.innerHTML = `<div class="cc-header"><strong>ContentCore</strong><button type="button" data-close aria-label="Close">&times;</button></div><div class="cc-word"></div><div class="cc-status" aria-live="polite"></div><div class="cc-actions"><button type="button" class="cc-primary" data-explain>Explain</button><button type="button" class="cc-secondary" data-save hidden>Save</button></div><div class="cc-result" hidden></div>`;
		document.body.appendChild(lookupCard);
		lookupCard.querySelector(".cc-word").textContent = selectedText;
		lookupCard.style.top = `${Math.min(window.innerHeight - 24, rect.bottom + 10)}px`;
		lookupCard.style.left = `${Math.max(12, Math.min(window.innerWidth - 324, rect.left))}px`;
		lookupCard.addEventListener("mouseup", (event) => event.stopPropagation());
		lookupCard.querySelector("[data-close]").addEventListener("click", removeCard);
		lookupCard.querySelector("[data-explain]").addEventListener("click", () => explain(context));
		lookupCard.querySelector("[data-save]").addEventListener("click", () => save(context));
	}

	function showSelectionCard() {
		const selection = window.getSelection();
		selectedText = clean(selection?.toString() || "");
		if (!selectedText || selectedText.length > 160 || !selection.rangeCount) return;
		const page = selection.anchorNode?.parentElement?.closest(".pdf-page");
		const context = contextFor(selection, page?.dataset.text || pageText);
		createCard(selection.getRangeAt(0).getBoundingClientRect(), context);
	}

	async function explain(context) {
		const settings = await chrome.storage.local.get(["contentCoreEndpoint", "contentCoreApiKey"]);
		if (!settings.contentCoreEndpoint) {
			showMessage("No API endpoint configured. Open ContentCore settings and add the /define URL.", true);
			return;
		}
		const button = lookupCard.querySelector("[data-explain]");
		button.disabled = true;
		setStatus("Fetching explanation...");
		try {
			const response = await fetch(settings.contentCoreEndpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(settings.contentCoreApiKey ? { Authorization: `Bearer ${settings.contentCoreApiKey}` } : {}) }, body: JSON.stringify(selectionData) });
			if (!response.ok) throw new Error(`API error (${response.status})`);
			const result = await response.json();
			const definition = clean(String(result.definition || result.meaning || result.explanation || result.answer || "No explanation was returned."));
			if (!definition || definition === "No explanation was returned.") throw new Error("The API returned no explanation.");
			currentDefinition = definition;
			lookupCard.querySelector(".cc-status").textContent = "Explanation";
			lookupCard.querySelector(".cc-result").textContent = definition;
			lookupCard.querySelector(".cc-result").hidden = false;
			lookupCard.querySelector("[data-explain]").hidden = true;
			lookupCard.querySelector("[data-save]").hidden = false;
		} catch (error) {
			setStatus(error.message || "Definition service unavailable. Try again.", true);
			button.disabled = false;
		}
	}

	async function save(context) {
		const stored = await chrome.storage.local.get("contentCoreSavedWords");
		const saved = stored.contentCoreSavedWords || [];
		if (!saved.some((item) => item.word === selectionData.word && item.document === currentDocument)) {
			saved.unshift({ word: selectionData.word, context: selectionData.context, definition: currentDefinition, document: currentDocument, savedAt: Date.now() });
		}
		await chrome.storage.local.set({ contentCoreSavedWords: saved.slice(0, 100) });
		setStatus("Saved for later.");
	}

	async function renderPdf(file) {
		removeCard();
		status.textContent = "Loading PDF...";
		renderTarget.replaceChildren();
		pageText = "";
		currentDocument = file.name;
		try {
			const pdfjs = globalThis.pdfjsLib;
			if (!pdfjs) throw new Error("PDF.js did not load. Reload the extension from chrome://extensions and try again.");
			pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdfjs/pdf.worker.min.js");
			const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				const page = await pdf.getPage(pageNumber);
				const viewport = page.getViewport({ scale: 1.5 });
				const wrapper = document.createElement("section");
				wrapper.className = "pdf-page";
				wrapper.style.width = `${viewport.width}px`;
				wrapper.style.height = `${viewport.height}px`;
				const canvas = document.createElement("canvas");
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				wrapper.appendChild(canvas);
				const textLayer = document.createElement("div");
				textLayer.className = "text-layer";
				const textContent = await page.getTextContent();
				currentPageText = clean(textContent.items.map((item) => item.str).join(" "));
				pageText += `${currentPageText} `;
				wrapper.dataset.text = currentPageText;
				for (const item of textContent.items) {
					const span = document.createElement("span");
					const [scaleX, skewY, skewX, scaleY, x, y] = item.transform;
					span.textContent = item.str;
					span.style.left = `${x * 1.5}px`;
					span.style.top = `${viewport.height - y * 1.5 - Math.abs(scaleY) * 1.5}px`;
					span.style.fontSize = `${Math.abs(scaleY) * 1.5}px`;
					span.style.transform = `scaleX(${scaleX / Math.abs(scaleY) || 1})`;
					textLayer.appendChild(span);
				}
				wrapper.appendChild(textLayer);
				await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
				renderTarget.appendChild(wrapper);
			}
			pageText = clean(pageText);
			status.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} loaded. Highlight text to look it up.`;
		} catch (error) {
			status.textContent = `Could not load PDF: ${error.message}`;
		}
	}

	fileInput.addEventListener("change", () => fileInput.files[0] && renderPdf(fileInput.files[0]));
	document.addEventListener("mouseup", () => setTimeout(showSelectionCard, 80));
	document.addEventListener("scroll", removeCard, { passive: true });
})();
