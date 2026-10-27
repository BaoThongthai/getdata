const API_URL = "https://tiktok-shop-dashboard-api.nhatrang-mart-api.workers.dev";
const fetch = window.dashboardFetch;
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("vi-VN");
let activeTab = "day";
let dailyShop = "";
let rangeShop = "";
let allShops = [];
let monthlyLoaded = "";
let monthController;
let dailyController;
let productsController;
let rangeProductsController;
const ALL_SHOPS = "__all__";

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
  void loadTopProducts();
  const status = $("status");
  resetDailyStats();
  status.classList.remove("error");
  status.textContent = "Đang tải dữ liệu...";
  const shop = $("shopSelect").value;
  const date = $("reportDate").value;
  dailyController?.abort();
  const controller = new AbortController();
  dailyController = controller;
  const timeout = setTimeout(() => controller.abort(), 45000);
  let result;
  try {
    const targets = shop === ALL_SHOPS ? allShops : allShops.filter(item => item.key === shop);
    if (!targets.length) throw new Error("Danh sách cửa hàng chưa sẵn sàng.");
    const rows = await Promise.all(targets.map(async target => {
      try {
        const query = new URLSearchParams({ shop: target.key, date });
        const response = await fetch(`${API_URL}/api/stats?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (data.shop_name !== target.name || data.date !== date) throw new Error("Dữ liệu không đúng shop hoặc ngày đã chọn.");
        if (data.currency !== "VND") throw new Error("Đơn vị tiền tệ không hợp lệ.");
        const cents = toCents(data.gmv);
        for (const key of ["items_sold", "sku_orders_count", "orders_count"]) {
          if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error("Chỉ số trả về không hợp lệ.");
        }
        return { data, cents };
      } catch (error) { return { error: `${target.name}: ${error.message}` }; }
    }));
    if (dailyController !== controller || $("shopSelect").value !== shop || $("reportDate").value !== date || activeTab !== "day") return;
    const failed = rows.filter(row => row.error);
    if (failed.length) throw new Error(`Chưa tải đủ dữ liệu (${rows.length - failed.length}/${rows.length} cửa hàng). Không hiển thị tổng thiếu. ${failed.map(row => row.error).join("; ")}. Bấm “Xem số liệu” để thử lại.`);
    const sum = key => {
      const value = rows.reduce((total, row) => total + row.data[key], 0);
      if (!Number.isSafeInteger(value)) throw new Error("Tổng chỉ số vượt giới hạn xử lý.");
      return value;
    };
    const dates = rows.map(row => row.data.latest_available_date).filter(Boolean).sort();
    result = shop === ALL_SHOPS ? {
      shop_name: "Tổng cộng · Tất cả cửa hàng",
      gmv: Number(rows.reduce((total, row) => total + row.cents, 0n)) / 100,
      currency: "VND", items_sold: sum("items_sold"), sku_orders_count: sum("sku_orders_count"), orders_count: sum("orders_count"),
      latest_available_date: dates.length === rows.length ? dates[0] : "Không rõ",
    } : rows[0].data;
  } catch (error) {
    if (dailyController !== controller || $("shopSelect").value !== shop || $("reportDate").value !== date || activeTab !== "day") return;
    throw error;
  } finally { clearTimeout(timeout); }
  if (activeTab !== "month") $("shopName").textContent = result.shop_name || "TikTok Shop";
  $("gmv").textContent = money(result.gmv, result.currency);
  $("itemsSold").textContent = numberFormat.format(result.items_sold || 0);
  $("skuOrders").textContent = numberFormat.format(result.sku_orders_count || 0);
  $("orders").textContent = numberFormat.format(result.orders_count || 0);
  $("latestDate").textContent = result.latest_available_date || "Không rõ";
  status.textContent = shop === ALL_SHOPS ? `Tổng cộng ngày ${date} · Đã tải đủ ${allShops.length}/${allShops.length} cửa hàng.` : `Đã cập nhật số liệu ngày ${date}.`;
  dailyShop = shop;
}

function resetTopProducts(message) {
  productsController?.abort();
  $("topProductsList").replaceChildren();
  $("topProductsStatus").classList.remove("error");
  $("topProductsStatus").textContent = message;
}

async function loadTopProducts() {
  const shop = $("shopSelect").value;
  const date = $("reportDate").value;
  resetTopProducts(shop === ALL_SHOPS ? "Chọn một cửa hàng cụ thể để xem Top 3 sản phẩm của cửa hàng đó." : "Đang tải sản phẩm bán chạy...");
  if (shop === ALL_SHOPS || activeTab !== "day") return;
  const controller = new AbortController();
  productsController = controller;
  const timeout = setTimeout(() => controller.abort(), 45000);
  const isCurrent = () => productsController === controller && activeTab === "day" && $("shopSelect").value === shop && $("reportDate").value === date;
  try {
    const query = new URLSearchParams({ shop, date });
    const response = await fetch(`${API_URL}/api/top-products?${query}`, { signal: controller.signal });
    const result = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(result.error || "Chưa tải được sản phẩm. Bấm Xem số liệu để thử lại.");
    if (result.shop_key !== shop || result.shop_name !== selectedShopName() || result.date !== date || !Array.isArray(result.products) || result.products.length > 3) throw new Error("Dữ liệu sản phẩm không đúng shop hoặc ngày đã chọn.");
    for (const product of result.products) {
      if (!/^\d+$/.test(product.id) || !Number.isSafeInteger(product.orders) || product.orders <= 0) throw new Error("Số đơn sản phẩm không hợp lệ.");
    }
    if (result.latest_available_date && result.latest_available_date < date) throw new Error(`TikTok chưa có số liệu sản phẩm ngày ${date}. Ngày mới nhất: ${result.latest_available_date}.`);
    const nodes = result.products.map((product, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span"); rank.className = "product-rank"; rank.textContent = String(index + 1);
      const info = document.createElement("div"); info.className = "product-info";
      const title = document.createElement("strong"); title.textContent = product.name || `Sản phẩm ${product.id}`;
      const id = document.createElement("small"); id.textContent = `Mã sản phẩm: ${product.id}`;
      const open = document.createElement("a");
      open.className = "product-open";
      open.href = `https://shop.tiktok.com/view/product/${encodeURIComponent(product.id)}?region=VN&locale=vi-VN`;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Mở sản phẩm";
      info.append(title, id, open);
      const count = document.createElement("strong"); count.className = "product-orders"; count.textContent = `${numberFormat.format(product.orders)} đơn`;
      item.append(rank, info, count); return item;
    });
    $("topProductsList").replaceChildren(...nodes);
    $("topProductsStatus").textContent = !nodes.length ? `Không có sản phẩm phát sinh đơn trong ngày ${date}.` : `Ngày ${date} · ${selectedShopName()}${result.names_unavailable ? " · TikTok chưa cung cấp tên một số sản phẩm với quyền hiện có; hiển thị mã để đối chiếu." : ""}`;
  } catch (error) {
    if (isCurrent()) showError($("topProductsStatus"), new Error(error.name === "AbortError" ? "Tải sản phẩm quá lâu. Bấm Xem số liệu để thử lại." : error.message));
  } finally { clearTimeout(timeout); }
}

async function loadRangeStats() {
  void loadRangeTopProducts();
  const status = $("totalStatus");
  resetRangeStats();
  status.classList.remove("error");
  status.textContent = "Đang tải số liệu trong khoảng ngày...";
  const shop = $("shopSelect").value;
  const startDate = $("totalStartDate").value;
  const endDate = $("totalEndDate").value;
  const response = await fetch(`${API_URL}/api/total?shop=${encodeURIComponent(shop)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`);
  const result = await response.json().catch(() => ({}));
  if ($("shopSelect").value !== shop) return;
  if (!response.ok) throw new Error(result.error || `Máy chủ trả lỗi HTTP ${response.status}`);
  if (activeTab !== "month") $("shopName").textContent = result.shop_name || "TikTok Shop";
  $("totalGmv").textContent = money(result.gmv, result.currency);
  $("totalItemsSold").textContent = numberFormat.format(result.items_sold || 0);
  $("totalSkuOrders").textContent = numberFormat.format(result.sku_orders_count || 0);
  $("totalOrders").textContent = numberFormat.format(result.orders_count || 0);
  $("totalRange").textContent = `${result.period_start} đến ${result.period_end}`;
  status.textContent = `Đã cập nhật số liệu từ ${result.period_start} đến ${result.period_end}.`;
  rangeShop = shop;
}

function resetRangeTopProducts(message) {
  rangeProductsController?.abort();
  $("rangeTopProductsList").replaceChildren();
  $("rangeTopProductsStatus").classList.remove("error");
  $("rangeTopProductsStatus").textContent = message;
}

async function loadRangeTopProducts() {
  const shop = $("shopSelect").value;
  const startDate = $("totalStartDate").value;
  const endDate = $("totalEndDate").value;
  resetRangeTopProducts("Đang tải sản phẩm bán chạy trong khoảng ngày...");
  const controller = new AbortController();
  rangeProductsController = controller;
  const timeout = setTimeout(() => controller.abort(), 45000);
  const isCurrent = () => rangeProductsController === controller && activeTab === "range" && $("shopSelect").value === shop && $("totalStartDate").value === startDate && $("totalEndDate").value === endDate;
  try {
    const query = new URLSearchParams({ shop, start_date: startDate, end_date: endDate });
    const response = await fetch(`${API_URL}/api/top-products?${query}`, { signal: controller.signal });
    const result = await response.json();
    if (!isCurrent()) return;
    if (!response.ok) throw new Error(result.error || "Chưa tải được sản phẩm trong khoảng ngày.");
    if (result.shop_key !== shop || result.shop_name !== selectedShopName() || result.period_start !== startDate || result.period_end !== endDate || !Array.isArray(result.products) || result.products.length > 10) throw new Error("Dữ liệu sản phẩm không đúng shop hoặc khoảng ngày đã chọn.");
    for (const product of result.products) {
      if (!/^\d+$/.test(product.id) || !Number.isSafeInteger(product.items_sold) || product.items_sold <= 0 || !Number.isSafeInteger(product.orders) || product.orders < 0) throw new Error("Số lượng sản phẩm không hợp lệ.");
    }
    if (result.latest_available_date && result.latest_available_date < endDate) throw new Error(`TikTok chưa có đủ số liệu sản phẩm đến ${endDate}. Ngày mới nhất: ${result.latest_available_date}.`);
    const nodes = result.products.map((product, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span"); rank.className = "product-rank"; rank.textContent = String(index + 1);
      const info = document.createElement("div"); info.className = "product-info";
      const title = document.createElement("strong"); title.textContent = product.name || `Sản phẩm ${product.id}`;
      const id = document.createElement("small"); id.textContent = `Mã sản phẩm: ${product.id}`;
      const open = document.createElement("a"); open.className = "product-open"; open.href = `https://shop.tiktok.com/view/product/${encodeURIComponent(product.id)}?region=VN&locale=vi-VN`; open.target = "_blank"; open.rel = "noopener noreferrer"; open.textContent = "Mở sản phẩm";
      info.append(title, id, open);
      const count = document.createElement("strong"); count.className = "product-orders"; count.textContent = `${numberFormat.format(product.items_sold)} SP · ${numberFormat.format(product.orders)} đơn`;
      item.append(rank, info, count); return item;
    });
    $("rangeTopProductsList").replaceChildren(...nodes);
    $("rangeTopProductsStatus").textContent = !nodes.length ? `Không có sản phẩm phát sinh bán từ ${startDate} đến ${endDate}.` : `${selectedShopName()} · ${startDate} đến ${endDate}${result.names_unavailable ? " · Một số sản phẩm chỉ có mã do quyền hiện tại." : ""}`;
  } catch (error) {
    if (isCurrent()) showError($("rangeTopProductsStatus"), new Error(error.name === "AbortError" ? "Tải sản phẩm quá lâu. Bấm Xem khoảng ngày để thử lại." : error.message));
  } finally { clearTimeout(timeout); }
}

async function loadShops() {
  const response = await fetch(`${API_URL}/api/shops`);
  const shops = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(shops) || shops.length === 0) throw new Error("Không tải được danh sách shop.");
  allShops = shops;
  $("shopSelect").replaceChildren(...shops.map((shop) => {
    const option = document.createElement("option");
    option.value = shop.key;
    option.textContent = shop.name;
    return option;
  }));
  const totalOption = document.createElement("option");
  totalOption.value = ALL_SHOPS;
  totalOption.textContent = "Tổng cộng";
  $("shopSelect").prepend(totalOption);
  $("shopSelect").value = shops[0].key;
}

async function switchTab(tab) {
  if (tab !== "day") { productsController?.abort(); dailyShop = ""; }
  if (tab !== "range") rangeProductsController?.abort();
  activeTab = tab;
  for (const name of ["day", "range", "month"]) {
    $(`${name}Tab`).classList.toggle("active", tab === name);
    $(`${name}Tab`).setAttribute("aria-selected", String(tab === name));
    $(`${name}Panel`).hidden = tab !== name;
  }
  $("shopSelect").closest(".shop-picker").hidden = tab === "month";
  const totalOption = $("shopSelect").querySelector(`option[value="${ALL_SHOPS}"]`);
  if (totalOption) { totalOption.hidden = tab !== "day"; totalOption.disabled = tab !== "day"; }
  if (tab === "range" && $("shopSelect").value === ALL_SHOPS) $("shopSelect").value = allShops[0]?.key || "";
  $("shopName").textContent = tab === "month" ? "Tất cả cửa hàng" : selectedShopName();
  const shop = $("shopSelect").value;
  try {
    if (tab === "day" && dailyShop !== shop) await loadStats();
    if (tab === "range" && rangeShop !== shop) await loadRangeStats();
    if (tab === "month" && monthlyLoaded !== $("reportMonth").value) await loadMonthlyStats();
  } catch (error) {
    showError($(tab === "day" ? "status" : tab === "range" ? "totalStatus" : "monthStatus"), error);
  }
}

function vietnamDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Vui lòng chọn tháng báo cáo.");
  const today = vietnamDate();
  const first = `${month}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = shiftDate(next.toISOString().slice(0, 10), -1);
  const earliest = shiftDate(today, -365);
  const yesterday = shiftDate(today, -1);
  const start = first < earliest ? earliest : first;
  const end = last > yesterday ? yesterday : last;
  if (start > end) throw new Error("Tháng này chưa có dữ liệu hoặc nằm ngoài 365 ngày gần nhất.");
  return { start, end, partial: start !== first || end !== last };
}

function toCents(amount) {
  const text = String(amount);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("GMV trả về không hợp lệ.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function svgElement(tag, attrs = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderMonthlyChart(rows, month) {
  const names = { "nha-trang-mart": "Nhã Trang", "duc-tuyet": "Đức Tuyết", "phuoc-tai-da-nang": "Phước Tài", "bao-huy": "Bảo Huy", "thong-tu": "Thông Tứ", "phuong-my": "Phương My", "tien-quy": "Tiến Quý", "hoang-long": "Hoàng Long" };
  const width = Math.max(760, rows.length * 100 + 70), height = 400;
  const left = 64, right = 64, top = 52, base = 312, plot = base - top;
  const amounts = rows.map(row => row.cents === null ? 0 : Number(row.cents) / 100);
  const max = Math.max(...amounts, 1);
  const maxOrders = Math.max(4, Math.ceil(Math.max(...rows.map(row => row.orders ?? 0)) / 4) * 4);
  const step = (width - left - right) / rows.length;
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": "monthChartTitle monthChartDesc" });
  svg.append(svgElement("title", { id: "monthChartTitle" }, `GMV và số đơn từng cửa hàng tháng ${month}`));
  svg.append(svgElement("desc", { id: "monthChartDesc" }, "Cột đỏ: GMV, trục trái triệu đồng. Đường xanh: số đơn, trục phải đơn hàng. " + rows.map(row => `${row.name}: ${row.cents === null ? "chưa tải được" : `${money(Number(row.cents) / 100, "VND")}, ${numberFormat.format(row.orders)} đơn`}`).join(". ")));
  svg.append(svgElement("text", { class: "gmv-series", x: left, y: 20, fill: "#756568", "font-size": 11 }, "GMV (triệu đồng)"));
  svg.append(svgElement("text", { class: "order-series", x: width - right, y: 20, "text-anchor": "end", fill: "#1265b5", "font-size": 11 }, "Đơn hàng (đơn)"));
  for (let tick = 0; tick <= 4; tick++) {
    const y = base - plot * tick / 4;
    svg.append(svgElement("line", { x1: left, x2: width - right, y1: y, y2: y, stroke: "#f0d9dc" }));
    svg.append(svgElement("text", { class: "gmv-series", x: left - 9, y: y + 4, "text-anchor": "end", fill: "#756568", "font-size": 11 }, numberFormat.format(Math.round(max * tick / 4 / 1000000 * 10) / 10)));
    svg.append(svgElement("text", { class: "order-series", x: width - right + 9, y: y + 4, fill: "#1265b5", "font-size": 11 }, numberFormat.format(maxOrders * tick / 4)));
  }
  svg.append(svgElement("line", { class: "gmv-series", x1: left, x2: left, y1: top, y2: base, stroke: "#f0d9dc" }));
  svg.append(svgElement("line", { class: "order-series", x1: width - right, x2: width - right, y1: top, y2: base, stroke: "#1265b5" }));
  rows.forEach((row, index) => {
    const x = left + step * (index + .5), barWidth = Math.min(54, step * .58);
    const barHeight = amounts[index] / max * plot;
    if (row.cents !== null) {
      const rect = svgElement("rect", { class: "gmv-series", x: x - barWidth / 2, y: base - Math.max(barHeight, 2), width: barWidth, height: Math.max(barHeight, 2), rx: 7, fill: "#f51b29" });
      rect.append(svgElement("title", {}, `${row.name}: ${money(amounts[index], "VND")}`));
      svg.append(rect);
      svg.append(svgElement("text", { class: "gmv-series gmv-value-label", x, y: base - barHeight - 24, "text-anchor": "middle", "font-size": 11, "font-weight": 800, fill: "#25191a", stroke: "white", "stroke-width": 3, "paint-order": "stroke" }, numberFormat.format(amounts[index])));
    } else {
      svg.append(svgElement("text", { x, y: base - 12, "text-anchor": "middle", "font-size": 11, fill: "#d80f1c" }, "Chưa tải được"));
    }
    const words = (names[row.key] || row.name).split(/\s+/);
    const lines = [];
    for (const word of words) {
      if (!lines.length || `${lines[lines.length - 1]} ${word}`.length > 15) lines.push(word);
      else lines[lines.length - 1] += ` ${word}`;
    }
    const label = svgElement("text", { x, y: base + 24, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#514144" });
    lines.slice(0, 4).forEach((line, i) => label.append(svgElement("tspan", { x, dy: i ? 16 : 0 }, line)));
    svg.append(label);
  });
  // A missing shop breaks the line: it must never look like zero orders.
  let segment = [];
  const drawSegment = () => {
    if (segment.length > 1) svg.append(svgElement("polyline", { class: "order-series", points: segment.join(" "), fill: "none", stroke: "#1265b5", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    segment = [];
  };
  rows.forEach((row, index) => {
    if (row.orders === null) { drawSegment(); return; }
    segment.push(`${left + step * (index + .5)},${base - row.orders / maxOrders * plot}`);
  });
  drawSegment();
  rows.forEach((row, index) => {
    if (row.orders === null) return;
    const x = left + step * (index + .5), y = base - row.orders / maxOrders * plot;
    const dot = svgElement("circle", { class: "order-series", cx: x, cy: y, r: 5, fill: "#1265b5", stroke: "white", "stroke-width": 2 });
    dot.append(svgElement("title", {}, `${row.name}: ${numberFormat.format(row.orders)} đơn hàng`));
    svg.append(dot);
    svg.append(svgElement("text", { class: "order-series order-value-label", x, y: y + (y > base - 24 ? -7 : 21), "text-anchor": "middle", "font-size": 11, "font-weight": 800, fill: "#1265b5", stroke: "white", "stroke-width": 4, "paint-order": "stroke" }, `${numberFormat.format(row.orders)} đơn`));
  });
  $("monthChart").replaceChildren(svg);
}

async function loadMonthlyStats() {
  const month = $("reportMonth").value;
  const { start, end, partial } = monthRange(month);
  if (!allShops.length) throw new Error("Danh sách cửa hàng chưa tải xong, vui lòng thử lại.");
  monthController?.abort();
  const controller = new AbortController();
  monthController = controller;
  const timeout = setTimeout(() => controller.abort(), 45000);
  monthlyLoaded = "";
  $("monthStatus").classList.remove("error");
  $("monthStatus").textContent = `Đang tải doanh số ${allShops.length} cửa hàng...`;
  $("monthTotal").textContent = "—";
  $("monthChart").replaceChildren();
  $("monthCoverage").textContent = "Đang tải...";
  $("monthPeriod").textContent = `${start} đến ${end}`;
  $("monthNote").textContent = partial ? "Tháng chưa đủ dữ liệu: tính trong khoảng ngày hiển thị, không gồm hôm nay." : "Doanh số được tính theo GMV TikTok Shop trong toàn bộ tháng đã chọn.";
  try {
    const rows = await Promise.all(allShops.map(async shop => {
      try {
        const query = new URLSearchParams({ shop: shop.key, start_date: start, end_date: end });
        const response = await fetch(`${API_URL}/api/total?${query}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Không tải được số liệu.");
        if (data.shop_name !== shop.name) throw new Error("Máy chủ trả số liệu của cửa hàng khác; vui lòng tải lại.");
        if (data.currency !== "VND") throw new Error("Không thể cộng GMV khác đơn vị tiền tệ.");
        if (!Number.isSafeInteger(data.orders_count) || data.orders_count < 0) throw new Error("Số đơn trả về không hợp lệ.");
        return { ...shop, cents: toCents(data.gmv), orders: data.orders_count };
      } catch (error) { return { ...shop, cents: null, orders: null, error: error.message }; }
    }));
    if (monthController !== controller || $("reportMonth").value !== month) return;
    const available = rows.filter(row => row.cents !== null);
    const failed = rows.filter(row => row.cents === null);
    const total = available.reduce((sum, row) => sum + row.cents, 0n);
    $("monthTotal").textContent = available.length ? money(Number(total) / 100, "VND") : "—";
    $("monthTotalLabel").textContent = failed.length ? "GMV các cửa hàng đã tải được (chưa đủ tổng)" : "Tổng GMV tất cả cửa hàng";
    $("monthCoverage").textContent = `${available.length}/${rows.length} cửa hàng`;
    renderMonthlyChart(rows, month);
    if (failed.length) {
      showError($("monthStatus"), new Error(`Chưa tải được: ${failed.map(row => row.name).join(", ")}. Tổng đang thiếu các cửa hàng này; bấm “Xem tháng” để thử lại.`));
    } else {
      $("monthStatus").textContent = `Đã cập nhật GMV và số đơn tháng ${month.slice(5)}/${month.slice(0, 4)} của ${rows.length} cửa hàng.`;
      monthlyLoaded = month;
    }
  } finally { clearTimeout(timeout); }
}

