# Software Requirements Specification (SRS)

## Context Core: Context-Aware Smart Reading and PDF Extension

**Prepared in accordance with IEEE 830 / IEEE 29148 Standard**

| Attribute | Details |
|---|---|
| **Document Version** | 2.0 |
| **Date** | September 17, 2026 |
| **Product Name** | Context Core |
| **Status** | Approved Specification |

---

## Table of Contents

1. Introduction
2. Overall Description
3. External Interface Requirements
4. System Features and Functional Requirements
5. Non-Functional Requirements
6. Security and Privacy Requirements

---

## 1. Introduction

### 1.1 Purpose
This document specifies the software requirements for **Context Core**, an AI-powered browser extension and dedicated document reading platform. The system provides instantaneous, context-aware definitions, tone insights, simplified passages, and vocabulary building tools for digital reading (webpages, PDFs, and e-books). It serves as the baseline for product development, testing, architectural compliance, and business deployment.

### 1.2 Document Conventions
- **The system**: Refers to Context Core (browser extension, PDF reader, and FastAPI backend).
- **Priority levels**: **High**, **Medium**, **Low**.
- **Requirement IDs**:
  - `FR-XX`: Functional Requirement
  - `NFR-XX`: Non-Functional Requirement
  - `SEC-XX`: Security & Credential Management Requirement

### 1.3 Intended Audience
- **Engineering and QA Teams**: Architecture, implementation, and test suite design.
- **Product and Business Stakeholders**: Feature roadmaps, monetization models, and commercial licensing compliance.
- **Security Auditors**: Credential isolation and cryptographic flow evaluation.

### 1.4 Product Scope
Context Core eliminates reading friction and cognitive interruption caused by external dictionary searches. When a reader selects any word or phrase in a webpage or PDF document, Context Core extracts surrounding contextual cues and uses Large Language Models (LLMs) to explain the word precisely as used in that specific sentence or paragraph.

**Key Scope Inclusions:**
- Contextual definitions, tone analysis, synonyms, examples, and sentence simplification.
- Dedicated standalone PDF reader powered by PDF.js with in-document search/find and adjustable zoom.
- In-page and in-PDF persistent highlighting and word saving.
- Vocabulary management dashboard for reviewing, filtering, and studying saved words.
- Multi-provider LLM support (Google Gemini, OpenAI, NVIDIA NIM).
- Zero-trust Bring Your Own Key (BYOK) architecture with client and server-side encryption.

---

## 2. Overall Description

### 2.1 Product Perspective
Context Core operates as a distributed client-server architecture:
1. **Client Extension (Chromium Manifest V3)**:
   - Content script injected into regular web pages.
   - Dedicated local and remote PDF reader application (`pdf-viewer.html`).
   - Extension popup interface for configuration and credential onboarding (`popup.html`).
   - Vocabulary review interface (`saved-words.html`).
2. **FastAPI Backend Service (`backend/app.py`)**:
   - Centralized API gateway for prompt generation, schema validation, and provider dispatch.
   - Server-side AES-GCM credential encryption and token validation service.

### 2.2 User Classes and Characteristics
| User Class | Description | Primary Needs |
|---|---|---|
| Active Readers & Students | Students, researchers, and avid book readers reading dense PDFs and articles. | Instant comprehension without context switching; vocabulary retention. |
| Professional & Technical Readers | Engineers, lawyers, and analysts reading domain-specific terminology. | Accurate contextual nuances, tone breakdown, and passage simplification. |
| Power Users (BYOK) | Users with existing LLM accounts (Gemini, OpenAI, NVIDIA). | Direct API key integration, custom model selection, zero tracking. |

### 2.3 Operating Environment
- **Client Platforms**: Chromium-based desktop browsers (Google Chrome, Microsoft Edge, Brave) supporting Manifest V3.
- **Server Environment**: Python 3.10+ runtime, FastAPI, Uvicorn asynchronous server.
- **Upstream LLM Providers**: Google Gemini API, OpenAI API, NVIDIA NIM API (OpenAI-compatible endpoints).

### 2.4 Design and Implementation Constraints
- Compliance with Google Chrome Web Store Manifest V3 security and privacy policies (no unvetted remote scripts).
- Strict separation between extension client and third-party LLM provider keys.
- Proprietary commercial licensing model.

---

## 3. External Interface Requirements

### 3.1 User Interfaces
- **Floating Definition Tooltip**: Non-intrusive tooltip anchored to the selected text offering **Explain** and **Save** actions.
- **Definition Display Modal/Card**: Shows word meaning, tone, synonym, illustrative example, and simplified context.
- **PDF Reader Workspace (`pdf-viewer.html`)**:
  - Toolbar with File Picker, URL Loader, Find Bar, and Zoom controls.
  - Page viewport with interactive text selection layer.
- **Popup Settings Interface (`popup.html`)**:
  - Provider selector (Gemini, OpenAI, NVIDIA NIM).
  - API Key and Model input fields with real-time verification indicators.
  - **Remove saved provider key** control to clear or rotate active credentials.
- **Vocabulary Review Page (`saved-words.html`)**:
  - Card-based view of saved vocabulary with search filters, date sorting, and deletion options.

