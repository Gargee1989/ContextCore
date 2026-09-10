import * as pdfjsLib from "./pdfjs/pdf.mjs";

const fileInput = document.querySelector("#pdf-file");
const urlInput = document.querySelector("#pdf-url");
const openUrlButton = document.querySelector("#open-url");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomInButton = document.querySelector("#zoom-in");
const status = document.querySelector("#status");
const pages = document.querySelector("#pages");
let pdfDocument;
let scale = 1.25;

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/pdf.worker.mjs");

function setStatus(message, isError = false) {
	status.textContent = message;
	status.classList.toggle("error", isError);
}

async function loadPdf(source) {
	setStatus("Opening PDF...");
	fileInput.disabled = true;
	openUrlButton.disabled = true;
	try {
		const loadingTask = pdfjsLib.getDocument({
			...(typeof source === "string" ? { url: source } : source),
			standardFontDataUrl: chrome.runtime.getURL("pdfjs/standard_fonts/")
		});
		pdfDocument = await loadingTask.promise;
		await renderDocument();
		setStatus(`${pdfDocument.numPages} page${pdfDocument.numPages === 1 ? "" : "s"} ready. Select text to explain it.`);
	} catch (error) {
		setStatus(error.message || "Unable to open this PDF.", true);
	} finally {
		fileInput.disabled = false;
		openUrlButton.disabled = false;
	}
}

async function renderDocument() {
	pages.replaceChildren();
	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		await renderPage(pageNumber);
	}
}

async function renderPage(pageNumber) {
	const page = await pdfDocument.getPage(pageNumber);
	const viewport = page.getViewport({ scale });
	const wrapper = document.createElement("section");
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	const textLayer = document.createElement("div");
	const renderViewport = page.getViewport({ scale });

	wrapper.className = "page";
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	textLayer.className = "text-layer";
	textLayer.style.width = `${viewport.width}px`;
	textLayer.style.height = `${viewport.height}px`;
	wrapper.append(canvas, textLayer);
	pages.append(wrapper);
	await page.render({ canvasContext: context, viewport }).promise;
	const textContent = await page.getTextContent();
	for (const item of textContent.items) {
		const span = document.createElement("span");
		const transform = pdfjsLib.Util.transform(renderViewport.transform, item.transform);
		span.textContent = item.str;
		span.style.left = `${transform[4]}px`;
		span.style.top = `${transform[5] - item.height * scale}px`;
		span.style.fontSize = `${item.height * scale}px`;
		span.style.transform = `scaleX(${transform[0] / (item.width ? item.width / item.str.length : 1)})`;
		textLayer.append(span);
	}
}

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	if (!file) return;
	await loadPdf({ data: new Uint8Array(await file.arrayBuffer()) });
});

openUrlButton.addEventListener("click", () => {
	const url = urlInput.value.trim();
	if (!url) {
		setStatus("Enter a PDF URL first.", true);
		return;
	}
	loadPdf(url);
});

zoomOutButton.addEventListener("click", async () => {
		if (!pdfDocument) return;
		scale = Math.max(.75, scale - .15);
		await renderDocument();
});

zoomInButton.addEventListener("click", async () => {
		if (!pdfDocument) return;
		scale = Math.min(2.5, scale + .15);
		await renderDocument();
});