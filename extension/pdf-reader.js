(() => {
	"use strict";

	// DOM Elements - Toolbar & Main
	const fileInput = document.querySelector("#file-input");
	const renderTarget = document.querySelector("#pdf-render");
	const emptyState = document.querySelector("#empty-state");
	const docTitle = document.querySelector("#doc-title");
	const toast = document.querySelector("#cc-toast");

	// Page Navigation Controls
	const pagePrev = document.querySelector("#page-prev");
	const pageNext = document.querySelector("#page-next");
	const pageNumInput = document.querySelector("#page-num-input");
	const pageCountDisplay = document.querySelector("#page-count-display");

	// Search / Find Controls
	const findInput = document.querySelector("#find-input");
	const findBtn = document.querySelector("#find-btn");
	const findPrev = document.querySelector("#find-prev");
	const findNext = document.querySelector("#find-next");
	const findCount = document.querySelector("#find-count");

	// Zoom & Fit Controls
	const zoomOut = document.querySelector("#zoom-out");
	const zoomIn = document.querySelector("#zoom-in");
	const zoomBadge = document.querySelector("#zoom-badge");
	const fitToggleBtn = document.querySelector("#fit-toggle-btn");

	// State
	const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
	let currentScale = 1.0;
	let isFitWidth = false;
	let pdfDoc = null;
	let pdfRawData = null;
	let currentDocument = "";
	let totalPages = 0;
	let currentPage = 1;
	let pageText = "";

	// Render Lock & Abort Controller State
	let isRendering = false;
	let renderAbortController = null;

	// Scroll Tracking & Lock State
	let isProgrammaticScroll = false;
	let scrollRafId = null;
	let scrollLockTimeout = null;

	// Selection & Floating Toolbar State
	let selectedText = "";
	let selectionData = null;
	let currentDefinition = "";
	let currentTone = "";
	let currentSynonym = "";
	let floatingPillContainer = null;
	let savedRange = null;

	// In-PDF Search State
	let findMatches = [];
	let activeFindIndex = -1;

	const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

	// Toast Helper
	let toastTimer = null;
	function showToast(message) {
		if (!toast) return;
		toast.textContent = message;
		toast.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast.classList.remove("show");
		}, 1800);
	}

	// Context Extraction
	function contextFor(selection, sourceText = pageText) {
		const selected = clean(selection ? selection.toString() : "");
		const cleanSource = clean(sourceText);
		const index = cleanSource.toLowerCase().indexOf(selected.toLowerCase());
		if (!selected || index < 0) {
			const base = cleanSource.slice(0, 1200);
			const firstLine = clean(sourceText.split(/\r?\n/)[0] || "");
			if (firstLine && firstLine.length <= 100 && !/[.!?]$/.test(firstLine)) {
				return `[Heading: ${firstLine}] ${base}`.slice(0, 5000);
			}
			return base;
		}

		let baseContext = cleanSource;
		if (cleanSource.length > 5000) {
			const sentenceStart = Math.max(
				cleanSource.lastIndexOf(".", index - 1),
				cleanSource.lastIndexOf("!", index - 1),
				cleanSource.lastIndexOf("?", index - 1)
			) + 1;
			const sentenceEndCandidates = [
				cleanSource.indexOf(".", index + selected.length),
				cleanSource.indexOf("!", index + selected.length),
				cleanSource.indexOf("?", index + selected.length)
			].filter((position) => position >= 0);
			const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) + 1 : cleanSource.length;
			baseContext = cleanSource.slice(sentenceStart, sentenceEnd).trim();
		}

		const firstLine = clean(sourceText.split(/\r?\n/)[0] || "");
		let heading = "";
		if (firstLine && firstLine.length <= 100 && !/[.!?]$/.test(firstLine)) {
			heading = firstLine;
		}

		const result = heading ? `[Heading: ${heading}] ${baseContext}` : baseContext;
		return result.slice(0, 5000);
	}

	// Remove Floating Pill & Dropdown
	function removeFloatingPill() {
		floatingPillContainer?.remove();
		floatingPillContainer = null;
		savedRange = null;
	}

	// Check if a range or node is currently within a highlight mark
	function isRangeHighlighted(range) {
		if (!range) return false;
		const startParent = range.startContainer.nodeType === Node.ELEMENT_NODE
			? range.startContainer
			: range.startContainer.parentElement;
		const endParent = range.endContainer.nodeType === Node.ELEMENT_NODE
			? range.endContainer
			: range.endContainer.parentElement;
		if (startParent?.closest(".cc-pdf-highlight") || endParent?.closest(".cc-pdf-highlight")) {
			return true;
		}
		if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
			if (range.commonAncestorContainer.closest(".cc-pdf-highlight")) return true;
			if (range.commonAncestorContainer.querySelector(".cc-pdf-highlight")) return true;
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

	// Toggle Highlight on selection
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
		const m1 = startParent?.closest(".cc-pdf-highlight");
		const m2 = endParent?.closest(".cc-pdf-highlight");
		if (m1) existingMarks.add(m1);
		if (m2) existingMarks.add(m2);

		if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
			const m3 = range.commonAncestorContainer.closest(".cc-pdf-highlight");
			if (m3) existingMarks.add(m3);
			range.commonAncestorContainer.querySelectorAll(".cc-pdf-highlight").forEach((el) => {
				if (range.intersectsNode(el)) existingMarks.add(el);
			});
		}

		if (existingMarks.size > 0) {
			// Cleanly unwrap existing highlights (never stack or darken multiple yellow layers)
			existingMarks.forEach((mark) => unwrapHighlight(mark));
			const highlightBtn = floatingPillContainer?.querySelector('[data-action="highlight"]');
			highlightBtn?.classList.remove("active");
			showToast("Highlight removed");
		} else {
			// Apply new soft yellow highlight (#ffeb3b80)
			try {
				if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
					const mark = document.createElement("mark");
					mark.className = "cc-pdf-highlight";
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
						if (node.parentElement?.closest(".cc-pdf-highlight")) continue;
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
							mark.className = "cc-pdf-highlight";
							nodeRange.surroundContents(mark);
						}
					}
				}
				const highlightBtn = floatingPillContainer?.querySelector('[data-action="highlight"]');
				highlightBtn?.classList.add("active");
				showToast("Highlighted");
			} catch (e) {
				console.error("[Context Core] Highlight error:", e);
			}
		}

		// Clear selection after action
		window.getSelection()?.removeAllRanges();
		setTimeout(removeFloatingPill, 400);
	}

	// Save to chrome.storage.local
	async function saveWord() {
		if (!selectionData || !selectionData.word) return;
		try {
			const stored = await chrome.storage.local.get("contentCoreSavedWords");
			const saved = Array.isArray(stored.contentCoreSavedWords) ? stored.contentCoreSavedWords : [];
			const docName = currentDocument || "Document.pdf";
			const existingIndex = saved.findIndex(
				(item) => item.word === selectionData.word && item.document === docName
			);

			const wordItem = {
				word: selectionData.word,
				context: selectionData.context,
				definition: currentDefinition || "",
				document: docName,
				savedAt: Date.now()
			};

			if (existingIndex >= 0) {
				saved[existingIndex] = wordItem;
			} else {
				saved.unshift(wordItem);
			}

			await chrome.storage.local.set({ contentCoreSavedWords: saved.slice(0, 100) });

			// Animate Save Icon in Pill
			const saveBtn = floatingPillContainer?.querySelector('[data-action="save"]');
			if (saveBtn) {
				saveBtn.classList.add("saved-success");
				saveBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
			}

			showToast("Saved to vocabulary");
		} catch (error) {
			console.error("[Context Core] Save error:", error);
			showToast("Could not save word");
		}
	}

	// Explain This - Call /define API
	async function explainWord(cardBody) {
		cardBody.innerHTML = `
			<div class="cc-card-loading">
				<div class="cc-card-spinner"></div>
				<span>Getting explanation...</span>
			</div>
		`;

		try {
			const settings = await ContentCoreCrypto.readSettings();
			const endpoint = settings.contentCoreEndpoint || ContentCoreCrypto.BACKEND_ENDPOINT;

			const payload = {
				word: selectionData.word,
				target: selectionData.word,
				context: selectionData.context
			};

			if (settings.contentCoreCredentialId && settings.contentCoreCredentialToken) {
				payload.credential_id = settings.contentCoreCredentialId;
				payload.credential_token = settings.contentCoreCredentialToken;
			}

			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});

			if (!response.ok) throw new Error(`API error (${response.status})`);

			const result = await response.json();
			const meaning = clean(
				String(result.meaning || result.definition || result.explanation || result.answer || "")
			);

			if (!meaning) throw new Error("No definition returned.");

			currentDefinition = meaning;
			currentTone = clean(String(result.tone || ""));
			currentSynonym = clean(String(result.synonym || ""));

			let metaHtml = "";
			if (currentTone || currentSynonym) {
				metaHtml = `<div class="cc-card-meta">`;
				if (currentTone) {
					metaHtml += `
						<div class="cc-card-meta-row">
							<span class="cc-meta-badge">Tone:</span>
							<span class="cc-meta-value">${escapeHtml(currentTone)}</span>
						</div>
					`;
				}
				if (currentSynonym) {
					metaHtml += `
						<div class="cc-card-meta-row">
							<span class="cc-meta-badge">Synonym:</span>
							<span class="cc-meta-value">${escapeHtml(currentSynonym)}</span>
						</div>
					`;
				}
				metaHtml += `</div>`;
			}

			cardBody.innerHTML = `
				<div class="cc-card-definition">${escapeHtml(meaning)}</div>
				${metaHtml}
			`;
		} catch (error) {
			cardBody.innerHTML = `
				<div class="cc-card-error">${escapeHtml(error.message || "Definition service unavailable.")}</div>
			`;
		}
	}

	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text || "";
		return div.innerHTML;
	}

	// Show Compact Floating Selection Toolbar
	function showFloatingPill() {
		const selection = window.getSelection();
		selectedText = clean(selection?.toString() || "");

		if (!selectedText || selectedText.length > 160 || !selection.rangeCount) return;

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return;

		savedRange = range.cloneRange();
		removeFloatingPill();

		const page = selection.anchorNode?.parentElement?.closest(".pdf-page");
		const context = contextFor(selection, page?.dataset.text || pageText);
		selectionData = { word: selectedText, context };
		currentDefinition = "";
		currentTone = "";
		currentSynonym = "";

		floatingPillContainer = document.createElement("div");
		floatingPillContainer.className = "cc-floating-pill-container";

		const isHighlighted = isRangeHighlighted(range);

		// Elements strictly in order:
		// 1. Text button: "Explain this" (Plain text only, clean dark font, NO icon)
		// 2. Thin vertical separator line (|)
		// 3. Highlighter icon button (outline highlighter nib icon)
		// 4. Note/Save icon button (folded corner notepad/sheet outline icon)
		floatingPillContainer.innerHTML = `
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
		`;

		document.body.appendChild(floatingPillContainer);

		// Prevent mousedown inside floating pill from clearing text selection prematurely
		floatingPillContainer.addEventListener("mousedown", (e) => {
			if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
				e.preventDefault();
			}
		});

		floatingPillContainer.addEventListener("mouseup", (e) => e.stopPropagation());

		// Positioning: centered above selection or below if near top toolbar
		const pillEl = floatingPillContainer.querySelector(".cc-floating-pill");
		const pillWidth = pillEl.offsetWidth || 210;
		const pillHeight = pillEl.offsetHeight || 38;

		let top = rect.top - pillHeight - 8;
		if (top < 56) {
			top = rect.bottom + 8;
		}
		let left = Math.max(16, Math.min(window.innerWidth - pillWidth - 16, rect.left + (rect.width - pillWidth) / 2));

		floatingPillContainer.style.top = `${Math.round(top)}px`;
		floatingPillContainer.style.left = `${Math.round(left)}px`;

		// Attach event listeners
		const explainBtn = floatingPillContainer.querySelector('[data-action="explain"]');
		const highlightBtn = floatingPillContainer.querySelector('[data-action="highlight"]');
		const saveBtn = floatingPillContainer.querySelector('[data-action="save"]');

		explainBtn.addEventListener("click", () => {
			// If dropdown card already open, toggle it off
			const existingCard = floatingPillContainer.querySelector(".cc-dropdown-card");
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
			card.querySelector(".cc-card-close").addEventListener("click", removeFloatingPill);
			floatingPillContainer.appendChild(card);
			explainWord(card.querySelector(".cc-card-body"));
		});

		highlightBtn.addEventListener("click", toggleHighlight);
		saveBtn.addEventListener("click", saveWord);
	}

	// Page Navigation Helpers
	function updateNavButtonsState() {
		if (totalPages <= 0) {
			pagePrev.disabled = true;
			pageNext.disabled = true;
			pageNumInput.disabled = true;
			return;
		}
		pagePrev.disabled = currentPage <= 1;
		pageNext.disabled = currentPage >= totalPages;
		pageNumInput.disabled = false;
	}

	function scrollToPage(pageNumber, behavior = "smooth") {
		if (pageNumber < 1 || pageNumber > totalPages) return;
		const target = renderTarget.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
		if (!target) return;

		isProgrammaticScroll = true;
		clearTimeout(scrollLockTimeout);

		currentPage = pageNumber;
		if (document.activeElement !== pageNumInput) {
			pageNumInput.value = String(currentPage);
		}
		updateNavButtonsState();

		const targetScrollTop = Math.max(0, target.offsetTop - 16);

		if (behavior === "smooth") {
			renderTarget.scrollTo({ top: targetScrollTop, behavior: "smooth" });
			scrollLockTimeout = setTimeout(() => {
				isProgrammaticScroll = false;
			}, 600);
		} else {
			renderTarget.scrollTop = targetScrollTop;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					isProgrammaticScroll = false;
				});
			});
		}
	}

	// Active page detection using viewport intersection geometry during scroll
	function onScroll() {
		if (isProgrammaticScroll || isRendering || totalPages <= 0) return;
		if (scrollRafId) return;

		scrollRafId = requestAnimationFrame(() => {
			scrollRafId = null;
			if (isProgrammaticScroll || isRendering || totalPages <= 0) return;
			updateActivePageFromScroll();
		});
	}

	function updateActivePageFromScroll() {
		if (isProgrammaticScroll || isRendering || totalPages <= 0) return;
		const pages = renderTarget.querySelectorAll(".pdf-page");
		if (!pages.length) return;

		const scrollTop = renderTarget.scrollTop;

		let activePage = 1;
		// If at or near top of container (or rubber-band overscroll where scrollTop < 0), hard-lock activePage to 1
		if (scrollTop <= 10) {
			activePage = 1;
		} else {
			const containerRect = renderTarget.getBoundingClientRect();
			let maxVisibleHeight = -1;

			for (const pageEl of pages) {
				const pageRect = pageEl.getBoundingClientRect();
				const visibleHeight = Math.max(
					0,
					Math.min(pageRect.bottom, containerRect.bottom) - Math.max(pageRect.top, containerRect.top)
				);
				if (visibleHeight > maxVisibleHeight) {
					maxVisibleHeight = visibleHeight;
					activePage = parseInt(pageEl.dataset.pageNumber, 10) || 1;
				}
			}

			// If scrolled to the very bottom, set to last page
			if (scrollTop + renderTarget.clientHeight >= renderTarget.scrollHeight - 16) {
				activePage = totalPages;
			}
		}

		if (activePage !== currentPage) {
			currentPage = activePage;
			if (document.activeElement !== pageNumInput && !isProgrammaticScroll) {
				pageNumInput.value = String(currentPage);
			}
			updateNavButtonsState();
		}
	}

	// In-PDF Search / Find Bar Implementation
	function clearSearchHighlights() {
		const marks = document.querySelectorAll(".cc-find-highlight");
		marks.forEach((mark) => {
			const parent = mark.parentNode;
			if (parent) {
				parent.replaceChild(document.createTextNode(mark.textContent), mark);
				parent.normalize();
			}
		});
		findMatches = [];
		activeFindIndex = -1;
		findCount.style.display = "none";
		findPrev.disabled = true;
		findNext.disabled = true;
	}

	function performSearch() {
		clearSearchHighlights();
		const query = findInput.value.trim();
		if (!query || !pdfDoc) return;

		const lowerQuery = query.toLowerCase();
		const spans = document.querySelectorAll(".text-layer span");

		spans.forEach((span) => {
			const text = span.textContent;
			if (!text) return;
			const lowerText = text.toLowerCase();
			let startIndex = 0;
			let matchIdx;

			if (lowerText.includes(lowerQuery)) {
				const fragment = document.createDocumentFragment();
				while ((matchIdx = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
					if (matchIdx > startIndex) {
						fragment.appendChild(document.createTextNode(text.slice(startIndex, matchIdx)));
					}
					const mark = document.createElement("mark");
					mark.className = "cc-find-highlight";
					mark.textContent = text.slice(matchIdx, matchIdx + query.length);
					fragment.appendChild(mark);
					findMatches.push(mark);
					startIndex = matchIdx + query.length;
				}
				if (startIndex < text.length) {
					fragment.appendChild(document.createTextNode(text.slice(startIndex)));
				}
				span.textContent = "";
				span.appendChild(fragment);
			}
		});

		if (findMatches.length > 0) {
			activeFindIndex = 0;
			findCount.style.display = "inline";
			findCount.textContent = `1/${findMatches.length}`;
			findMatches[0].classList.add("cc-find-active");
			findMatches[0].scrollIntoView({ behavior: "smooth", block: "center" });
			findPrev.disabled = false;
			findNext.disabled = false;
		} else {
			findCount.style.display = "inline";
			findCount.textContent = "0/0";
			findPrev.disabled = true;
			findNext.disabled = true;
		}
	}

	function navigateFind(delta) {
		if (!findMatches.length) return;
		findMatches[activeFindIndex]?.classList.remove("cc-find-active");
		activeFindIndex = (activeFindIndex + delta + findMatches.length) % findMatches.length;
		const currentMatch = findMatches[activeFindIndex];
		currentMatch.classList.add("cc-find-active");
		findCount.textContent = `${activeFindIndex + 1}/${findMatches.length}`;
		currentMatch.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	// Zoom Controls Implementation
	function updateZoomUI() {
		zoomBadge.textContent = `${Math.round(currentScale * 100)}%`;
		if (isRendering) {
			zoomOut.disabled = true;
			zoomIn.disabled = true;
		} else {
			zoomOut.disabled = !pdfDoc || currentScale <= ZOOM_STEPS[0];
			zoomIn.disabled = !pdfDoc || currentScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
		}
	}

	async function applyZoom(newScale) {
		if (!pdfDoc) return;
		const targetPage = currentPage;

		isProgrammaticScroll = true;
		clearTimeout(scrollLockTimeout);

		currentScale = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], newScale));
		updateZoomUI();

		await renderAllPages();

		// Immediately scroll #pdf-render so that target page's top is aligned to top of container
		const targetPageEl = renderTarget.querySelector(`.pdf-page[data-page-number="${targetPage}"]`);
		if (targetPageEl) {
			renderTarget.scrollTop = Math.max(0, targetPageEl.offsetTop - 16);
		}
		currentPage = targetPage;
		if (document.activeElement !== pageNumInput) {
			pageNumInput.value = String(currentPage);
		}
		updateNavButtonsState();

		await new Promise((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					resolve();
				});
			});
		});
		isProgrammaticScroll = false;
	}

	function zoomStep(delta) {
		let closestIdx = 0;
		let minDiff = Infinity;
		ZOOM_STEPS.forEach((step, idx) => {
			const diff = Math.abs(step - currentScale);
			if (diff < minDiff) {
				minDiff = diff;
				closestIdx = idx;
			}
		});
		const targetIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, closestIdx + delta));
		applyZoom(ZOOM_STEPS[targetIdx]);
	}

	// Render All Pages using PDF.js
	async function renderAllPages() {
		if (renderAbortController) {
			renderAbortController.abort();
		}
		renderAbortController = new AbortController();
		const signal = renderAbortController.signal;

		isRendering = true;
		updateZoomUI();

		removeFloatingPill();
		renderTarget.replaceChildren();
		pageText = "";

		try {
			const pdf = pdfDoc;
			if (!pdf) return;

			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				if (signal.aborted) return;
				const page = await pdf.getPage(pageNumber);
				if (signal.aborted) return;
				const viewport = page.getViewport({ scale: currentScale });

				const wrapper = document.createElement("section");
				wrapper.className = "pdf-page";
				wrapper.dataset.pageNumber = String(pageNumber);
				wrapper.style.width = `${viewport.width}px`;
				wrapper.style.height = `${viewport.height}px`;
				wrapper.style.minHeight = `${viewport.height}px`;

				const canvas = document.createElement("canvas");
				const dpr = window.devicePixelRatio || 1;
				canvas.width = Math.floor(viewport.width * dpr);
				canvas.height = Math.floor(viewport.height * dpr);
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;

				const ctx = canvas.getContext("2d");
				ctx.scale(dpr, dpr);
				wrapper.appendChild(canvas);

				const textLayer = document.createElement("div");
				textLayer.className = "text-layer";
				textLayer.style.width = `${viewport.width}px`;
				textLayer.style.height = `${viewport.height}px`;

				const textContent = await page.getTextContent();
				if (signal.aborted) return;
				const pageLines = textContent.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("");
				const pageTextClean = pageLines.split("\n").map(clean).filter(Boolean).join("\n");
				pageText += `${clean(pageTextClean)} `;
				wrapper.dataset.text = pageTextClean;

				for (const item of textContent.items) {
					if (!item.str) continue;
					const span = document.createElement("span");
					const [scaleX, skewY, skewX, scaleY, x, y] = item.transform;
					span.textContent = item.str;
					const fontHeight = Math.abs(scaleY) * currentScale;
					span.style.left = `${x * currentScale}px`;
					span.style.top = `${viewport.height - y * currentScale - fontHeight}px`;
					span.style.fontSize = `${fontHeight}px`;
					span.style.fontFamily = item.fontName || "sans-serif";
					const scaleFactor = Math.abs(scaleX / Math.abs(scaleY)) || 1;
					if (scaleFactor !== 1) {
						span.style.transform = `scaleX(${scaleFactor})`;
					}
					textLayer.appendChild(span);
				}

				wrapper.appendChild(textLayer);
				const renderTask = page.render({ canvasContext: ctx, viewport });
				signal.addEventListener("abort", () => {
					try {
						renderTask.cancel();
					} catch (_) {}
				}, { once: true });

				try {
					await renderTask.promise;
				} catch (renderErr) {
					if (signal.aborted || renderErr?.name === "RenderingCancelledException") {
						return;
					}
					throw renderErr;
				}
				if (signal.aborted) return;
				renderTarget.appendChild(wrapper);
			}

			pageText = clean(pageText);
		} finally {
			if (renderAbortController?.signal === signal) {
				isRendering = false;
				updateZoomUI();
			}
		}
	}

	// Main Load PDF File Function
	async function loadPdf(file) {
		if (renderAbortController) {
			renderAbortController.abort();
		}
		removeFloatingPill();
		docTitle.textContent = file.name;
		docTitle.title = file.name;
		currentDocument = file.name;
		if (emptyState) emptyState.style.display = "none";

		isProgrammaticScroll = true;
		clearTimeout(scrollLockTimeout);
		renderTarget.scrollTop = 0;

		try {
			const pdfjs = globalThis.pdfjsLib;
			if (!pdfjs) throw new Error("PDF.js library not loaded. Please reload the extension.");
			pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdfjs/pdf.worker.min.js");

			pdfRawData = await file.arrayBuffer();
			pdfDoc = await pdfjs.getDocument({ data: pdfRawData }).promise;
			totalPages = pdfDoc.numPages;
			currentPage = 1;

			// Update Toolbar Controls
			pageCountDisplay.textContent = `/ ${totalPages}`;
			pageNumInput.max = String(totalPages);
			pageNumInput.value = "1";
			pageNumInput.disabled = false;
			pagePrev.disabled = true;
			pageNext.disabled = totalPages <= 1;

			findInput.disabled = false;
			findBtn.disabled = false;
			fitToggleBtn.disabled = false;

			currentScale = 1.0;
			updateZoomUI();
			await renderAllPages();

			renderTarget.scrollTop = 0;
			currentPage = 1;
			pageNumInput.value = "1";
			updateNavButtonsState();

			await new Promise((resolve) => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						resolve();
					});
				});
			});
			isProgrammaticScroll = false;

			showToast(`${totalPages} page${totalPages === 1 ? "" : "s"} loaded`);
		} catch (error) {
			console.error("[Context Core] Error loading PDF:", error);
			docTitle.textContent = "Error loading PDF";
			showToast(`Failed to load PDF: ${error.message}`);
			isProgrammaticScroll = false;
		}
	}

	// Fit Toggle Handler
	async function toggleFit() {
		if (!pdfDoc) return;
		if (!isFitWidth) {
			try {
				const firstPage = await pdfDoc.getPage(1);
				const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
				const availableWidth = renderTarget.clientWidth - 48;
				let calculatedScale = availableWidth / unscaledViewport.width;
				calculatedScale = Math.round(calculatedScale * 100) / 100;
				isFitWidth = true;
				fitToggleBtn.classList.add("active");
				await applyZoom(calculatedScale);
			} catch (e) {
				console.error("Fit calculation error:", e);
			}
		} else {
			isFitWidth = false;
			fitToggleBtn.classList.remove("active");
			await applyZoom(1.0);
		}
	}

	// Setup Event Listeners
	function initEvents() {
		// Scroll Listener on #pdf-render (throttled via RAF)
		renderTarget.addEventListener("scroll", onScroll, { passive: true });
		renderTarget.addEventListener("scroll", () => {
			if (floatingPillContainer) removeFloatingPill();
		}, { passive: true });

		// File Input
		fileInput.addEventListener("change", () => {
			if (fileInput.files[0]) {
				loadPdf(fileInput.files[0]);
			}
		});

		// Drag and Drop
		window.addEventListener("dragover", (e) => {
			e.preventDefault();
			emptyState?.classList.add("drag-over");
		});

		window.addEventListener("dragleave", (e) => {
			if (e.relatedTarget === null) {
				emptyState?.classList.remove("drag-over");
			}
		});

		window.addEventListener("drop", (e) => {
			e.preventDefault();
			emptyState?.classList.remove("drag-over");
			const file = e.dataTransfer?.files[0];
			if (file && file.type === "application/pdf") {
				loadPdf(file);
			}
		});

		// Page Navigation Events
		pagePrev.addEventListener("click", () => {
			if (currentPage > 1) scrollToPage(currentPage - 1);
		});

		pageNext.addEventListener("click", () => {
			if (currentPage < totalPages) scrollToPage(currentPage + 1);
		});

		pageNumInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				pageNumInput.blur();
			}
		});

		pageNumInput.addEventListener("change", () => {
			const target = parseInt(pageNumInput.value, 10);
			if (!isNaN(target) && target >= 1 && target <= totalPages) {
				scrollToPage(target);
			} else {
				pageNumInput.value = currentPage;
			}
		});

		// Zoom Events
		zoomOut.addEventListener("click", () => zoomStep(-1));
		zoomIn.addEventListener("click", () => zoomStep(1));
		fitToggleBtn.addEventListener("click", toggleFit);

		// Find / Search Events
		findInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				if (e.shiftKey) {
					navigateFind(-1);
				} else if (findMatches.length > 0) {
					navigateFind(1);
				} else {
					performSearch();
				}
			} else if (e.key === "Escape") {
				clearSearchHighlights();
				findInput.value = "";
			}
		});

		findInput.addEventListener("input", () => {
			if (!findInput.value.trim()) {
				clearSearchHighlights();
			}
		});

		findBtn.addEventListener("click", performSearch);
		findPrev.addEventListener("click", () => navigateFind(-1));
		findNext.addEventListener("click", () => navigateFind(1));

		// Text Selection & Floating Pill
		document.addEventListener("mouseup", (e) => {
			if (floatingPillContainer?.contains(e.target)) return;
			setTimeout(showFloatingPill, 60);
		});

		document.addEventListener("mousedown", (e) => {
			if (floatingPillContainer && !floatingPillContainer.contains(e.target)) {
				removeFloatingPill();
			}
		});

		window.addEventListener("resize", () => {
			if (floatingPillContainer) removeFloatingPill();
		});
	}

	// Initialize
	initEvents();
})();