### 3.2 Software and Communication Interfaces
- **PDF Engine**: PDF.js for rendering and layout coordinates.
- **Backend API**:
  - `POST /define`: Accepts word, context, and optional credential reference; returns structured definition JSON.
  - `POST /credentials`: Registers and validates provider credentials; returns encrypted reference.
  - `GET /health`: Service health and availability probe.
- **Protocol**: HTTPS / WSS for production traffic, JSON data interchange.

---

## 4. System Features and Functional Requirements

### 4.1 Feature 1: Context-Aware Definition and Analysis
**Priority:** High  
**Description:** Generates structured semantic explanations tailored to the exact context of the surrounding sentence.

- **FR-01**: The system shall detect text selection events on supported web pages and PDF reader views.
- **FR-02**: The system shall extract surrounding text (sentence and paragraph boundary) as context.
- **FR-03**: The backend shall query the active LLM provider with structured system prompts.
- **FR-04**: The response shall return structured data containing:
  - `meaning`: Context-specific definition.
  - `tone`: Contextual tone (e.g., formal, sarcastic, technical, archaic).
  - `synonym`: Relevant synonym applicable in the sentence.
  - `example`: Secondary illustrative sentence.
  - `simplified_passage`: Simplified version of the source sentence.

### 4.2 Feature 2: Dedicated PDF Reader with Find and Zoom
**Priority:** High  
**Description:** Embedded document reader supporting local PDF files and remote URLs with interactive reading tools.

- **FR-05**: The system shall render PDF files within a dedicated extension tab using PDF.js.
- **FR-06**: The system shall provide an in-document **Find** bar that highlights search query matches across all pages.
- **FR-07**: The system shall display total match counts (`X/Y`) and provide Next/Previous navigation buttons.
- **FR-08**: The system shall provide **Zoom** controls (zoom in, zoom out, preset scaling from 50% to 200%, and percentage indicator).

### 4.3 Feature 3: In-Page Highlighting and Word Persistence
**Priority:** High  
**Description:** Allows readers to save looked-up terms and highlight them in the active reading view.

- **FR-09**: The system shall provide a **Save** action in the definition card.
- **FR-10**: Saving a word shall apply a persistent visual highlight to the selected text in the document DOM / PDF text layer.
- **FR-11**: The system shall store saved terms, definitions, context, and timestamps in local client storage.

### 4.4 Feature 4: Vocabulary Review Dashboard
**Priority:** Medium  
**Description:** Dedicated dashboard for studying and organizing saved vocabulary.

- **FR-12**: The system shall provide a Vocabulary dashboard accessible via the extension popup.
- **FR-13**: The dashboard shall display all saved words along with definitions, tone, examples, and original context.
- **FR-14**: The dashboard shall allow users to search/filter terms and remove individual saved entries.

### 4.5 Feature 5: Multi-Provider LLM Integration and Model Selection
**Priority:** High  
**Description:** Seamless backend routing across major LLM ecosystems.

- **FR-15**: The backend shall support Google Gemini, OpenAI, and NVIDIA NIM via OpenAI-compatible interfaces.
- **FR-16**: The system shall allow users or administrators to specify custom model overrides.
- **FR-17**: The backend shall fall back to environment-configured default provider keys when user keys are omitted.

### 4.6 Feature 6: Bring Your Own Key (BYOK) and Key Management
**Priority:** High  
**Description:** Secure client-side onboarding and server-side encryption of user API keys.

- **FR-18**: The extension shall allow users to supply their personal provider API key and optional model.
- **FR-19**: Upon submission, the extension and backend shall perform live verification of the key and model before saving.
- **FR-20**: The extension shall provide a **Remove saved provider key** button to revoke and delete active credentials.

---

## 5. Non-Functional Requirements

### 5.1 Performance and Reliability
- **NFR-01**: Average definition response time shall be under 2.5 seconds under standard broadband conditions.
- **NFR-02**: The extension shall cache repeated word and context lookups locally per session to minimize redundant network traffic.
- **NFR-03**: The backend shall gracefully return standardized HTTP error responses (400, 401, 422, 429, 502, 504) with explanatory user messages.

### 5.2 Usability and Accessibility
- **NFR-04**: Tooltips and modals shall automatically position themselves to avoid clipping at viewport edges.
- **NFR-05**: Keyboard navigation and accessibility labels shall be present across the PDF reader and popup controls.

### 5.3 Maintainability and Extensibility
- **NFR-06**: Modular architecture separating UI logic, cryptographic helpers, backend endpoints, and LLM services.
- **NFR-07**: Complete test coverage across unit, integration, and scenario testing suites in `backend/tests/`.

---

## 6. Security and Privacy Requirements

### 6.1 Cryptographic Key Isolation
- **SEC-01**: Provider API keys shall never be stored in plaintext within client `chrome.storage`.
- **SEC-02**: Client credentials shall be encrypted via client-generated AES-GCM keys (`contextCoreEncryptionKey`).
- **SEC-03**: The backend shall encrypt sensitive provider keys using server-side AES-GCM (`CREDENTIAL_ENCRYPTION_KEY`) and issue opaque, time-stamped credential tokens.
- **SEC-04**: Subsequent lookup requests shall transmit only opaque credential tokens; raw provider keys shall never be sent back to the browser.

### 6.2 Data Privacy
- **SEC-05**: Context sent for definition generation shall be limited to the selected word and immediate neighboring sentences.
- **SEC-06**: No document text or personal reading history shall be permanently stored on the backend server.
