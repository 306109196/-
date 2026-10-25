import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = Number.parseInt(process.env.PORT || "4173", 10);
const HOST = process.env.HOST || (IS_PRODUCTION ? "0.0.0.0" : "127.0.0.1");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, "storage"));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, "archive.sqlite"));
const SESSION_DAYS = clamp(Number.parseInt(process.env.SESSION_DAYS || "30", 10), 1, 365);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (IS_PRODUCTION ? "" : "dev-admin-token");
const PURCHASE_WEBHOOK_SECRET =
  process.env.PURCHASE_WEBHOOK_SECRET || (IS_PRODUCTION ? "" : "dev-purchase-secret");
const PHONE_HASH_SECRET =
  process.env.PHONE_HASH_SECRET || (IS_PRODUCTION ? "" : "dev-phone-hash-secret-change-me");
const DELIVERY_WEBHOOK_URL = process.env.DELIVERY_WEBHOOK_URL || "";
const DELIVERY_WEBHOOK_SECRET = process.env.DELIVERY_WEBHOOK_SECRET || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1" || IS_PRODUCTION;

if (IS_PRODUCTION) {
  const missing = [
    ["ADMIN_TOKEN", ADMIN_TOKEN],
    ["PURCHASE_WEBHOOK_SECRET", PURCHASE_WEBHOOK_SECRET],
    ["PHONE_HASH_SECRET", PHONE_HASH_SECRET],
  ]
    .filter(([, value]) => !value || value.length < 24)
    .map(([name]) => name);
  if (missing.length) {
    console.error(`Missing or too-short production secrets: ${missing.join(", ")}`);
    process.exit(1);
  }
}

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    phone_hash TEXT,
    phone_mask TEXT,
    order_id TEXT UNIQUE,
    note TEXT,
    created_at TEXT NOT NULL,
    redeemed_at TEXT,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    code_id INTEGER NOT NULL,
    phone_hash TEXT NOT NULL,
    phone_mask TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (code_id) REFERENCES access_codes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    order_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    phone_hash TEXT NOT NULL,
    phone_mask TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_access_codes_phone_hash ON access_codes(phone_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_access_codes_expires_at ON access_codes(expires_at);
`);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rateBuckets = new Map();

const publicFiles = {
  "/gate.css": ["gate.css", "text/css; charset=utf-8"],
  "/gate.js": ["gate.js", "text/javascript; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.html": ["admin.html", "text/html; charset=utf-8"],
  "/admin.css": ["admin.css", "text/css; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"],
};

const protectedFiles = {
  "/app.html": ["app.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/data.js": ["data.js", "text/javascript; charset=utf-8"],
  "/questions.js": ["questions.js", "text/javascript; charset=utf-8"],
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/[\s\-()]/g, "");
  if (phone.startsWith("+86")) phone = phone.slice(3);
  if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  return /^1[3-9]\d{9}$/.test(phone) ? phone : null;
}

function maskPhone(phone) {
  return phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null;
}

function hashPhone(phone) {
  return crypto.createHmac("sha256", PHONE_HASH_SECRET).update(phone).digest("hex");
}

function normalizeAccessCode(value) {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!/^ZJ[A-HJ-NP-Z2-9]{8}$/.test(compact)) return null;
  return `${compact.slice(0, 2)}-${compact.slice(2, 6)}-${compact.slice(6)}`;
}

function generateAccessCode() {
  const bytes = crypto.randomBytes(8);
  let body = "";
  for (let index = 0; index < 8; index += 1) {
    body += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return `ZJ-${body.slice(0, 4)}-${body.slice(4)}`;
}

function generateUniqueCode() {
  const exists = db.prepare("SELECT 1 FROM access_codes WHERE code = ? LIMIT 1");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateAccessCode();
    if (!exists.get(code)) return code;
  }
  throw new Error("Unable to generate a unique access code");
}

function createAccessCode({ phone, note = "", expiresAt, orderId = null }) {
  const code = generateUniqueCode();
  const phoneHash = phone ? hashPhone(phone) : null;
  const phoneMask = phone ? maskPhone(phone) : null;
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO access_codes
      (code, phone_hash, phone_mask, order_id, note, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, phoneHash, phoneMask, orderId, String(note || "").slice(0, 200), createdAt, expiresAt);
  return code;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function sessionCookie(token, maxAgeSeconds) {
  return [
    `zhujian_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    COOKIE_SECURE ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie() {
  return [
    "zhujian_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    COOKIE_SECURE ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

function allowRate(req, bucket, limit, windowMs) {
  const key = `${bucket}:${getClientIp(req)}`;
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (timestamps.length >= limit) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  if (rateBuckets.size > 5000) {
    for (const [storedKey, values] of rateBuckets) {
      if (!values.some((time) => now - time < windowMs)) rateBuckets.delete(storedKey);
    }
  }
  return true;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(COOKIE_SECURE ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    ...extra,
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      ...extraHeaders,
    }),
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    ...securityHeaders({
      "Content-Type": contentType,
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    }),
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({ Location: location, "Cache-Control": "no-store" }));
  res.end();
}

async function serveFile(res, relativePath, contentType) {
  try {
    const body = await readFile(path.join(APP_DIR, relativePath));
    res.writeHead(200, {
      ...securityHeaders({
        "Content-Type": contentType,
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      }),
    });
    res.end(body);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

function readJson(req, maxBytes = 12_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > maxBytes) {
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        const invalid = new Error("Invalid JSON");
        invalid.statusCode = 400;
        reject(invalid);
      }
    });
    req.on("error", reject);
  });
}

function validSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

function adminAuthorized(req) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice(7).trim(), ADMIN_TOKEN);
}

function purchaseAuthorized(req) {
  return safeEqual(String(req.headers["x-webhook-secret"] || ""), PURCHASE_WEBHOOK_SECRET);
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).zhujian_session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db
    .prepare(`
      SELECT
        s.token_hash,
        s.code_id,
        s.phone_hash,
        s.phone_mask,
        s.expires_at AS session_expires_at,
        c.code,
        c.expires_at AS code_expires_at,
        c.revoked
      FROM sessions s
      JOIN access_codes c ON c.id = s.code_id
      WHERE s.token_hash = ?
      LIMIT 1
    `)
    .get(tokenHash);
  if (!session) return null;
  const now = Date.now();
  if (
    new Date(session.session_expires_at).getTime() <= now ||
    new Date(session.code_expires_at).getTime() <= now ||
    Number(session.revoked) === 1
  ) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return session;
}

function codeStatus(row) {
  if (Number(row.revoked) === 1) return "revoked";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  if (row.redeemed_at) return "redeemed";
  if (row.phone_hash) return "reserved";
  return "available";
}

function adminStats() {
  const rows = db.prepare("SELECT * FROM access_codes").all();
  const counts = { total: rows.length, redeemed: 0, reserved: 0, available: 0, expired: 0, revoked: 0 };
  rows.forEach((row) => {
    counts[codeStatus(row)] += 1;
  });
  return { ...counts, deliveryConfigured: Boolean(DELIVERY_WEBHOOK_URL) };
}

