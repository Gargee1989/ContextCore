const settingsForm = document.querySelector("#settings-form");

if (settingsForm) {
	const endpoint = document.querySelector("#endpoint");
	const apiKey = document.querySelector("#api-key");
	const llmApiKey = document.querySelector("#llm-api-key");
	const provider = document.querySelector("#provider");
	const llmModel = document.querySelector("#llm-model");
	const status = document.querySelector("#status");

	chrome.storage.local.get(
		["contentCoreEndpoint", "contentCoreApiKey", "contentCoreLlmApiKey", "contentCoreProvider", "contentCoreLlmModel"],
		(settings) => {
			endpoint.value = settings.contentCoreEndpoint || "";
			apiKey.value = settings.contentCoreApiKey || "";
			llmApiKey.value = settings.contentCoreLlmApiKey || "";
			provider.value = settings.contentCoreProvider || "";
			llmModel.value = settings.contentCoreLlmModel || "";
		}
	);

	settingsForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		let endpointUrl;
		try {
			endpointUrl = endpoint.value ? new URL(endpoint.value) : null;
		} catch {
			endpointUrl = null;
		}
		const isLocalHttp = endpointUrl && endpointUrl.protocol === "http:" &&
			["localhost", "127.0.0.1", "::1"].includes(endpointUrl.hostname);
		if (endpoint.value && (!endpoint.validity.valid || (endpointUrl?.protocol !== "https:" && !isLocalHttp))) {
			status.textContent = "Enter an HTTPS endpoint, or a local http://localhost endpoint for development.";
			status.className = "error";
			return;
		}
		await chrome.storage.local.set({
			contentCoreEndpoint: endpoint.value.trim(),
			contentCoreApiKey: apiKey.value.trim(),
			contentCoreLlmApiKey: llmApiKey.value.trim(),
			contentCoreProvider: provider.value.trim(),
			contentCoreLlmModel: llmModel.value.trim()
		});
		status.textContent = "Settings saved.";
		status.className = "success";
	});
}