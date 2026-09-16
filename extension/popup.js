const settingsForm = document.querySelector("#settings-form");

if (settingsForm) {
	const provider = document.querySelector("#provider");
	const llmApiKey = document.querySelector("#llm-api-key");
	const llmModel = document.querySelector("#llm-model");
	const clearCredential = document.querySelector("#clear-credential");
	const status = document.querySelector("#status");
	let hasSavedCredential = false;

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
		try {
			let credentialId;
			let credentialToken;
			if (llmApiKey.value.trim()) {
				if (hasSavedCredential) {
					throw new Error("Remove the saved provider key before adding another.");
				}
				if (!provider.value) {
					throw new Error("Select a provider before registering its API key.");
				}
				const response = await fetch(ContentCoreCrypto.getCredentialsEndpoint(), {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						provider: provider.value,
						api_key: llmApiKey.value.trim(),
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
			status.textContent = "Settings saved.";
			status.className = "success";
		} catch (error) {
			status.textContent = error.message || "Unable to save settings.";
			status.className = "error";
		}
	});
}