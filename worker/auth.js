const SESSION_SECONDS = 4 * 60 * 60;
const COOKIE = "__Host-vifon_session";
const encoder = new TextEncoder();

async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request) {
  return request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
}

function sessionCookie(value, seconds) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}

async function session(request, env) {
  const token = cookieValue(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const key = `dashboard:session:${await sha256(token)}`;
  const saved = await env.TIKTOK_TOKENS.get(key, "json");
  return saved && saved.expires > Date.now() ? { ...saved, key } : null;
}

async function readLogin(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw Error("invalid input");
  const reader = request.body?.getReader();
  if (!reader) throw Error("invalid input");
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2048) { await reader.cancel(); throw Error("invalid input"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof data.username !== "string" || typeof data.password !== "string" || data.username.length > 100 || data.password.length > 256) throw Error("invalid input");
  return data;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function authGate(request, env) {
  const url = new URL(request.url);
  const reply = (data, status = 200, cookie) => new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...(cookie ? { "set-cookie": cookie } : {}) },
  });
  // Same-origin cookies only. Cross-origin requests never receive CORS permission.
  const origin = request.headers.get("origin");
  if ((origin && origin !== url.origin) || (request.method !== "GET" && origin !== url.origin)) return reply({ error: "Yêu cầu không được phép." }, 403);
  if (!env.DASHBOARD_AUTH) return reply({ error: "Đăng nhập chưa được cấu hình." }, 503);
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!env.LOGIN_RATE_LIMIT || !(await env.LOGIN_RATE_LIMIT.limit({ key: `login:${ip}` })).success) return reply({ error: "Thử đăng nhập quá nhiều. Vui lòng chờ một phút." }, 429);
    let data;
    try { data = await readLogin(request); } catch { return reply({ error: "Thông tin đăng nhập không hợp lệ." }, 400); }
    const config = JSON.parse(env.DASHBOARD_AUTH);
    if (!env.ACCOUNT_RATE_LIMIT || !(await env.ACCOUNT_RATE_LIMIT.limit({ key: "dashboard-login" })).success) return reply({ error: "Thử đăng nhập quá nhiều. Vui lòng chờ một phút." }, 429);
    const material = await crypto.subtle.importKey("raw", encoder.encode(data.password), "PBKDF2", false, ["deriveBits"]);
    const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(config.salt.match(/../g), h => parseInt(h, 16)), iterations: 100000 }, material, 256));
    const expected = Uint8Array.from(config.hash.match(/../g), h => parseInt(h, 16));
    const passwordMatches = sameBytes(hash, expected);
    if (data.username !== config.username || !passwordMatches) return reply({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }, 401);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, "0")).join("");
    const expires = Date.now() + SESSION_SECONDS * 1000;
    await env.TIKTOK_TOKENS.put(`dashboard:session:${await sha256(token)}`, JSON.stringify({ username: config.username, expires }), { expirationTtl: SESSION_SECONDS });
    return reply({ username: config.username, expires }, 200, sessionCookie(token, SESSION_SECONDS));
  }
  const current = await session(request, env);
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (current) await env.TIKTOK_TOKENS.delete(current.key);
    return reply({ ok: true }, 200, sessionCookie("", 0));
  }
  if (!current) return reply({ error: "Vui lòng đăng nhập để xem số liệu." }, 401);
  if (url.pathname === "/api/auth/me" && request.method === "GET") return reply({ username: current.username, expires: current.expires });
  if (request.method !== "GET") return reply({ error: "Phương thức không được phép." }, 405);
  return null;
}

export function secureResponse(response) {
  const secured = new Response(response.body, response);
  for (const name of [...secured.headers.keys()]) if (name.startsWith("access-control-")) secured.headers.delete(name);
  secured.headers.set("cache-control", "no-store");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return secured;
}
