(() => {
  const fetch = window.fetch.bind(window);
  const origin = "https://tiktok-shop-dashboard-api.nhatrang-mart-api.workers.dev";
  if (location.origin !== origin && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace(`${origin}/`);
    return;
  }
  const login = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboardPanel");
  const status = document.getElementById("loginStatus");
  let loaded = false;
  let expiryTimer;
  function lock(message = "") {
    clearTimeout(expiryTimer);
    dashboard.hidden = true;
    login.hidden = false;
    status.textContent = message;
    document.getElementById("loginPassword").value = "";
  }
  window.dashboardFetch = async (url, options = {}) => {
    const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      lock("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      // Discard every previous shop/date request and all old DOM state.
      if (loaded) location.reload();
    }
    return response;
  };
  function unlock(session) {
    login.hidden = true;
    dashboard.hidden = false;
    document.getElementById("loginPassword").value = "";
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => location.reload(), Math.max(0, session.expires - Date.now()));
    if (!loaded) {
      loaded = true;
      const script = document.createElement("script");
      script.src = "app.js?v=product-links-1";
      script.onerror = () => lock("Không tải được giao diện. Vui lòng tải lại trang.");
      document.body.append(script);
    }
  }
  document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("loginButton");
    button.disabled = true;
    status.textContent = "Đang xác thực…";
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: document.getElementById("loginUsername").value.trim(), password: document.getElementById("loginPassword").value }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Không đăng nhập được.");
      if (loaded) { location.reload(); return; }
      unlock(data);
    } catch (error) { lock(error.message || "Không kết nối được máy chủ."); }
    finally { button.disabled = false; }
  });
  document.getElementById("logoutButton").addEventListener("click", async () => {
    lock("Đang đăng xuất…");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw Error();
      location.reload();
    } catch { status.textContent = "Chưa đăng xuất được khỏi máy chủ. Vui lòng kết nối mạng và tải lại trang để thử lại."; }
  });
  fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
    .then(async response => {
      if (response.ok) unlock(await response.json());
      else lock(response.status === 401 ? "" : "Máy chủ chưa sẵn sàng. Vui lòng thử lại.");
    }).catch(() => lock("Không kết nối được máy chủ. Vui lòng thử lại."));
})();
