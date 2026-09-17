const settingsForm = document.querySelector("#settings-form");

if (settingsForm) {
	const provider = document.querySelector("#provider");
	const llmApiKey = document.querySelector("#llm-api-key");
	const llmModel = document.querySelector("#llm-model");
	const clearCredential = document.querySelector("#clear-credential");
	const status = document.querySelector("#status");
	const submitBtn = settingsForm.querySelector('button[type="submit"]');
	let hasSavedCredential = false;

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
		setCredentialFieldsLocked(
			Boolean(settings.contentCoreCredentialId && settings.contentCoreCredentialToken)
		);
	});

	clearCredential.addEventListener("click", async () => {
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
			status.textContent = "Saved provider key removed.";
			status.className = "success";
		} catch (error) {
			status.textContent = error.message || "Unable to remove provider key.";
			status.className = "error";
		}
	});

	settingsForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const enteredKey = llmApiKey.value.trim();
		const selectedProvider = provider.value;

		if (enteredKey) {
			if (hasSavedCredential) {
				status.textContent = "Remove the saved provider key before adding another.";
				status.className = "error";
				return;
			}
			if (!selectedProvider) {
				status.textContent = "Select a provider before registering its API key.";
				status.className = "error";
				return;
			}
			const mismatch = checkKeyProviderMismatch(selectedProvider, enteredKey);
			if (mismatch) {
				status.textContent = mismatch;
				status.className = "error";
				return;
			}
		}

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
						model: llmModel.value.trim() || undefined
					})
				});
				if (!response.ok) {
					let message = `Credential registration failed (${response.status})`;
					try {
						const error = await response.json();
						message = error.message || message;
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
				contentCoreProvider: provider.value.trim(),
				contentCoreLlmModel: llmModel.value.trim()
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
			status.textContent = "✓ Key verified and saved successfully.";
			status.className = "success";
		} catch (error) {
			setSubmitLoading(false);
			if (!hasSavedCredential) {
				provider.disabled = false;
				llmApiKey.disabled = false;
				llmModel.disabled = false;
				clearCredential.disabled = true;
			}
			status.textContent = error.message || "Unable to save settings.";
			status.className = "error";
		}
	});
}