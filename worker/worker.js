import { authGate, secureResponse } from "./auth.js";
const API_HOST = "https://open-api.tiktokglobalshop.com";
const TOKEN_GET_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const TOKEN_REFRESH_URL = "https://auth.tiktok-shops.com/api/v2/token/refresh";

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.ALLOWED_ORIGIN) return "*";
  return origin === env.ALLOWED_ORIGIN ? origin : "null";
}

function assertConfig(env) {
  if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
    throw new Error("Worker thiếu TIKTOK_APP_KEY hoặc TIKTOK_APP_SECRET.");
  }
}

function appCredentials(env, shop) {
  const appKey = shop.app_key_env ? env[shop.app_key_env] : env.TIKTOK_APP_KEY;
  const appSecret = shop.app_secret_env ? env[shop.app_secret_env] : env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error(`Thiếu khóa ứng dụng cho ${shop.name || shop.key}.`);
  }
  return { appKey, appSecret };
}

function unwrap(payload, action) {
  if (payload.code !== 0 && payload.code !== "0") {
    const error = new Error(`${action}: ${payload.message || "TikTok trả lỗi"}`);
    error.tiktokCode = Number(payload.code);
    error.requestId = payload.request_id;
    throw error;
  }
  return payload.data && typeof payload.data === "object" ? payload.data : payload;
}

async function tokenRequest(url, params, action) {
  const response = await fetch(`${url}?${new URLSearchParams(params)}`);
  const payload = await response.json();
  return unwrap(payload, action);
}

async function loadToken(env, shop) {
  const tokenKey = shop.token_key || `seller:${shop.key}`;
  const saved = await env.TIKTOK_TOKENS.get(tokenKey, "json");
  if (saved?.access_token) return saved;
  if (tokenKey !== "seller" || !env.TIKTOK_AUTH_CODE) {
    throw new Error("Chưa có token. Hãy đặt secret TIKTOK_AUTH_CODE bằng mã ủy quyền mới.");
  }
  const token = await tokenRequest(
    TOKEN_GET_URL,
    {
      app_key: env.TIKTOK_APP_KEY,
      app_secret: env.TIKTOK_APP_SECRET,
      auth_code: env.TIKTOK_AUTH_CODE,
      grant_type: "authorized_code",
    },
    "Không đổi được auth_code"
  );
  if (token.user_type !== undefined && Number(token.user_type) !== 0) {
    throw new Error("Token này không phải seller token (user_type phải bằng 0)." );
  }
  await env.TIKTOK_TOKENS.put(tokenKey, JSON.stringify(token));
  return token;
}

async function refreshToken(env, current, shop) {
  if (!current.refresh_token) throw new Error("Không có refresh_token; cần ủy quyền lại.");
  const { appKey, appSecret } = appCredentials(env, shop);
  const token = await tokenRequest(
    TOKEN_REFRESH_URL,
    {
      app_key: appKey,
      app_secret: appSecret,
      refresh_token: current.refresh_token,
      grant_type: "refresh_token",
    },
    "Không refresh được token"
  );
  await env.TIKTOK_TOKENS.put(shop.token_key || `seller:${shop.key}`, JSON.stringify(token));
  return token;
}

async function hmacSha256(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeSign(path, params, secret) {
  const joined = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return hmacSha256(secret, `${secret}${path}${joined}${secret}`);
}

async function signedGet(env, shop, accessToken, path, businessParams) {
  const { appKey, appSecret } = appCredentials(env, shop);
  const params = {
    ...businessParams,
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000),
  };
  params.sign = await makeSign(path, params, appSecret);
  // Newer app registrations follow the current TikTok documentation and send
  // the seller token only in the x-tts-access-token header.
  if (!shop.header_only_token) params.access_token = accessToken;
  const response = await fetch(`${API_HOST}${path}?${new URLSearchParams(params)}`, {
    headers: {
      "content-type": "application/json",
      "x-tts-access-token": accessToken,
    },
  });
  return response.json();
}

async function apiGetWithRefresh(env, shop, path, params) {
  let token = await loadToken(env, shop);
  let payload = await signedGet(env, shop, token.access_token, path, params);
  if ([105001, 105002].includes(Number(payload.code))) {
    token = await refreshToken(env, token, shop);
    payload = await signedGet(env, shop, token.access_token, path, params);
  }
  return unwrap(payload, `TikTok API ${path}`);
}

async function getShops(env) {
  const shops = await env.TIKTOK_TOKENS.get("shops", "json");
  if (!Array.isArray(shops) || shops.length === 0) {
    throw new Error("Chưa cấu hình danh sách shop.");
  }
  return shops;
}

async function getShop(env, shopKey) {
  const shops = await getShops(env);
  const shop = shops.find((item) => item.key === shopKey) || shops[0];
  if (!shop.id || !shop.cipher) throw new Error(`Shop ${shop.name || shop.key} thiếu mã định danh.`);
  return shop;
}

function nextDate(isoDate) {
  return addDays(isoDate, 1);
}

