const loginSection = document.querySelector("#admin-login");
const dashboard = document.querySelector("#admin-dashboard");
const loginForm = document.querySelector("#login-form");
const tokenInput = document.querySelector("#admin-token");
const loginMessage = document.querySelector("#login-message");
const issueForm = document.querySelector("#issue-form");
const issueMessage = document.querySelector("#issue-message");
const issuedCodes = document.querySelector("#issued-codes");
const issuedCodeList = document.querySelector("#issued-code-list");
const codesTableBody = document.querySelector("#codes-table-body");
const listMessage = document.querySelector("#list-message");
const toast = document.querySelector("#admin-toast");

let adminToken = sessionStorage.getItem("zhujian_admin_token") || "";
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function showLogin(message = "") {
  adminToken = "";
  sessionStorage.removeItem("zhujian_admin_token");
  dashboard.hidden = true;
  loginSection.hidden = false;
  loginMessage.textContent = message;
  tokenInput.focus();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${adminToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin("管理员令牌无效或已失效。");
    throw new Error(data.message || "Unauthorized");
  }
  if (!response.ok) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const statusLabels = {
  available: "待使用",
  reserved: "已预留",
  redeemed: "已兑换",
  expired: "已过期",
  revoked: "已作废",
};

function renderCodes(codes) {
  codesTableBody.replaceChildren();
  if (!codes.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "还没有验证码记录。";
    row.appendChild(cell);
    codesTableBody.appendChild(row);
    return;
  }

  codes.forEach((code) => {
    const row = document.createElement("tr");
    const codeCell = document.createElement("td");
    codeCell.textContent = code.code;

    const statusCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${code.status}`;
    pill.textContent = statusLabels[code.status] || code.status;
    statusCell.appendChild(pill);

    const phoneCell = document.createElement("td");
    phoneCell.textContent = code.phoneMask || "首次兑换时绑定";

    const orderCell = document.createElement("td");
    orderCell.textContent = code.orderId || "—";

    const createdCell = document.createElement("td");
    createdCell.textContent = formatDate(code.createdAt);

    const redeemedCell = document.createElement("td");
    redeemedCell.textContent = formatDate(code.redeemedAt);

    const actionCell = document.createElement("td");
    if (["available", "reserved"].includes(code.status)) {
      const revokeButton = document.createElement("button");
      revokeButton.type = "button";
      revokeButton.className = "revoke-button";
      revokeButton.textContent = "作废";
      revokeButton.addEventListener("click", () => revokeCode(code));
      actionCell.appendChild(revokeButton);
    } else {
      actionCell.textContent = "—";
    }

    row.append(codeCell, statusCell, phoneCell, orderCell, createdCell, redeemedCell, actionCell);
    codesTableBody.appendChild(row);
  });
}

async function loadDashboard(showMessage = false) {
  try {
    const [stats, list] = await Promise.all([api("/api/admin/stats"), api("/api/admin/codes?limit=200")]);
    loginSection.hidden = true;
    dashboard.hidden = false;
    sessionStorage.setItem("zhujian_admin_token", adminToken);

    document.querySelector("#stat-total").textContent = stats.total;
    document.querySelector("#stat-redeemed").textContent = stats.redeemed;
    document.querySelector("#stat-reserved").textContent = stats.reserved;
    document.querySelector("#stat-available").textContent = stats.available;
    document.querySelector("#automation-state").textContent = stats.deliveryConfigured
      ? "自动转发已配置。购买接口返回验证码后，系统会继续推送到短信或消息服务。"
      : "自动转发尚未配置。购买接口仍会返回验证码，但需要由支付平台或自动化工具负责发送。";
    renderCodes(list.codes);
    if (showMessage) showToast("数据已刷新");
  } catch (error) {
    if (adminToken) loginMessage.textContent = error.message;
  }
}

async function revokeCode(code) {
  if (!window.confirm(`确认作废验证码 ${code.code}？作废后对应登录会话也会失效。`)) return;
  try {
    await api(`/api/admin/codes/${code.id}/revoke`, { method: "POST" });
    showToast("验证码已作废");
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = tokenInput.value.trim();
  if (!adminToken) return;
  loginMessage.textContent = "正在验证管理员令牌...";
  await loadDashboard();
  if (!dashboard.hidden) loginMessage.textContent = "";
});

issueForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  issueMessage.textContent = "";
  const count = Number(document.querySelector("#issue-count").value);
  const phone = document.querySelector("#issue-phone").value.replace(/\D/g, "");
  const expiresInDays = Number(document.querySelector("#issue-expiry").value);
  const note = document.querySelector("#issue-note").value.trim();

  try {
    const result = await api("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({ count, phone, expiresInDays, note }),
    });
    issuedCodes.hidden = false;
    issuedCodeList.textContent = result.codes.join("\n");
    issueMessage.textContent = `已生成 ${result.codes.length} 个验证码。`;
    document.querySelector("#issue-count").value = "1";
    document.querySelector("#issue-phone").value = "";
    document.querySelector("#issue-note").value = "";
    await loadDashboard();
  } catch (error) {
    issueMessage.textContent = error.message;
  }
});

document.querySelector("#copy-codes").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(issuedCodeList.textContent);
    showToast("验证码已复制");
  } catch (error) {
    showToast("复制失败，请手动选择验证码");
  }
});

document.querySelector("#refresh-button").addEventListener("click", () => loadDashboard(true));
document.querySelector("#logout-button").addEventListener("click", () => showLogin("已退出管理后台。"));

if (adminToken) {
  loadDashboard();
} else {
  showLogin();
}
