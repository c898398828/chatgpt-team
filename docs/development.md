# 开发文档

本文档面向项目开发者，补充仓库结构、本地开发方式，以及最近新增的“批量注册”模块接入说明。

## 目录结构

```text
.
├─ backend/               Node.js + Express API
├─ frontend/              Vue 3 + Vite 管理后台与用户端页面
├─ docs/                  项目文档
├─ Codex_register/        批量注册脚本目录（Python）
│  ├─ openai_register3.py
│  └─ output/
│     ├─ accounts.txt
│     └─ token_*.json
└─ package.json           workspaces 根脚本
```

## 本地开发

### 环境要求

- Node.js：以 `frontend/package.json` 中的 `engines.node` 为准，当前要求 `^20.19.0 || >=22.12.0`
- npm：推荐使用 npm workspaces
- Python：批量注册功能依赖本机可执行的 `python` 命令

### 安装依赖

在仓库根目录执行：

```bash
npm install
```

### 启动方式

同时启动前后端：

```bash
npm run dev
```

分别启动：

```bash
npm run dev --workspace=backend
npm run dev --workspace=frontend
```

默认地址：

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:3000/api`

### 基础配置

至少准备以下文件：

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

后端最少需要可用的 `JWT_SECRET`。如果需要首次固定管理员密码，可额外配置 `INIT_ADMIN_PASSWORD`。

## 批量注册模块

### 代码入口

- 后端路由：`/api/admin/batch-register/*`
- 前端页面：`/admin/batch-register`
- 后端服务实现：`backend/src/services/batch-register.js`
- 路由实现：`backend/src/routes/batch-register.js`
- 前端页面：`frontend/src/views/BatchRegisterView.vue`

### 运行依赖

批量注册并不在 Node.js 进程内完成，后端会拉起外部 Python 脚本：

- 脚本默认查找 `Codex_register/openai_register3.py`
- 也支持通过环境变量 `CODEX_REGISTER_DIR` 指定脚本目录
- Node 进程必须能够直接执行 `python`

如果脚本不存在，接口会直接返回启动失败。

### 配置来源

批量注册页面本身只保存并发数和目标数量，其他配置来自系统配置：

- 代理地址：系统设置中的 `chatgpt_proxy_url`
- 注册邮箱源：系统设置中的 `register_email_provider`

当前代码里 `register_email_provider` 仅支持：

- `mailtm`

对应后端实现见 `backend/src/utils/register-settings.js`。

### 数据流

1. 管理员在 `/admin/batch-register` 启动任务。
2. 后端通过 `spawn('python', ...)` 启动 `openai_register3.py`。
3. 运行日志通过 `/status` 和 `/logs` 接口回传到前端。
4. Python 脚本把结果写入 `Codex_register/output/`。
5. 页面可读取 `accounts.txt` 展示已注册账号。
6. 页面可把 `token_*.json` 批量导入 `gpt_accounts` 表。

导入逻辑当前行为：

- 按 `email` 去重
- 已存在账号时更新 `token`、`refresh_token`、`chatgpt_account_id` 和 `expire_at`
- 新账号写入后默认 `is_open = 1`

### 权限限制

批量注册接口挂在管理员路由下，并额外要求 `super_admin` 权限。普通后台账号即使已登录，也不能访问该功能。

## 开发注意事项

### 敏感数据

以下文件包含敏感信息，不应提交或对外分发：

- `Codex_register/output/accounts.txt`
- `Codex_register/output/token_*.json`

这些文件中可能包含邮箱、密码、access token、refresh token 和账号 ID。

### 调试建议

- 先确认后台“系统设置”中的代理与邮箱源可用，再启动批量注册
- 如果任务启动失败，优先检查本机 `python` 命令是否可执行，以及脚本目录是否正确
- 如果前端页面没有日志，先看后端控制台是否输出 `[BatchRegister]` 相关错误

### 提交前检查

- 不要把批量注册产物、测试账号、代理配置或 token 写入仓库
- 涉及后台菜单、路由和权限时，确认数据库初始化默认菜单仍可正常创建
- 涉及批量注册导入逻辑时，至少手动验证“新增账号”和“已存在账号更新 token”两条路径
