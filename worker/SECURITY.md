# Dashboard authentication

The Cloudflare Worker hosts the dashboard and its API on the same origin. GitHub Pages redirects there. All `/api/*` data routes require a session; hiding the frontend is not the access control.

Credentials: `DASHBOARD_AUTH` is a Cloudflare secret containing `username`, a random 16-byte hex `salt`, and a PBKDF2-HMAC-SHA256 `hash` (100000 iterations, 32 bytes). Never commit a real password, hash, or this secret. Existing TikTok secrets and shop records are unchanged.

Sessions: random 256-bit tokens in Secure, HttpOnly, SameSite=Strict, host-only cookies; only SHA-256 token digests in KV; four-hour absolute expiry. No password or session token in browser storage. Logout clears the cookie and deletes the KV session. KV revocation is eventually consistent across locations, so a stolen cookie may remain usable briefly after logout. It still expires server-side after four hours.

Limits: 5 login attempts/minute per source IP and 20/minute for the shared account per Cloudflare location. These edge limits are approximate, not global strict lockouts. A shared numeric password remains weak despite hashing and throttling; use a unique long password and consider individual accounts/MFA for stronger protection.

Responses: no-store, CSP, frame-ancestors none, nosniff, HSTS and no-referrer. Cross-origin API requests and mutation requests missing the correct Origin are rejected. No TikTok data is embedded in static assets.

Check: `node --test worker/auth.test.mjs`. Deploy from `worker/` with Wrangler after setting the secret securely. Never deploy frontend files alone without the server authentication gate. Do not export the secret to source files or logs.