function updateChartSeries() {
  $("monthChart").classList.toggle("show-gmv-series", $("showGmvSeries").checked);
  $("monthChart").classList.toggle("show-order-series", $("showOrderSeries").checked);
  $("chartSeriesEmpty").hidden = $("showGmvSeries").checked || $("showOrderSeries").checked;
}
$("showGmvSeries").addEventListener("change", updateChartSeries);
$("showOrderSeries").addEventListener("change", updateChartSeries);
updateChartSeries();

$("reportDate").value = daysAgoISO(1);
$("totalStartDate").value = daysAgoISO(30);
$("totalEndDate").value = daysAgoISO(1);
$("reportMonth").value = vietnamDate().slice(0, 7);
$("reportMonth").max = vietnamDate().slice(0, 7);
$("reportMonth").min = shiftDate(vietnamDate(), -365).slice(0, 7);
$("dayTab").addEventListener("click", () => switchTab("day"));
$("rangeTab").addEventListener("click", () => switchTab("range"));
$("monthTab").addEventListener("click", () => switchTab("month"));
$("reportMonth").addEventListener("change", () => {
  monthController?.abort();
  if (activeTab === "month") loadMonthlyStats().catch(error => showError($("monthStatus"), error));
});
$("monthFilterForm").addEventListener("submit", event => {
  event.preventDefault();
  loadMonthlyStats().catch(error => showError($("monthStatus"), error));
});
$("shopSelect").addEventListener("change", () => { dailyShop = ""; rangeShop = ""; switchTab(activeTab); });
$("reportDate").addEventListener("change", () => { dailyShop = ""; resetTopProducts("Bấm Xem số liệu để tải sản phẩm của ngày đã chọn."); });
$("totalStartDate").addEventListener("change", () => { rangeShop = ""; resetRangeTopProducts("Bấm Xem khoảng ngày để tải sản phẩm."); });
$("totalEndDate").addEventListener("change", () => { rangeShop = ""; resetRangeTopProducts("Bấm Xem khoảng ngày để tải sản phẩm."); });
$("filterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await loadStats(); } catch (error) { showError($("status"), error); }
});
$("totalFilterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await loadRangeStats(); } catch (error) { showError($("totalStatus"), error); }
});
loadShops().then(() => loadStats()).catch((error) => showError($("status"), error));
