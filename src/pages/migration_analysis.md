# Migration Feasibility: Vercel to Cloudflare Workers (api/v2)

Migrating your `api/v2` endpoints from Vercel to Cloudflare Workers is **highly feasible but requires a moderate amount of refactoring**. 

Vercel's Serverless Functions execute in a standard Node.js environment, whereas Cloudflare Workers execute in V8 isolates. This fundamental difference means that you cannot do a pure "lift-and-shift." 

Here is a breakdown of what the migration entails for the `api/v2` directory.

---

## 1. Core Handler Refactoring
Currently, your endpoints (like `auth.js`, `features.js`, `search.js`) are written using Vercel's Express-like `req, res` paradigm:
```javascript
// Current Vercel/Node.js approach
module.exports = async (req, res) => {
  const body = req.body;
  return res.status(200).json({ success: true });
};
```
For Cloudflare Workers, you will need to refactor **every endpoint** to use ES Modules and the Web Fetch API:
```javascript
// New Cloudflare Workers approach
export default {
  async fetch(request, env, ctx) {
    const body = await request.json();
    return Response.json({ success: true }, { status: 200 });
  }
};
```
> [!TIP]
> **Recommendation:** Instead of manually rewriting all the routing logic (like the `if (action === ...)` blocks in `auth.js`), consider wrapping your API using a lightweight edge framework like **[Hono](https://hono.dev/)** or **itty-router**. They provide an Express-like syntax that works perfectly on Cloudflare.

## 2. Environment Variables
In Vercel, you access environment variables globally via `process.env`. 

In Cloudflare Workers, there is no global `process.env`. Environment variables and secrets are passed into the `fetch` handler via the `env` object. You will need to pass this `env` object down to your utility functions (like `_utils.js`) wherever secrets are needed.

## 3. Module System
Cloudflare Workers rely entirely on ES Modules. You will need to replace all CommonJS syntax (`require()` and `module.exports`) with ES Modules (`import` and `export default`) across the `api/v2` codebase.

---

## 4. Dependency Compatibility Issues
Cloudflare Workers do not run a full Node.js environment. While you can enable the `nodejs_compat` flag for some built-in modules (like `crypto` and `buffer`), packages that rely on native Node.js APIs (like raw TCP sockets or the File System) will break at the Edge.

Here are the specific dependencies found in your API that will require attention:

### 🔴 MongoDB Driver (`mongodb`)
The official native `mongodb` Node driver relies heavily on raw TCP sockets (`net` and `tls` modules) which are not natively supported in the same way on Cloudflare Workers. 
* **Solution:** You will need to switch to the **MongoDB Atlas Data API** (which uses standard HTTP requests) or use an Edge-compatible ORM like Prisma (with the Edge extension) or Mongoose's edge capabilities.

### 🔴 Nodemailer (`nodemailer`)
Used in your `api/_utils_shared/mailer.js`. `nodemailer` relies on Node's `net` module to connect to SMTP servers, which will fail on Cloudflare Workers.
* **Solution:** Replace `nodemailer` with an HTTP-based email provider SDK or API (e.g., Resend, Sendgrid, Postmark, or Cloudflare's own MailChannels integration).

### 🟢 Supabase (`@supabase/supabase-js`)
* **Status:** Fully compatible. It operates over standard HTTP/REST and WebSockets, so it runs perfectly on Cloudflare Workers. No changes required.

### 🟡 Node Built-ins (e.g., `crypto`)
Files like `auth.js` rely on Node's `crypto` module (e.g., `crypto.randomBytes`). 
* **Solution:** You can either enable the `nodejs_compat` compatibility flag in your `wrangler.toml`, or (preferably) refactor those pieces to use the standard **Web Crypto API** (`crypto.subtle`), which is natively supported and highly optimized on Cloudflare Workers.

---

## 5. Routing and Configuration
Your project currently relies on `vercel.json` for routing rewrites (e.g., mapping `/.well-known/openid-configuration` to `/api/v2/auth?action=oidc_metadata`).
* **Solution:** You will need to recreate these routing rules. If you use a standalone Cloudflare Worker, you can handle these rewrites directly inside your router (e.g., using Hono). Alternatively, if you deploy this via Cloudflare Pages Functions, you can configure a `_routes.json` file.

## Conclusion
The migration is completely viable and will likely result in lower latency and better scalability. However, **it is not a drop-in replacement**. You should anticipate significant refactoring in `api/v2` to transition from Node.js `req/res` to the Fetch API, as well as migrating away from `nodemailer` and the native `mongodb` driver.
