# API v2 - Login Endpoint Documentation

## Endpoint Overview

**Base URL:** `https://materioa.vercel.app/api/v2/login`  
**Method:** `POST`  
**CORS:** Enabled (see CORS section)

---

## Authentication Flows

The login endpoint supports three distinct authentication flows:

### 1. Traditional Login (Username/Email + Password)
Standard login with username/email and password credentials.

**Use Case:** User credentials-based authentication, initial login for obtaining tokens.

**Request:**
```json
{
  "username": "john_doe",  // or email: "john@example.com"
  "password": "userPassword123",
  "method": "password"     // optional, defaults to "password"
}
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "handoffCode": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid-here",
    "username": "john_doe",
    "displayName": "John Doe",
    "email": "john@example.com",
    "hasAdminPrivileges": false,
    "isPlusUser": true,
    "profilePicture": "https://cdn.example.com/avatar.jpg"
  }
}
```

**Error Responses:**
```json
// 400 Bad Request
{ "error": "Username or email is required" }
{ "error": "Password is required" }

// 401 Unauthorized
{ "error": "Identity not found" }
{ "error": "Invalid credentials" }
```

---

### 2. OTP Login (One-Time Password)
Passwordless login using a verification code (OTP) sent via email.

**Use Case:** Passwordless authentication, enhanced security alternative to password login.

**Request:**
```json
{
  "username": "john_doe",  // or email: "john@example.com"
  "otp": "123456",
  "method": "otp"
}
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "handoffCode": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid-here",
    "username": "john_doe",
    "displayName": "John Doe",
    "email": "john@example.com",
    "hasAdminPrivileges": false,
    "isPlusUser": true,
    "profilePicture": "https://cdn.example.com/avatar.jpg"
  }
}
```

**Error Responses:**
```json
// 400 Bad Request
{ "error": "Username or email is required" }
{ "error": "Verification code is required" }

// 401 Unauthorized
{ "error": "Identity not found" }
{ "error": "Invalid or expired verification code" }
```

---

### 3. Handoff Code Creation
Create a temporary, one-time handoff code using an existing valid JWT token.

**Use Case:** 
- Cross-origin token exchange (browser to mobile, web to desktop app)
- Secure token handoff between different origins/environments
- MCP server to client authentication handoff

**Request:**
```bash
POST /api/v2/login
Authorization: Bearer <valid-jwt-token>
```

**Request Body (one of these formats):**
```json
// Option A: action parameter
{
  "action": "create"
}

// Option B: Implicit (no body required when token in header)
{}
```

**Response (200 OK):**
```json
{
  "message": "Handoff code created",
  "handoffCode": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "expiresIn": 60
}
```

**Error Responses:**
```json
// 401 Unauthorized
{ "error": "Authentication required" }
{ "error": "Invalid or expired token" }

// 500 Server Error
{ "error": "Failed to create handoff code" }
```

---

### 4. Handoff Code Exchange
Exchange a temporary handoff code for a JWT token (typically from a different origin/environment).

**Use Case:**
- Completing cross-origin authentication flow
- MCP client exchanging handoff code for JWT token
- Secure token transfer between isolated environments

**Request:**
```json
{
  "action": "exchange",
  "code": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

**Alternative Format (both work):**
```json
{
  "handoffCode": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

**Response (200 OK):**
```json
{
  "message": "Handoff successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid-here",
    "username": "john_doe",
    "displayName": "John Doe",
    "email": "john@example.com",
    "hasAdminPrivileges": false,
    "isPlusUser": true,
    "profilePicture": "https://cdn.example.com/avatar.jpg"
  }
}
```

**Error Responses:**
```json
// 400 Bad Request
{ "error": "Handoff code is required" }

// 401 Unauthorized
{ "error": "Invalid or expired handoff code" }
{ "error": "Handoff code has expired" }
```

---

## CORS Configuration

The endpoint accepts requests from these origins:
- `http://localhost:*` (any localhost port)
- `https://materioa.netlify.app`
- `https://materioa.vercel.app`
- `https://materioapp.in`
- `https://auth-materioa.netlify.app`
- `https://insightroom.vercel.app`

**CORS Headers Added to All Responses:**
```
Access-Control-Allow-Origin: [matched-origin]
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

**Preflight Requests:** The endpoint automatically handles `OPTIONS` requests.

---

## JWT Token Details

**Token Type:** JWT (JSON Web Token)  
**Secret:** Stored in `SUPABASE_SERVICE_KEY` configuration  
**Payload:**
```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "username": "username",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Default Expiration:** Configured via `JWT_EXPIRES_IN` env var (typically 7 days)

**Usage in Headers:**
```bash
Authorization: Bearer <jwt-token>
```

---

## Handoff Code Details

**Code Format:** 32-character hexadecimal string (cryptographically random)  
**Example:** `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

**Lifetime:** 60 seconds (one-time use)

**Security:**
- One-time use only (consumed on exchange)
- Cryptographically random generation
- Server-side expiration validation
- Optional IP/User-Agent validation available (currently disabled for flexibility)

---

## MCP Integration Guide

### Setup: Obtain Initial Token

```javascript
// 1. Perform traditional login
const loginResponse = await fetch('https://materioa.vercel.app/api/v2/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'user@example.com',
    password: 'password123'
  })
});

