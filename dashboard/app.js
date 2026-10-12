const API_URL = "https://tiktok-shop-dashboard-api.nhatrang-mart-api.workers.dev";
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("vi-VN");
let activeTab = "day";
let dailyShop = "";
let rangeShop = "";

function daysAgoISO(days) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

function money(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount ?? 0} ${currency ?? ""}`.trim();
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: currency || "VND", maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(numeric);
}

function showError(target, error) {
  target.classList.add("error");
  target.textContent = error.message;
}

function selectedShopName() {
  return $("shopSelect").selectedOptions[0]?.textContent || "TikTok Shop";
}

function resetDailyStats() {
  $("shopName").textContent = selectedShopName();
  $("gmv").textContent = "—";
  $("itemsSold").textContent = "—";
  $("skuOrders").textContent = "—";
  $("orders").textContent = "—";
  $("latestDate").textContent = "—";
}

function resetRangeStats() {
  $("shopName").textContent = selectedShopName();
  $("totalGmv").textContent = "—";
  $("totalItemsSold").textContent = "—";
  $("totalSkuOrders").textContent = "—";
  $("totalOrders").textContent = "—";
  $("totalRange").textContent = "—";
}

async function loadStats() {
  const status = $("status");
  resetDailyStats();
  status.classList.remove("error");
  status.textContent = "Đang tải dữ liệu...";
  const shop = $("shopSelect").value;
  const date = $("reportDate").value;
  const response = await fetch(`${API_URL}/api/stats?shop=${encodeURIComponent(shop)}&date=${encodeURIComponent(date)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Máy chủ trả lỗi HTTP ${response.status}`);
  $("shopName").textContent = result.shop_name || "TikTok Shop";
  $("gmv").textContent = money(result.gmv, result.currency);
  $("itemsSold").textContent = numberFormat.format(result.items_sold || 0);
  $("skuOrders").textContent = numberFormat.format(result.sku_orders_count || 0);
  $("orders").textContent = numberFormat.format(result.orders_count || 0);
  $("latestDate").textContent = result.latest_available_date || "Không rõ";
  status.textContent = `Đã cập nhật số liệu ngày ${date}.`;
  dailyShop = shop;
}

async function loadRangeStats() {
  const status = $("totalStatus");
  resetRangeStats();
  status.classList.remove("error");
  status.textContent = "Đang tải số liệu trong khoảng ngày...";
  const shop = $("shopSelect").value;
  const startDate = $("totalStartDate").value;
  const endDate = $("totalEndDate").value;
  const response = await fetch(`${API_URL}/api/total?shop=${encodeURIComponent(shop)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Máy chủ trả lỗi HTTP ${response.status}`);
  $("shopName").textContent = result.shop_name || "TikTok Shop";
  $("totalGmv").textContent = money(result.gmv, result.currency);
  $("totalItemsSold").textContent = numberFormat.format(result.items_sold || 0);
  $("totalSkuOrders").textContent = numberFormat.format(result.sku_orders_count || 0);
  $("totalOrders").textContent = numberFormat.format(result.orders_count || 0);
  $("totalRange").textContent = `${result.period_start} đến ${result.period_end}`;
  status.textContent = `Đã cập nhật số liệu từ ${result.period_start} đến ${result.period_end}.`;
  rangeShop = shop;
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

async function switchTab(tab) {
  activeTab = tab;
  const isDay = tab === "day";
  $("dayTab").classList.toggle("active", isDay);
  $("rangeTab").classList.toggle("active", !isDay);
  $("dayTab").setAttribute("aria-selected", String(isDay));
  $("rangeTab").setAttribute("aria-selected", String(!isDay));
  $("dayPanel").hidden = !isDay;
  $("rangePanel").hidden = isDay;
  const shop = $("shopSelect").value;
  try {
    if (isDay && dailyShop !== shop) await loadStats();
    if (!isDay && rangeShop !== shop) await loadRangeStats();
  } catch (error) {
    showError(isDay ? $("status") : $("totalStatus"), error);
  }
}

$("reportDate").value = daysAgoISO(1);
$("totalStartDate").value = daysAgoISO(30);
$("totalEndDate").value = daysAgoISO(1);
$("dayTab").addEventListener("click", () => switchTab("day"));
$("rangeTab").addEventListener("click", () => switchTab("range"));
$("shopSelect").addEventListener("change", () => { dailyShop = ""; rangeShop = ""; switchTab(activeTab); });
$("filterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await loadStats(); } catch (error) { showError($("status"), error); }
});
$("totalFilterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await loadRangeStats(); } catch (error) { showError($("totalStatus"), error); }
});
loadShops().then(() => loadStats()).catch((error) => showError($("status"), error));