async function forwardCode({ phone, code, orderId, existing = false }) {
  if (!DELIVERY_WEBHOOK_URL) return { configured: false, forwarded: false };
  try {
    const response = await fetch(DELIVERY_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(DELIVERY_WEBHOOK_SECRET ? { "x-delivery-secret": DELIVERY_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({ phone, code, orderId, existing }),
      signal: AbortSignal.timeout(6000),
    });
    return { configured: true, forwarded: response.ok };
  } catch (error) {
    return { configured: true, forwarded: false };
  }
}

async function handleRedeem(req, res) {
  if (!validSameOrigin(req)) {
    sendJson(res, 403, { message: "请求来源不被允许。" });
    return;
  }
  if (!allowRate(req, "redeem", 10, 15 * 60 * 1000)) {
    res.setHeader("Retry-After", "900");
    sendJson(res, 429, { message: "尝试次数过多，请 15 分钟后再试。" });
    return;
  }

  const body = await readJson(req);
  const phone = normalizePhone(body.phone);
  const accessCode = normalizeAccessCode(body.accessCode);
  if (!phone || !accessCode) {
    sendJson(res, 400, { message: "手机号或验证码格式不正确。" });
    return;
  }

  const phoneHash = hashPhone(phone);
  const phoneMask = maskPhone(phone);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const createdAt = nowIso();
  let sessionExpiry;
  let maxAgeSeconds;

  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM access_codes WHERE code = ? LIMIT 1").get(accessCode);
    if (!row || Number(row.revoked) === 1 || new Date(row.expires_at).getTime() <= Date.now()) {
      db.exec("ROLLBACK");
      sendJson(res, 400, { message: "验证码无效、已过期或已作废。" });
      return;
    }
    if (row.phone_hash && !safeEqual(row.phone_hash, phoneHash)) {
      db.exec("ROLLBACK");
      sendJson(res, 409, { message: "该验证码已绑定其他手机号，无法使用。" });
      return;
    }

    if (!row.phone_hash) {
      db.prepare("UPDATE access_codes SET phone_hash = ?, phone_mask = ? WHERE id = ?").run(
        phoneHash,
        phoneMask,
        row.id,
      );
    }
    db.prepare("UPDATE access_codes SET redeemed_at = COALESCE(redeemed_at, ?) WHERE id = ?").run(
      createdAt,
      row.id,
    );

    const requestedExpiry = addDays(new Date(createdAt), SESSION_DAYS).getTime();
    const codeExpiry = new Date(row.expires_at).getTime();
    sessionExpiry = new Date(Math.min(requestedExpiry, codeExpiry));
    maxAgeSeconds = Math.max(1, Math.floor((sessionExpiry.getTime() - Date.now()) / 1000));

    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
    db.prepare(`
      INSERT INTO sessions (token_hash, code_id, phone_hash, phone_mask, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, row.id, phoneHash, phoneMask, createdAt, sessionExpiry.toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      // Transaction may already be closed.
    }
    throw error;
  }

  sendJson(
    res,
    200,
    { ok: true, redirect: "/app.html" },
    { "Set-Cookie": sessionCookie(token, maxAgeSeconds) },
  );
}

async function handleAdminCreate(req, res) {
  if (!adminAuthorized(req)) {
    sendJson(res, 401, { message: "管理员令牌无效。" });
    return;
  }
  if (!validSameOrigin(req)) {
    sendJson(res, 403, { message: "请求来源不被允许。" });
    return;
  }
  if (!allowRate(req, "admin-create", 60, 60 * 1000)) {
    sendJson(res, 429, { message: "操作过于频繁，请稍后再试。" });
    return;
  }

  const body = await readJson(req);
  const count = clamp(Number.parseInt(body.count || 1, 10), 1, 100);
  const expiresInDays = clamp(Number.parseInt(body.expiresInDays || 365, 10), 1, 3650);
  const note = String(body.note || "").trim().slice(0, 200);
  const rawPhone = String(body.phone || "").replace(/\D/g, "");
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) {
    sendJson(res, 400, { message: "绑定手机号格式不正确。" });
    return;
  }
  if (phone && count !== 1) {
    sendJson(res, 400, { message: "指定手机号时，一次只能生成一个验证码。" });
    return;
  }

  const expiresAt = addDays(new Date(), expiresInDays).toISOString();
  const codes = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < count; index += 1) {
      codes.push(createAccessCode({ phone, note, expiresAt }));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  sendJson(res, 201, { ok: true, codes });
}

function handleAdminList(url, req, res) {
  if (!adminAuthorized(req)) {
    sendJson(res, 401, { message: "管理员令牌无效。" });
    return;
  }
  const limit = clamp(Number.parseInt(url.searchParams.get("limit") || "100", 10), 1, 500);
  const rows = db.prepare("SELECT * FROM access_codes ORDER BY id DESC LIMIT ?").all(limit);
  sendJson(res, 200, {
    codes: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: codeStatus(row),
      phoneMask: row.phone_mask,
      orderId: row.order_id,
      note: row.note,
      createdAt: row.created_at,
      redeemedAt: row.redeemed_at,
      expiresAt: row.expires_at,
    })),
  });
}

function handleAdminStats(req, res) {
  if (!adminAuthorized(req)) {
    sendJson(res, 401, { message: "管理员令牌无效。" });
    return;
  }
  sendJson(res, 200, adminStats());
}

function handleAdminRevoke(codeId, req, res) {
  if (!adminAuthorized(req)) {
    sendJson(res, 401, { message: "管理员令牌无效。" });
    return;
  }
  if (!validSameOrigin(req)) {
    sendJson(res, 403, { message: "请求来源不被允许。" });
    return;
  }
  const row = db.prepare("SELECT id FROM access_codes WHERE id = ?").get(codeId);
  if (!row) {
    sendJson(res, 404, { message: "验证码不存在。" });
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE access_codes SET revoked = 1 WHERE id = ?").run(codeId);
    db.prepare("DELETE FROM sessions WHERE code_id = ?").run(codeId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  sendJson(res, 200, { ok: true });
}

async function handlePurchaseComplete(req, res) {
  if (!purchaseAuthorized(req)) {
    sendJson(res, 401, { message: "购买回调密钥无效。" });
    return;
  }
  if (!allowRate(req, "purchase", 120, 60 * 1000)) {
    sendJson(res, 429, { message: "回调请求过于频繁。" });
    return;
  }

  const body = await readJson(req);
  const orderId = String(body.orderId || "").trim();
  const phone = normalizePhone(body.phone);
  if (!/^[A-Za-z0-9._:-]{3,100}$/.test(orderId)) {
    sendJson(res, 400, { message: "订单号格式不正确。" });
    return;
  }
  if (!phone) {
    sendJson(res, 400, { message: "手机号格式不正确。" });
    return;
  }

  const phoneHash = hashPhone(phone);
  const phoneMask = maskPhone(phone);
  let code;
  let existing = false;

  db.exec("BEGIN IMMEDIATE");
  try {
    const order = db.prepare("SELECT * FROM purchase_orders WHERE order_id = ? LIMIT 1").get(orderId);
    if (order) {
      if (!safeEqual(order.phone_hash, phoneHash)) {
        db.exec("ROLLBACK");
        sendJson(res, 409, { message: "该订单号已绑定其他手机号。" });
        return;
      }
      code = order.code;
      existing = true;
    } else {
      code = createAccessCode({
        phone,
        note: `购买订单：${orderId}`,
        expiresAt: addDays(new Date(), 365).toISOString(),
        orderId,
      });
      db.prepare(`
        INSERT INTO purchase_orders (order_id, code, phone_hash, phone_mask, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orderId, code, phoneHash, phoneMask, nowIso());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const delivery = await forwardCode({ phone, code, orderId, existing });
  sendJson(res, existing ? 200 : 201, {
    ok: true,
    orderId,
    code,
    existing,
    delivery,
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "zhujian-access" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/status") {
    const session = getSession(req);
    sendJson(res, 200, {
      authorized: Boolean(session),
      phoneMask: session?.phone_mask || null,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/redeem") {
    await handleRedeem(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).zhujian_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/stats") {
    handleAdminStats(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/codes") {
    handleAdminList(url, req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/codes") {
    await handleAdminCreate(req, res);
    return;
  }

  const revokeMatch = pathname.match(/^\/api\/admin\/codes\/(\d+)\/revoke$/);
  if (req.method === "POST" && revokeMatch) {
    handleAdminRevoke(Number(revokeMatch[1]), req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/purchase/complete") {
    await handlePurchaseComplete(req, res);
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    if (getSession(req)) {
      redirect(res, "/app.html");
      return;
    }
    await serveFile(res, "index.html", "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && publicFiles[pathname]) {
    const [file, type] = publicFiles[pathname];
    await serveFile(res, file, type);
    return;
  }

  if (req.method === "GET" && protectedFiles[pathname]) {
    if (!getSession(req)) {
      if (pathname === "/app.html") {
        redirect(res, "/?reason=login");
      } else {
        sendText(res, 401, "Unauthorized");
      }
      return;
    }
    const [file, type] = protectedFiles[pathname];
    await serveFile(res, file, type);
    return;
  }

  if (req.method === "GET" && pathname === "/robots.txt") {
    sendText(res, 200, "User-agent: *\nDisallow: /app.html\nDisallow: /admin\n");
    return;
  }

  if (req.method === "GET" && pathname === "/favicon.ico") {
    res.writeHead(204, securityHeaders({ "Cache-Control": "public, max-age=86400" }));
    res.end();
    return;
  }

  sendJson(res, 404, { message: "Not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error("Request failed:", error.message);
    if (res.headersSent) {
      res.end();
      return;
    }
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      message: statusCode >= 500 ? "服务器暂时无法处理请求。" : error.message,
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`照见 access server: http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  if (!IS_PRODUCTION) {
    console.log("Development secrets are active. Do not deploy without environment variables.");
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
