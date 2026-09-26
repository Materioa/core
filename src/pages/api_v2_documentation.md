# Materio API v2: Detailed Reference

This document provides a comprehensive, exhaustive reference for all endpoints available in the Materio API v2 (`/api/v2`).

## 📡 Base Configuration

- **Subdomain API**: `https://materioa.vercel.app/api/v2`
- **Authentication**: JWT-based via `Authorization: Bearer <token>`
- **Content-Type**: `application/json` (unless specified otherwise)
- **CORS**: Enabled for all origins (`*`)

---

## 🔐 1. Authentication & Integrity

### `POST /login`
Handles traditional login, creation of secure handoff codes, and handoff code exchange.

- **Usage A: Traditional Login**
  - **Body:** `{ "username": "...", "password": "..." }`
  - **Example:**
    ```bash
    curl -X POST https://materioa.vercel.app/api/v2/login \
      -H "Content-Type: application/json" \
      -d '{"username": "johndoe", "password": "password123"}'
    ```
- **Usage B: Create Handoff (Authenticated)**
  - **Header:** `Authorization: Bearer <token>`
  - **Body:** `{ "action": "create" }`
  - **Description:** Generates a 60-second code to transfer session to another device/tab.
- **Usage C: Exchange Handoff**
  - **Body:** `{ "code": "a1b2c3d4" }` (or `"action": "exchange"`)

### `POST /signup`
Creates a new user profile. Requires a valid registration invite code.

- **Body:**
  ```json
  {
    "username": "materiouser",
    "displayName": "Materio Enthusiast",
    "email": "user@example.com",
    "password": "securepassword",
    "inviteCode": "MB-XXXX-XXXX",
    "profilePicture": "data:image/jpeg;base64,..." 
  }
  ```

### `POST /auth?action=forgot-password`
Verification of recovery key or direct password update.

- **Fields:** `email`, `recoveryKey`, `newPassword` (optional).
- **Behavior:** If `newPassword` is omitted, it just verifies the key.

### `POST /auth?action=admin-recovery` 🛡️
Admin-only tool to retrieve a user's recovery key for emergency account access.

- **Body:** `{ "email": "...", "username": "..." }`

---

## 👤 2. Profile Management

### `GET /profile`
Returns the current user's profile, including subscription status (`isPlusUser`, `isLiteUser`) and recovery key.

### `PUT /profile`
Update user information. Sensitive updates (password/recovery key) require `currentPassword`.

- **Fields:** `username`, `displayName`, `currentPassword`, `newPassword`, `generateNewRecoveryKey` (bool), `profilePicture` (base64).

### `DELETE /profile`
Deletes the user account and associated profile pictures in storage.

- **Body:** `{ "password": "..." }` (Required for confirmation)

---

## 🔍 3. Resource Search

### `GET /search`
Fuzzy search across the curriculum database using Fuse.js and Jaro-Winkler logic.

- **Query Params:**
  - `query`: The search term (e.g., "cnip unit 3" or "ml paper 2023").
  - `limit`: (Default 20)
- **Match Types:** `direct_nav` (regex match), `exact`, `high`, `medium`, `low`.

---

## 🤖 4. AI Chat Services

### `POST /chat`
Core endpoint for AI interaction. Supports multiple personas.

- **Modes:** `general`, `reasoning`, `code`, `image`.
- **Example:**
  ```bash
  curl -X POST https://materioa.vercel.app/api/v2/chat \
    -d '{"message": "Explain binary search", "mode": "code"}'
  ```

### `GET /chat/models`
Returns a list of all supported AI models and their display names.

---

## 🎫 5. Invites System

### `POST /invites` 🛡️
Generate a new registration invite code.
- **Body:** `{ "containsPlusPerks": true }`

### `GET /invites` 🛡️
List all invites created by the admin, including redemption status and details of the redeemer.

### `POST /invites/validate`
Check if an invite code is valid, unused, and hasn't expired.
- **Body:** `{ "inviteCode": "..." }`

### `POST /invites/diagnostic` 🛡️
Retrieve deep technical metadata for an invite code (Supabase schema, reservation status, etc.).

### `GET /invites/dynamic?inviteCode=...`
Returns a stylized, dynamic HTML landing page for a specific invite code.

---

## 📡 6. Features (Extended Logic)

### `GET /features?action=insights`
Live real-time user count from Google Analytics GA4.

### `POST /features?action=save-promo` 🛡️
Updates the homepage promotion modal configuration (`promo.json`).

### `GET /features?action=google-drive&subAction=auth-url`
Get OAuth link for Google Drive.

### `GET /features?action=google-drive&subAction=files`
List files in the user's `materio` folder on Drive.

### `POST /features?action=notebooks&subAction=sync` 💎
Cloud synchronization for the user's personal notebooks. Requires Plus/Pro.
- **Body:** `{ "notebook": { "id": "...", "title": "...", "content": "..." } }`

### `POST /features?action=subscription&subAction=create-order`
Create a Razorpay order for Plus (₹59) or Pro (₹299).

### `POST /features?action=pdf-share&subAction=create-llm`
Generate a temporary (6-hour) masked URL specifically for LLM ingestion.

---

## 📦 7. Content Delivery (CDN) 🛡️

### `GET /cdn`
Browse the GitHub repository contents.
- **Param:** `path` (e.g., `pdfs/5/Machine Learning`).

### `POST /cdn?batch=true`
Multi-file upload. Automatically handles:
1. Creating GitHub blobs.
2. Updating `semester-subjects.json`.
3. Updating `resource.lib.json` database.

### `PUT /cdn`
Rename a file in the repository.
- **Body:** `{ "oldPath": "...", "newPath": "..." }`

---

## 🏥 8. Health & Support

### `GET /health`
JSON summary of system health (Supabase, CDN API, Internet, active incidents via Incident.io).

### `POST /health/report`
Submit a bug report.
- **Body:**
  ```json
  {
    "title": "Search is failing",
    "severity": "major",
    "affectedArea": "Search UI",
    "description": "I get a 500 error when typing 'ML'..."
  }
  ```

### `POST /health/alert` (Internal)
Trigger a system-wide alert email (requires `x-alert-key`).

---
🛡️ = Admin Only | 💎 = Plus/Pro Required
