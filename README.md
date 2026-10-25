# 照见 · 中外历史人物人格档案

一个带验证码访问控制的 Node.js 人格测试网站。包含 120 道原创情境题库、每次随机抽取 24 道、四维评分、44 位中外历史人物、两步映射偏好、结果档案页和高清分享卡导出。

## 核心流程

1. 用户输入购买后获得的验证码和预留手机号。
2. 服务端验证验证码，并将其与手机号哈希绑定。
3. 验证通过后签发 `HttpOnly` 会话 Cookie。
4. 用户选择中国/世界人物，以及男性优先、女性优先或不限性别。
5. 从 120 道原创题库中随机抽取 24 道，选项顺序也会随机变化。
6. 查看四维人格坐标、人物匹配、性格解读和相近人物。
7. 保存 1080 × 1440 分享档案卡，或复制分享文案。

## 安全机制

- 测试页面、题目数据和脚本全部由服务端会话保护。
- 未登录用户无法直接访问 `app.html`、`data.js`、`questions.js` 或 `app.js`。
- 验证码首次兑换时绑定手机号，后续只能由同一手机号使用。
- 数据库只保存手机号的 HMAC 哈希与掩码，不保存明文手机号。
- 会话 token 仅通过 `HttpOnly`、`SameSite=Lax` Cookie 传递，数据库中只保存 token 哈希。
- 登录接口有 IP 限流，管理员令牌与购买回调密钥均使用常量时间比较。
- 撤销验证码会立即删除对应登录会话。
- 购买回调按订单号幂等，同一订单不会重复发码。

## 运行要求

- Node.js 24 或更高版本
- 可使用持久化磁盘的 Node.js 服务器
- 生产环境必须启用 HTTPS

不能直接部署到只提供静态文件的托管服务，因为访问控制和 SQLite 数据库都需要服务端运行。

正式上线所需的 Docker、Render 蓝图、持久化磁盘和 HTTPS 配置已包含在项目中，详细步骤见 [DEPLOY.md](./DEPLOY.md)。

## 本地运行

```powershell
node server.mjs
```

本地地址：

- 用户入口：`http://127.0.0.1:4173/`
- 管理后台：`http://127.0.0.1:4173/admin`
- 本地开发管理员令牌：`dev-admin-token`

本地开发会自动使用开发用密钥，不能直接用于正式上线。

## 生产环境变量

复制 `.env.example` 中的配置并在部署平台设置环境变量：

```powershell
$env:NODE_ENV="production"
$env:HOST="0.0.0.0"
$env:PORT="4173"
$env:DATA_DIR="./storage"
$env:ADMIN_TOKEN="至少32位的随机管理员令牌"
$env:PURCHASE_WEBHOOK_SECRET="至少32位的购买回调密钥"
$env:PHONE_HASH_SECRET="至少32位且与上面不同的手机号哈希密钥"
$env:COOKIE_SECURE="1"
$env:TRUST_PROXY="1"
node server.mjs
```

生产模式缺少必要密钥时会拒绝启动。

## 生成验证码

进入 `/admin`，输入 `ADMIN_TOKEN` 后可以：

- 批量生成未绑定验证码，首次兑换时自动绑定手机号；
- 生成指定手机号验证码，其他号码无法使用；
- 查看验证码状态、绑定手机号掩码和兑换时间；
- 作废验证码并立即踢出对应会话。

也可以调用管理 API：

```http
POST /api/admin/codes
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{
  "count": 1,
  "phone": "13800138000",
  "expiresInDays": 365,
  "note": "小红书订单 001"
}
```

不传 `phone` 时生成未绑定验证码。

## 购买后自动发码

支付平台或自动化工具在确认付款后调用：

```http
POST /api/purchase/complete
x-webhook-secret: <PURCHASE_WEBHOOK_SECRET>
Content-Type: application/json

{
  "orderId": "XHS202610250001",
  "phone": "13800138000"
}
```

返回：

```json
{
  "ok": true,
  "orderId": "XHS202610250001",
  "code": "ZJ-ABCD-EFGH",
  "existing": false,
  "delivery": {
    "configured": false,
    "forwarded": false
  }
}
```

同一个 `orderId` 重试时会返回相同验证码，不会重复发码。

### 自动发送到短信或消息服务

配置 `DELIVERY_WEBHOOK_URL` 后，服务端在发码成功后会把以下内容自动转发到该地址：

```json
{
  "phone": "13800138000",
  "code": "ZJ-ABCD-EFGH",
  "orderId": "XHS202610250001",
  "existing": false
}
```

可接入短信服务、企业微信机器人、飞书自动化或其他消息服务。若未配置该地址，购买接口仍会返回验证码，需要支付平台自行发送给买家。

## 文件结构

- `index.html` / `gate.css` / `gate.js`：公开验证码入口
- `app.html` / `styles.css` / `app.js`：受保护的人格测试应用
- `data.js`：44 位人物数据与行为评分
- `questions.js`：120 道原创情境题库与分层随机抽题
- `server.mjs`：访问控制、验证码、会话、管理 API 与购买回调
- `admin.html` / `admin.css` / `admin.js`：验证码管理后台
- `storage/`：运行时 SQLite 数据库，不应提交或公开

## 重要限制

当前项目已经实现网站侧的一人一码、手机号绑定、会话保护和自动发码接口，但没有小红书店铺、微信支付或支付宝的商户密钥，因此无法替商家完成真实支付扣款和平台订单拉取。

正式售卖前，需要由小红书店铺开放平台、微店、知识付费工具或其他支付服务在付款成功后调用 `/api/purchase/complete`。如果平台不支持 Webhook，则需要通过平台开放 API 或自动化工具把已付款订单转发到该接口。
