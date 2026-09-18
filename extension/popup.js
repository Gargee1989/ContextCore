const settingsForm = document.querySelector("#settings-form");

if (settingsForm) {
	const provider = document.querySelector("#provider");
	const llmApiKey = document.querySelector("#llm-api-key");
	const llmModel = document.querySelector("#llm-model");
	const clearCredential = document.querySelector("#clear-credential");
	const status = document.querySelector("#status");
	const submitBtn = settingsForm.querySelector('button[type="submit"]');
	const connectionStatusBadge = document.querySelector("#connection-status-badge");
	const connectionStatusText = document.querySelector("#connection-status-text");
	const providerError = document.querySelector("#provider-error");
	const apiKeyError = document.querySelector("#api-key-error");
	let hasSavedCredential = false;

	function updateStatusBadge(state) {
		if (!connectionStatusBadge) return;
		connectionStatusBadge.classList.remove("status-connected", "status-setup", "status-verifying");

		if (state === "connected") {
			connectionStatusBadge.classList.add("status-connected");
			if (connectionStatusText) connectionStatusText.textContent = "Connected";
		} else if (state === "verifying") {
			connectionStatusBadge.classList.add("status-verifying");
			if (connectionStatusText) connectionStatusText.textContent = "Verifying...";
		} else {
			connectionStatusBadge.classList.add("status-setup");
			if (connectionStatusText) connectionStatusText.textContent = "Setup needed";
		}
	}

	function showFieldError(inputElement, errorElement, message) {
		if (inputElement) inputElement.classList.add("input-invalid");
		if (errorElement) {
			if (message) errorElement.textContent = message;
			errorElement.style.display = "block";
		}
	}

	function clearFieldError(inputElement, errorElement, defaultMessage) {
		if (inputElement) inputElement.classList.remove("input-invalid");
		if (errorElement) {
			errorElement.style.display = "none";
			if (defaultMessage) errorElement.textContent = defaultMessage;
		}
	}

	function clearFieldErrors() {
		clearFieldError(provider, providerError, "Please select a provider.");
		clearFieldError(llmApiKey, apiKeyError, "Please enter your provider API key.");
		if (llmModel) llmModel.classList.remove("input-invalid");
	}

	if (provider) {
		provider.addEventListener("input", () => clearFieldError(provider, providerError, "Please select a provider."));
		provider.addEventListener("change", () => clearFieldError(provider, providerError, "Please select a provider."));
	}
	if (llmApiKey) {
		llmApiKey.addEventListener("input", () => clearFieldError(llmApiKey, apiKeyError, "Please enter your provider API key."));
		llmApiKey.addEventListener("change", () => clearFieldError(llmApiKey, apiKeyError, "Please enter your provider API key."));
	}

	function checkKeyProviderMismatch(selectedProvider, key) {
		const trimmedKey = key.trim();
		if (!trimmedKey) return null;

		let detectedProvider = null;
		let detectedPrefix = null;
		if (trimmedKey.startsWith("AIza")) {
			detectedProvider = "Google Gemini";
			detectedPrefix = "AIza";
		} else if (trimmedKey.startsWith("sk-")) {
			detectedProvider = "OpenAI";
			detectedPrefix = "sk-";
		} else if (trimmedKey.startsWith("nvapi-")) {
			detectedProvider = "NVIDIA NIM";
			detectedPrefix = "nvapi-";
		}

		if (detectedProvider && selectedProvider && detectedProvider !== selectedProvider) {
			return `The API key entered appears to be for ${detectedProvider} (starts with '${detectedPrefix}'), but ${selectedProvider} was selected. Please select the correct provider or check your key.`;
		}

		return null;
	}

	function setSubmitLoading(loading) {
		if (!submitBtn) return;
		if (loading) {
			submitBtn.disabled = true;
			provider.disabled = true;
			llmApiKey.disabled = true;
			llmModel.disabled = true;
			clearCredential.disabled = true;
			submitBtn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>Verifying key...</span>`;
		} else {
			submitBtn.disabled = false;
			submitBtn.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
					<polyline points="17 21 17 13 7 13 7 21"></polyline>
					<polyline points="7 3 7 8 15 8"></polyline>
				</svg>
				<span>Save settings</span>
			`;
		}
	}

	function setCredentialFieldsLocked(locked) {
		hasSavedCredential = locked;
		provider.disabled = locked;
		llmApiKey.disabled = locked;
		llmModel.disabled = locked;
		clearCredential.disabled = !locked;
		llmApiKey.placeholder = locked
			? "Remove the saved provider key before adding another"
			: "Enter or replace your provider key";
	}

	ContentCoreCrypto.readSettings().then((settings) => {
		provider.value = settings.contentCoreProvider || "";
		llmModel.value = settings.contentCoreLlmModel || "";
		const isConfigured = Boolean(settings.contentCoreCredentialId && settings.contentCoreCredentialToken);
		setCredentialFieldsLocked(isConfigured);
		updateStatusBadge(isConfigured ? "connected" : "setup");
	});

	clearCredential.addEventListener("click", async () => {
		clearFieldErrors();
		try {
			const settings = await ContentCoreCrypto.readSettings();
			if (settings.contentCoreCredentialId && settings.contentCoreCredentialToken) {
				try {
					await fetch(
						`${ContentCoreCrypto.getCredentialsEndpoint()}/${encodeURIComponent(settings.contentCoreCredentialId)}`,
						{
							method: "DELETE",
							headers: {
								"x-credential-token": settings.contentCoreCredentialToken
							}
						}
					);
				} catch (networkError) {
					console.warn("Backend credential removal request failed:", networkError);
				}
			}
			await chrome.storage.local.remove([
				"contentCoreCredentialId",
				"contentCoreCredentialTokenEncrypted",
				"contentCoreProvider",
				"contentCoreLlmModel",
				"contentCoreApiKey",
				"contentCoreApiKeyEncrypted",
				"contentCoreLlmApiKey",
				"contentCoreLlmApiKeyEncrypted",
				"contentCoreProviderLegacy",
				"contentCoreLlmModelLegacy"
			]);
			provider.value = "";
			llmApiKey.value = "";
			llmModel.value = "";
			setCredentialFieldsLocked(false);
			updateStatusBadge("setup");
			status.textContent = "Saved provider key removed.";
			status.className = "success";
		} catch (error) {
			status.textContent = error.message || "Unable to remove provider key.";
			status.className = "error";
		}
	});

	settingsForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		clearFieldErrors();
		status.textContent = "";
		status.className = "";

		if (hasSavedCredential) {
			status.textContent = "Remove the saved provider key before adding another.";
			status.className = "error";
			return;
		}

		const enteredKey = llmApiKey.value.trim();
		const selectedProvider = provider.value;
		const enteredModel = llmModel.value.trim();

		let hasValidationError = false;

		if (!selectedProvider) {
			showFieldError(provider, providerError, "Please select a provider.");
			hasValidationError = true;
		}

		if (!enteredKey) {
			showFieldError(llmApiKey, apiKeyError, "Please enter your provider API key.");
			hasValidationError = true;
		}

		if (hasValidationError) {
			return;
		}

		const mismatch = checkKeyProviderMismatch(selectedProvider, enteredKey);
		if (mismatch) {
			status.textContent = mismatch;
			status.className = "error";
			return;
		}

		updateStatusBadge("verifying");
		setSubmitLoading(true);
		try {
			let credentialId;
			let credentialToken;
			if (enteredKey) {
				const response = await fetch(ContentCoreCrypto.getCredentialsEndpoint(), {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						provider: selectedProvider,
						api_key: enteredKey,
						model: enteredModel || undefined
					})
				});
				if (!response.ok) {
					let message = `Credential registration failed (${response.status})`;
					try {
						const error = await response.json();
						message = error.detail || error.message || message;
					} catch {
						// Keep the status fallback when the backend does not return JSON.
					}
					throw new Error(message);
				}
				const registered = await response.json();
				credentialId = registered.credential_id;
				credentialToken = registered.credential_token;
				setCredentialFieldsLocked(true);
			} else {
				const current = await ContentCoreCrypto.readSettings();
				credentialId = current.contentCoreCredentialId || "";
				credentialToken = current.contentCoreCredentialToken || "";
			}

			const encryptedCredentialToken = await ContentCoreCrypto.encrypt(credentialToken);
			await chrome.storage.local.set({
				contentCoreCredentialId: credentialId,
				contentCoreCredentialTokenEncrypted: encryptedCredentialToken,
				contentCoreProvider: selectedProvider,
				contentCoreLlmModel: enteredModel
			});
			await chrome.storage.local.remove([
				"contentCoreApiKey",
				"contentCoreApiKeyEncrypted",
				"contentCoreLlmApiKey",
				"contentCoreLlmApiKeyEncrypted",
				"contentCoreProviderLegacy",
				"contentCoreLlmModelLegacy"
			]);
			setSubmitLoading(false);
			updateStatusBadge("connected");
			status.textContent = "✓ Key verified and saved successfully.";
			status.className = "success";
		} catch (error) {
			setSubmitLoading(false);
			updateStatusBadge(hasSavedCredential ? "connected" : "setup");
			if (!hasSavedCredential) {
				provider.disabled = false;
				llmApiKey.disabled = false;
				llmModel.disabled = false;
				clearCredential.disabled = true;
			}
			const errorMsg = error.message || "Unable to save settings.";
			status.textContent = errorMsg;
			status.className = "error";
		}
	});
}