const { token, handoffCode } = await loginResponse.json();
```

### Step 1: Create Handoff Code (Server-side)

Use an existing valid token to create a handoff code:

```javascript
const handoffResponse = await fetch('https://materioa.vercel.app/api/v2/login', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${serverToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ action: 'create' })
});

const { handoffCode, expiresIn } = await handoffResponse.json();
// handoffCode is valid for 60 seconds
```

### Step 2: Exchange Handoff Code (Client-side)

The MCP client exchanges the code for a token:

```javascript
const tokenResponse = await fetch('https://materioa.vercel.app/api/v2/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'exchange',
    code: handoffCode
  })
});

const { token, user } = await tokenResponse.json();
// Now use token in Authorization header for authenticated requests
```

### Using Token for Authenticated Requests

```javascript
const response = await fetch('https://materioa.vercel.app/api/v2/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

---

## Error Handling

### Common Error Codes

| Status | Error | Cause |
|--------|-------|-------|
| 400 | Missing required field | Username, password, OTP, or code not provided |
| 401 | Invalid credentials | Incorrect password or expired OTP |
| 401 | Invalid or expired token | JWT token is invalid or has expired |
| 401 | Handoff code expired | Code older than 60 seconds |
| 405 | Method not allowed | Request method is not POST |
| 500 | Internal server error | Server-side issue (see details) |

### Retry Strategy

- **400 Errors:** Don't retry - fix the request
- **401 Errors:** Don't retry - credentials/token invalid or expired
- **500 Errors:** Retry with exponential backoff (2s, 4s, 8s)

---

## Security Considerations

1. **Token Storage:**
   - Store JWT tokens securely (HttpOnly cookies or secure storage)
   - Never expose tokens in URLs
   - Include in Authorization header only

2. **Handoff Codes:**
   - Use HTTPS only - codes are single-use, time-limited (60s)
   - Don't reuse handoff codes
   - Create new codes for each exchange

3. **Password Security:**
   - Use HTTPS for password transmission
   - Passwords are hashed with bcrypt (10 salt rounds)
   - Never store plain-text passwords

4. **OTP Security:**
   - One-time codes are single-use
   - Automatically deleted after use or expiration
   - Never request OTP via unsecured channels

5. **CORS:**
   - Only whitelisted origins are allowed
   - Credentials are allowed in cross-origin requests
   - Preflight requests are automatically handled

---

## Rate Limiting

No built-in rate limiting at the endpoint level. Implement rate limiting on:
- Authentication attempts (login/OTP)
- Handoff code creation
- Token generation

---

## Testing

### Test Traditional Login
```bash
curl -X POST https://materioa.vercel.app/api/v2/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "testpass123"
  }'
```

### Test Handoff Creation
```bash
curl -X POST https://materioa.vercel.app/api/v2/login \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "create"}'
```

### Test Handoff Exchange
```bash
curl -X POST https://materioa.vercel.app/api/v2/login \
  -H "Content-Type: application/json" \
  -d '{
    "action": "exchange",
    "code": "handoff_code_here"
  }'
```

---

## Environment Configuration

Required environment variables (in `_config_shared/supabase.js`):

```javascript
{
  SUPABASE_URL,           // Supabase project URL
  SUPABASE_ANON_KEY,      // Supabase anonymous key
  SUPABASE_SERVICE_KEY,   // Supabase service key (for admin operations)
  JWT_SECRET,             // Secret for signing JWT tokens
  JWT_EXPIRES_IN          // Token expiration time (e.g., "7d")
}
```

---

## Related Endpoints

- `/api/v2/auth` - Authentication state management
- `/api/v2/signup` - User registration
- `/api/v2/profile` - User profile management (requires authentication)

---

## Changelog

- **v2.0** (Current)
  - Support for password, OTP, and handoff-based authentication
  - CORS support for cross-origin requests
  - JWT token generation and validation
  - Secure handoff code exchange for cross-environment authentication
