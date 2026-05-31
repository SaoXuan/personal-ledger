# Personal Ledger（RMB 记账）

一个面向个人使用的记账页面应用：

- 账户只保留 **名称**
- 余额统一使用 **RMB（CNY）**
- 重点是 **实时汇总**，不做复杂导出报表

UI 使用 Bootstrap（CDN），不再使用独立 `app.css` 文件。

---

## 快速启动

```bash
npm install
npm run dev
```

打开：`http://localhost:3000`

首次运行会自动创建本地数据库：`./data/ledger.db`

---

## 页面说明（简化版）

1. **快速记账**：账户 + 日期 + 余额
2. **汇总卡片**：总资产 / 账户数 / 记录数 / 最新日期
3. **趋势表**：按日/周/月查看总资产变化
4. **账户列表**：仅名称 + 最新余额
5. **最近记录**：最新余额记录，支持删除

---

## 数据规则

- 所有金额单位统一为 RMB（CNY）
- 不拉取外部资产数据，全部由用户手工录入
- 页面每 15 秒自动刷新一次，也可以手动刷新

---

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

可配置：

```env
PORT=3000
DB_PATH=./data/ledger.db
```

---

## 生产运行

```bash
npm install --omit=dev
npm start
```

---

## Docker（可选）

```bash
docker build -t personal-ledger .
docker run -d --name personal-ledger -p 3000:3000 -v $(pwd)/data:/app/data personal-ledger
```
