const API_URL = "https://tiktok-shop-dashboard-api.nhatrang-mart-api.workers.dev";
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("vi-VN");

function yesterdayISO() {
  const value = new Date();
  value.setDate(value.getDate() - 1);
  return value.toISOString().slice(0, 10);
}

function money(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount ?? 0} ${currency ?? ""}`.trim();
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: currency || "VND", maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(numeric);
}

async function loadStats(date) {
  $("status").classList.remove("error");
  $("status").textContent = "Đang tải dữ liệu...";
  const shop = $("shopSelect").value;
  const response = await fetch(`${API_URL}/api/stats?shop=${encodeURIComponent(shop)}&date=${encodeURIComponent(date)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Máy chủ trả lỗi HTTP ${response.status}`);
  $("shopName").textContent = result.shop_name || "TikTok Shop";
  $("gmv").textContent = money(result.gmv, result.currency);
  $("itemsSold").textContent = numberFormat.format(result.items_sold || 0);
  $("skuOrders").textContent = numberFormat.format(result.sku_orders_count || 0);
  $("orders").textContent = numberFormat.format(result.orders_count || 0);
  $("latestDate").textContent = result.latest_available_date || "Không rõ";
  $("status").textContent = `Đã cập nhật số liệu ngày ${date}.`;
}

async function loadShops() {
  const response = await fetch(`${API_URL}/api/shops`);
  const shops = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(shops) || shops.length === 0) throw new Error("Không tải được danh sách shop.");
  $("shopSelect").replaceChildren(...shops.map((shop) => {
    const option = document.createElement("option");
    option.value = shop.key;
    option.textContent = shop.name;
    return option;
  }));
}

$("reportDate").value = yesterdayISO();
$("filterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await loadStats($("reportDate").value); }
  catch (error) { $("status").classList.add("error"); $("status").textContent = error.message; }
});
loadShops()
  .then(() => loadStats($("reportDate").value))
  .catch((error) => { $("status").classList.add("error"); $("status").textContent = error.message; });
