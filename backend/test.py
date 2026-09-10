"""
ContentCore - Backend LLM API Connection Test

This script tests the connectivity to the configured LLM API (NVIDIA NIM or OpenAI):
1. Loads environment variables from backend/.env
2. Reads NVIDIA_API_KEY / OPENAI_API_KEY securely from the environment
3. Automatically detects NVIDIA NIM or standard OpenAI endpoint
4. Makes a simple API call (Chat Completion)
5. Prints the response
6. Handles missing API key and errors gracefully
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI, AuthenticationError, APIConnectionError, OpenAIError

# ---------------------------------------------------------------------------
# Step 1: Load Environment Variables
# ---------------------------------------------------------------------------
# Locate the directory containing this script (ContentCore/backend)
BACKEND_DIR = Path(__file__).resolve().parent
ENV_FILE_PATH = BACKEND_DIR / ".env"

# Explicitly load environment variables from backend/.env
if ENV_FILE_PATH.exists():
    load_dotenv(dotenv_path=ENV_FILE_PATH)
else:
    # Fallback to default search if file is in another standard location
    load_dotenv()

# ---------------------------------------------------------------------------
# Step 2: Read and Validate API Key
# ---------------------------------------------------------------------------
# Read the API key securely from environment variables (never hardcoded in source)
nvidia_key = os.getenv("NVIDIA_API_KEY")
openai_key = os.getenv("OPENAI_API_KEY")
api_key = nvidia_key or openai_key

# Placeholder indicators
PLACEHOLDERS = ["your_openai_api_key_here", "your_nvidia_api_key_here"]

if not api_key or api_key.strip() == "" or api_key.strip() in PLACEHOLDERS:
    print("=" * 65)
    print("[ERROR] Missing or unconfigured API key!")
    print("=" * 65)
    print("To fix this issue:")
    print(f"1. Open the file: {ENV_FILE_PATH}")
    print("2. Set your API key:")
    print("   NVIDIA_API_KEY=nvapi-...")
    print("   # or OPENAI_API_KEY=sk-proj-...")
    print("3. Save the file and rerun this test script.")
    print("=" * 65)
    sys.exit(1)

# Detect whether this is an NVIDIA API key or standard OpenAI key
is_nvidia = api_key.startswith("nvapi-") or bool(nvidia_key)
base_url = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1") if is_nvidia else None
default_model = "meta/llama-3.2-11b-vision-instruct" if is_nvidia else "gpt-4o-mini"
model_name = os.getenv("LLM_MODEL", default_model)
provider_name = "NVIDIA NIM" if is_nvidia else "OpenAI"


# ---------------------------------------------------------------------------
# Step 3: Initialize Client and Execute API Call
# ---------------------------------------------------------------------------
def test_connection():
    """Initializes the LLM client, sends a test prompt, and prints the result."""
    try:
        print(f"Loading configuration from: {ENV_FILE_PATH.name}")
        print(f"Provider detected: {provider_name}")
        if base_url:
            print(f"Endpoint URL: {base_url}")
        print(f"Model: {model_name}")
        print(f"Initializing {provider_name} client...")

        # Initialize the OpenAI-compatible client
        if is_nvidia and base_url:
            client = OpenAI(base_url=base_url, api_key=api_key)
        else:
            client = OpenAI(api_key=api_key)

        print(f"Sending test request to {provider_name} API...")

        # Make a simple, lightweight chat completion call
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant verifying system connectivity for ContentCore.",
                },
                {
                    "role": "user",
                    "content": "Say 'ContentCore backend is successfully connected!' in a single short sentence.",
                },
            ],
            max_tokens=40,
            temperature=0.2,
        )

        # ---------------------------------------------------------------------------
        # Step 4: Print the Response
        # ---------------------------------------------------------------------------
        reply_message = response.choices[0].message.content.strip()
        print("=" * 65)
        print(f"[SUCCESS] {provider_name} API Response:")
        print("=" * 65)
        print(reply_message)
        print("=" * 65)

    except AuthenticationError as auth_err:
        print("=" * 65)
        print(f"[AUTHENTICATION ERROR] Invalid {provider_name} API Key.")
        print(f"Details: {auth_err}")
        print("Please verify your API key in backend/.env.")
        print("=" * 65)
        sys.exit(1)

    except APIConnectionError as conn_err:
        print("=" * 65)
        print(f"[CONNECTION ERROR] Could not reach {provider_name} servers.")
        print(f"Details: {conn_err}")
        print("Please check your internet connection and network settings.")
        print("=" * 65)
        sys.exit(1)

    except OpenAIError as api_err:
        print("=" * 65)
        print(f"[API ERROR] {provider_name} encountered an error during the request.")
        print(f"Details: {api_err}")
        print("=" * 65)
        sys.exit(1)

    except Exception as unexpected_err:
        print("=" * 65)
        print(f"[UNEXPECTED ERROR] An unexpected error occurred: {unexpected_err}")
        print("=" * 65)
        sys.exit(1)


if __name__ == "__main__":
    test_connection()