function addDays(isoDate, days) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) throw new Error("Ngày không hợp lệ; cần định dạng YYYY-MM-DD.");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function todayInVietnam() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatSales(shop, interval, extra = {}) {
  const sales = interval.sales || {};
  return {
    shop_name: shop.name,
    gmv: sales.gmv?.amount || sales.gmv?.overall?.amount || "0",
    currency: sales.gmv?.currency || sales.gmv?.overall?.currency || "VND",
    items_sold: sales.items_sold || 0,
    sku_orders_count: sales.sku_orders_count || 0,
    orders_count: sales.orders_count || 0,
    ...extra,
  };
}

async function getStats(env, shopKey, reportDate) {
  const shop = await getShop(env, shopKey);
  if (!shop.cipher) throw new Error("Thiếu TIKTOK_SHOP_CIPHER.");
  const analyticsVersion = shop.key === "thong-tu" ? "202609" : (shop.analytics_version || "202609");
  const data = await apiGetWithRefresh(env, shop, `/analytics/${analyticsVersion}/shop/performance`, {
    shop_cipher: shop.cipher,
    shop_id: shop.id,
    version: analyticsVersion,
    start_date_ge: reportDate,
    end_date_lt: nextDate(reportDate),
    granularity: "ALL",
    currency: "LOCAL",
  });
  const interval = data.performance?.intervals?.[0];
  if (!interval) {
    throw new Error(`Chưa có dữ liệu ngày ${reportDate}. Ngày mới nhất: ${data.latest_available_date || "không rõ"}.`);
  }
  return formatSales(shop, interval, {
    date: reportDate,
    latest_available_date: data.latest_available_date || null,
  });
}

async function getTotalStats(env, shopKey, requestedStart, requestedEnd) {
  const shop = await getShop(env, shopKey);
  const analyticsVersion = shop.key === "thong-tu" ? "202609" : (shop.analytics_version || "202609");
  const today = todayInVietnam();
  const defaultEnd = addDays(today, -1);
  const startDate = requestedStart || addDays(today, -365);
  const endDate = requestedEnd || defaultEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Ngày tổng phải theo định dạng YYYY-MM-DD.");
  }
  if (startDate > endDate) throw new Error("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  if (endDate >= today) throw new Error("Ngày kết thúc phải trước ngày hôm nay.");
  const rangeDays = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (rangeDays > 365) throw new Error("TikTok chỉ cho xem tổng tối đa 365 ngày mỗi lần.");
  if (startDate < addDays(today, -365)) throw new Error("Ngày bắt đầu nằm ngoài khoảng dữ liệu 365 ngày TikTok cho phép.");
  const data = await apiGetWithRefresh(env, shop, `/analytics/${analyticsVersion}/shop/performance`, {
    shop_cipher: shop.cipher,
    shop_id: shop.id,
    version: analyticsVersion,
    start_date_ge: startDate,
    end_date_lt: nextDate(endDate),
    granularity: "ALL",
    currency: "LOCAL",
  });
  const interval = data.performance?.intervals?.[0];
  if (!interval) throw new Error(`Chưa có dữ liệu tổng cho ${shop.name || shop.key}.`);
  return formatSales(shop, interval, {
    period_start: interval.start_date || startDate,
    period_end: interval.end_date ? addDays(interval.end_date, -1) : endDate,
    latest_available_date: data.latest_available_date || null,
  });
}

const api = {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    if (origin === "null") return json({ error: "Origin không được phép." }, 403, origin);

    try {
      assertConfig(env);
      const url = new URL(request.url);
      if (url.pathname === "/api/shops" && request.method === "GET") {
        const shops = await getShops(env);
        return json(
          shops.map(({ key, name }) => ({ key, name })),
          200,
          origin
        );
      }
      if (url.pathname === "/api/stats" && request.method === "GET") {
        const reportDate = url.searchParams.get("date");
        const shopKey = url.searchParams.get("shop") || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate || "")) {
          return json({ error: "Thiếu date theo định dạng YYYY-MM-DD." }, 400, origin);
        }
        return json(await getStats(env, shopKey, reportDate), 200, origin);
      }
      if (url.pathname === "/api/total" && request.method === "GET") {
        const shopKey = url.searchParams.get("shop") || "";
        const startDate = url.searchParams.get("start_date") || "";
        const endDate = url.searchParams.get("end_date") || "";
        return json(await getTotalStats(env, shopKey, startDate, endDate), 200, origin);
      }
      return json({ error: "Không tìm thấy endpoint." }, 404, origin);
    } catch (error) {
      return json(
        { error: error.message, request_id: error.requestId || null },
        500,
        origin
      );
    }
  },
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 308);
      if (url.pathname.startsWith("/api/")) {
        const denied = await authGate(request, env);
        if (denied) return secureResponse(denied);
        return secureResponse(await api.fetch(request, env));
      }
      return secureResponse(await env.ASSETS.fetch(request));
    } catch {
      return secureResponse(new Response(JSON.stringify({ error: "Không xử lý được yêu cầu. Vui lòng thử lại." }), { status: 500, headers: { "content-type": "application/json" } }));
    }
  },
};
