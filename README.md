# Personal Ledger

个人资产记账 Web 应用 —— 用最简单的方式追踪你的资产变化。

每月记录一次各账户余额，系统自动计算月度收益率、年度 YTD 收益率、累计收益率，并以可视化趋势图呈现资产走势。

## 功能特性

- **多账户管理** — 创建任意数量的账户（银行卡、基金、加密货币等）
- **月度快照** — 每月记录各账户余额，一键快速记账
- **收益率自动计算**
  - 月度收益率（环比上月）
  - 年度收益率 YTD（相比当年 1 月）
  - 累计收益率（相比首次记录）
- **总资产 Dashboard** — 资产总额、变化金额、收益率指标卡一览无余
- **趋势可视化** — 总资产走势迷你图 + 单账户历史折线图（Chart.js）
- **资产占比** — 各账户在总资产中的百分比柱状条
- **投资小记** — 按月记录投资心得、市场观察、策略思考
- **隐私保护** — 一键隐藏金额，防偷窥
- **CSV 导出** — 余额记录按月导出为 CSV
- **响应式设计** — 桌面 / 平板 / 手机端自适应

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 20+ |
| Web 框架 | Express 5 |
| 数据库 | SQLite（better-sqlite3） |
| 模板引擎 | EJS |
| 精度计算 | Decimal.js |
| 前端 | Vanilla JS + Bootstrap 5 + Chart.js 4 |
| 进程管理 | PM2 / systemd / Docker |

## 项目结构

```
personal-ledger/
├── src/
│   ├── app.js              # Express 入口
│   ├── db.js               # SQLite 初始化 & schema 迁移
│   ├── utils.js            # 工具函数（Decimal, dayjs 等）
│   ├── routes/
│   │   └── web.js          # API 路由 & 数据标准化
│   └── services/
│       └── ledgerService.js # 业务逻辑层
├── views/
│   ├── app.ejs             # 主页面模板（含全部 CSS）
│   ├── 404.ejs
│   └── 500.ejs
├── public/
│   └── app.js              # 前端 JS（状态管理 + DOM 渲染）
├── data/                   # SQLite 数据库目录（自动创建）
├── Dockerfile
├── package.json
└── .env.example
```

## 快速开始

### 环境要求

- Node.js >= 20
- npm >= 9

### 本地运行

```bash
# 克隆项目
git clone https://github.com/SaoXuan/personal-ledger.git
cd personal-ledger

# 安装依赖
npm install

# 配置环境变量（可选）
cp .env.example .env

# 启动
npm start
```

浏览器访问 `http://localhost:3000`

### 开发模式

```bash
npm run dev   # nodemon 自动重启
```

## 部署

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `DB_PATH` | `./data/ledger.db` | SQLite 数据库文件路径（支持绝对路径） |

### 方式一：PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start src/app.js --name personal-ledger

# 开机自启
pm2 save
pm2 startup

# 常用命令
pm2 restart personal-ledger
pm2 logs personal-ledger
pm2 status
```

### 方式二：systemd

创建 `/etc/systemd/system/personal-ledger.service`：

```ini
[Unit]
Description=Personal Ledger Node.js application
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/personal-ledger
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DB_PATH=/opt/personal-ledger/data/ledger.db
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable personal-ledger
systemctl start personal-ledger
```

### 方式三：Docker

```bash
# 构建镜像
docker build -t personal-ledger .

# 运行（数据持久化）
docker run -d \
  --name personal-ledger \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  personal-ledger
```

### Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如需 HTTPS + Basic Auth 保护：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    auth_basic "Personal Ledger";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

生成密码文件：

```bash
htpasswd -c /etc/nginx/.htpasswd your-username
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bootstrap` | 获取 Dashboard 全部数据 |
| GET | `/api/accounts` | 账户列表 |
| GET | `/api/accounts/:id` | 单个账户详情 |
| POST | `/api/accounts` | 创建/更新账户 |
| DELETE | `/api/accounts/:id` | 删除账户 |
| GET | `/api/snapshots?month=&accountId=` | 余额快照列表（支持筛选） |
| POST | `/api/snapshots` | 创建/更新月度快照 |
| DELETE | `/api/snapshots/:id` | 删除快照 |
| GET | `/api/notes` | 投资小记列表 |
| POST | `/api/notes` | 创建笔记 |
| PUT | `/api/notes/:id` | 更新笔记 |
| DELETE | `/api/notes/:id` | 删除笔记 |

## 数据库

应用使用 SQLite，启动时自动建表和迁移，无需手动操作。

**核心表：**

- `accounts` — 账户信息（名称、币种等）
- `snapshots` — 月度余额快照（每账户每月一条，UNIQUE 约束）
- `investment_notes` — 投资小记（按月份归档）

**备份：**

```bash
# 直接复制数据库文件即可
cp /opt/personal-ledger/data/ledger.db ~/backup/ledger-$(date +%Y%m%d).db
```

## 收益率计算逻辑

| 指标 | 公式 |
|------|------|
| 月度收益率 | (本月余额 - 上月余额) / 上月余额 × 100% |
| 年度收益率 YTD | (最新余额 - 当年1月余额) / 当年1月余额 × 100% |
| 累计收益率 | (最新余额 - 首次余额) / 首次余额 × 100% |

- 无上月数据时，月度收益率不显示
- 无当年 1 月数据时，YTD 不显示
- 仅一条记录时，累计收益率为 0%

## License

MIT
