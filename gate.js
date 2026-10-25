const form = document.querySelector("#access-form");
const phoneInput = document.querySelector("#phone");
const codeInput = document.querySelector("#access-code");
const submitButton = document.querySelector("#access-submit");
const statusElement = document.querySelector("#form-status");

function setStatus(message, type = "error") {
  statusElement.textContent = message;
  statusElement.classList.toggle("is-success", type === "success");
}

function normalizePhone(value) {
  return value.replace(/\D/g, "").replace(/^86(?=1\d{10}$)/, "");
}

function formatCode(value) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (compact.length <= 2) return compact;
  if (compact.length <= 6) return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  return `${compact.slice(0, 2)}-${compact.slice(2, 6)}-${compact.slice(6)}`;
}

phoneInput.addEventListener("input", () => {
  phoneInput.value = normalizePhone(phoneInput.value).slice(0, 11);
});

codeInput.addEventListener("input", () => {
  codeInput.value = formatCode(codeInput.value);
});

async function checkExistingSession() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reason") === "expired") {
    setStatus("登录状态已过期，请使用原手机号和验证码重新进入。");
  }

  try {
    const response = await fetch("/api/auth/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data.authorized) {
      setStatus("已识别到有效登录状态，正在进入档案...", "success");
      window.setTimeout(() => window.location.replace("/app.html"), 350);
    }
  } catch (error) {
    // The form remains available if the status check cannot reach the server.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const phone = normalizePhone(phoneInput.value);
  const accessCode = formatCode(codeInput.value);
  phoneInput.value = phone;
  codeInput.value = accessCode;

  if (!/^1[3-9]\d{9}$/.test(phone)) {
    setStatus("请输入正确的 11 位手机号码。");
    phoneInput.focus();
    return;
  }
  if (!/^ZJ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(accessCode)) {
    setStatus("验证码格式应为 ZJ-XXXX-XXXX。");
    codeInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "正在验证...";

  try {
    const response = await fetch("/api/auth/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ phone, accessCode }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(data.message || "验证未通过，请检查手机号和验证码。");
      return;
    }

    setStatus("验证成功，正在打开你的历史档案...", "success");
    window.setTimeout(() => window.location.replace("/app.html"), 450);
  } catch (error) {
    setStatus("网络连接失败，请稍后重试。");
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "验证并进入";
  }
});

checkExistingSession();
