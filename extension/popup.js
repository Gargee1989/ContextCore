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
			status.className = "error";
			return;
		}
		await chrome.storage.local.set({
			contentCoreEndpoint: endpoint.value.trim(),
			contentCoreApiKey: apiKey.value.trim()
		});
		status.textContent = "Settings saved.";
		status.className = "success";
	});
}