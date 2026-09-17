(() => {
	"use strict";

	// =========================================================================
	// BACKEND CONFIGURATION
	// Change this URL to your deployed backend URL in production.
	// Example: "https://api.yourdomain.com/define"
	// =========================================================================
	const BACKEND_ENDPOINT = "http://127.0.0.1:8000/define";

	function getCredentialsEndpoint(endpoint = BACKEND_ENDPOINT) {
		const url = new URL(endpoint);
		url.pathname = url.pathname.replace(/\/define\/?$/, "/credentials");
		return url.toString();
	}

	const KEY_STORAGE = "contextCoreEncryptionKey";
	const LEGACY_KEY_STORAGE = "contentCoreEncryptionKey";
	const ENCRYPTED_SUFFIX = "Encrypted";
	const AES_ALGORITHM = "AES-GCM";
	const KEY_LENGTH = 256;
	const IV_LENGTH = 12;

	function toBase64(bytes) {
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}

	function fromBase64(value) {
		const binary = atob(value);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	}

	async function getKey() {
		const stored = await chrome.storage.local.get([KEY_STORAGE, LEGACY_KEY_STORAGE]);
		const storedKey = stored[KEY_STORAGE] || stored[LEGACY_KEY_STORAGE];
		if (storedKey) {
			return crypto.subtle.importKey(
				"raw",
				fromBase64(storedKey),
				{ name: AES_ALGORITHM },
				false,
				["encrypt", "decrypt"]
			);
		}

		const key = await crypto.subtle.generateKey(
			{ name: AES_ALGORITHM, length: KEY_LENGTH },
			true,
			["encrypt", "decrypt"]
		);
		const rawKey = await crypto.subtle.exportKey("raw", key);
		await chrome.storage.local.set({
			[KEY_STORAGE]: toBase64(new Uint8Array(rawKey))
		});
		return crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: AES_ALGORITHM },
			false,
			["encrypt", "decrypt"]
		);
	}

	async function encrypt(value) {
		if (!value) return "";
		const key = await getKey();
		const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
		const encoded = new TextEncoder().encode(value);
		const ciphertext = await crypto.subtle.encrypt(
			{ name: AES_ALGORITHM, iv },
			key,
			encoded
		);
		return JSON.stringify({
			iv: toBase64(iv),
			ciphertext: toBase64(new Uint8Array(ciphertext))
		});
	}

	async function decrypt(value) {
		if (!value) return "";
		const payload = typeof value === "string" ? JSON.parse(value) : value;
		const key = await getKey();
		const plaintext = await crypto.subtle.decrypt(
			{ name: AES_ALGORITHM, iv: fromBase64(payload.iv) },
			key,
			fromBase64(payload.ciphertext)
		);
		return new TextDecoder().decode(plaintext);
	}

	async function readSettings() {
		const settings = await chrome.storage.local.get([
			"contextCoreEndpoint",
			"contextCoreCredentialId",
			"contextCoreCredentialTokenEncrypted",
			"contextCoreProvider",
			"contextCoreLlmModel",
			"contentCoreEndpoint",
			"contentCoreCredentialId",
			"contentCoreCredentialTokenEncrypted",
			"contentCoreProvider",
			"contentCoreLlmModel"
		]);

		const credentialId = settings.contextCoreCredentialId || settings.contentCoreCredentialId || "";
		const tokenEncrypted = settings.contextCoreCredentialTokenEncrypted || settings.contentCoreCredentialTokenEncrypted || "";
		const endpoint = settings.contextCoreEndpoint || settings.contentCoreEndpoint || BACKEND_ENDPOINT;
		const provider = settings.contextCoreProvider || settings.contentCoreProvider || "";
		const llmModel = settings.contextCoreLlmModel || settings.contentCoreLlmModel || "";

		const decrypted = {
			contextCoreEndpoint: endpoint,
			contextCoreCredentialId: credentialId,
			contextCoreCredentialTokenEncrypted: tokenEncrypted,
			contextCoreProvider: provider,
			contextCoreLlmModel: llmModel,
			contentCoreEndpoint: endpoint,
			contentCoreCredentialId: credentialId,
			contentCoreCredentialTokenEncrypted: tokenEncrypted,
			contentCoreProvider: provider,
			contentCoreLlmModel: llmModel,
			contextCoreCredentialToken: "",
			contentCoreCredentialToken: ""
		};

		if (tokenEncrypted) {
			try {
				const plainToken = await decrypt(tokenEncrypted);
				decrypted.contextCoreCredentialToken = plainToken;
				decrypted.contentCoreCredentialToken = plainToken;
			} catch {
				decrypted.contextCoreCredentialToken = "";
				decrypted.contentCoreCredentialToken = "";
			}
		}

		await chrome.storage.local.remove([
			"contextCoreApiKey",
			"contextCoreApiKeyEncrypted",
			"contextCoreLlmApiKey",
			"contextCoreLlmApiKeyEncrypted",
			"contentCoreApiKey",
			"contentCoreApiKeyEncrypted",
			"contentCoreLlmApiKey",
			"contentCoreLlmApiKeyEncrypted",
		]);

		return decrypted;
	}

	const ContextCoreCrypto = {
		encrypt,
		decrypt,
		readSettings,
		BACKEND_ENDPOINT,
		getCredentialsEndpoint,
	};

	globalThis.ContextCoreCrypto = ContextCoreCrypto;
	globalThis.ContentCoreCrypto = ContextCoreCrypto;
})();
