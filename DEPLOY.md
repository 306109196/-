# 正式上线指南

正式环境需要运行 Node.js 服务端，并保留 SQLite 数据文件。普通静态网站托管无法保护测试文件，也无法保存验证码绑定关系。

## 方案一：Render 托管服务

这是最快获得公网 HTTPS 地址的方案。`render.yaml` 已配置 Docker 服务、1 GB 持久化磁盘、自动生成密钥和健康检查。

1. 把当前目录提交到一个 GitHub 仓库。
2. 登录 Render，选择 `New` → `Blueprint`。
3. 连接该 GitHub 仓库，Render 会读取 `render.yaml`。
4. 创建资源。Render 会分配一个 `https://...onrender.com` 地址并自动启用 HTTPS。
5. 在 Render 的 Environment 页面查看自动生成的：
   - `ADMIN_TOKEN`
   - `PURCHASE_WEBHOOK_SECRET`
   - `PHONE_HASH_SECRET`
6. 打开 `https://你的域名/admin`，用 `ADMIN_TOKEN` 登录管理后台。
7. 把购买回调地址配置为：

```text
https://你的域名/api/purchase/complete
```

持久化磁盘挂载在 `/var/data`，SQLite 数据库位于 `/var/data/archive.sqlite`。不要删除该磁盘。

Render 的持久化磁盘不是免费资源，具体价格以 Render 控制台为准。

## 方案二：自己的云服务器

适用于阿里云、腾讯云、华为云、AWS Lightsail、DigitalOcean 等 VPS。

### 1. 准备域名

给域名添加一条 `A` 记录，指向服务器公网 IP。

### 2. 安装 Docker

在 Ubuntu/Debian 服务器上安装 Docker 和 Docker Compose 插件。

### 3. 上传项目

把当前目录上传到服务器，例如 `/opt/zhujian`。

### 4. 创建生产环境配置

复制 `.env.example` 为 `.env`，并设置：

```dotenv
DOMAIN=mirror.example.com
NODE_ENV=production
HOST=0.0.0.0
PORT=4173
DATA_DIR=/var/data
SESSION_DAYS=30
COOKIE_SECURE=1
TRUST_PROXY=1
ADMIN_TOKEN=至少32位随机字符串
PURCHASE_WEBHOOK_SECRET=另一个至少32位随机字符串
PHONE_HASH_SECRET=第三个至少32位随机字符串
```

生成密钥可以使用：

```bash
openssl rand -hex 32
```

不要把 `.env` 提交到 Git 或发送给他人。

### 5. 启动服务

```bash
docker compose up -d --build
```

Caddy 会自动申请并续期 HTTPS 证书。打开：

```text
https://你的域名/
```

管理后台：

```text
https://你的域名/admin
```

### 6. 备份数据

SQLite 数据保存在 Docker 命名卷 `zhujian-data` 中。需要定期备份：

```bash
docker compose exec app sh -c "cp /var/data/archive.sqlite /var/data/archive.backup.sqlite"
docker cp 项目容器名:/var/data/archive.backup.sqlite ./archive.backup.sqlite
```

## 正式上线前检查

- 域名通过 HTTPS 访问，浏览器显示有效证书。
- `NODE_ENV=production`。
- 三个服务端密钥均为独立随机值，且不少于 32 位。
- 打开 `/app.html` 时未登录会被跳回验证码入口。
- 未登录直接访问 `/data.js`、`/questions.js` 返回 `401`。
- 在 `/admin` 生成验证码，并在手机端完成一次首绑测试。
- 用第二个手机号测试同一验证码，应被拒绝。
- 配置支付平台调用 `/api/purchase/complete`。
- 测试同一订单重复回调只返回相同验证码。
- 如果使用短信或消息服务，配置 `DELIVERY_WEBHOOK_URL` 并完成一次真实发送。
- 备份 `storage` / `/var/data` 中的 SQLite 数据库。

## 支付平台接入

网站已经提供公网购买完成接口：

```http
POST https://你的域名/api/purchase/complete
x-webhook-secret: <PURCHASE_WEBHOOK_SECRET>
Content-Type: application/json

{
  "orderId": "平台订单号",
  "phone": "买家手机号"
}
```

小红书店铺或其他售卖平台需要在付款成功后调用这个接口。若平台本身不支持 Webhook，需要使用该平台开放 API、订单机器人或合规的自动化工具转发已付款订单。

接口返回验证码后，平台可以自行发送给买家，或者配置 `DELIVERY_WEBHOOK_URL` 让网站继续转发到短信、企业微信、飞书等消息服务。
