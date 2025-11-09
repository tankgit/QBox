# QBox

QBox是我个人launch的一个量化工具平台，希望可以集成数据、策略、实验、交易为一体，同时完全拥抱AI范式，希望将AI的能力enroll进所有的数据、交易、策略的环节，探索下一代量化交易的工程范式。

(目前还是在早期阶段，基础功能还未开发完成)


## 项目结构

```
QBox/
├── backend/            # FastAPI 后端服务（uv 包管理）
├── frontend/           # React Web 前端（Vite）
└── README.md
```

## 环境准备

### 后端（Python 3.12）

1. 安装 [uv](https://github.com/astral-sh/uv)
2. 复制环境变量模板并填写长桥接口配置

   ```bash
   cd backend
   cp .env.example .env
   ```

   `.env` 需配置以下变量：

   - `APP_HOST` / `APP_PORT`：服务监听地址/端口
   - `DATA_STORAGE_PATH` / `LOG_STORAGE_PATH`：本地数据与日志存储目录
   - `LONGPORT_HTTP_URL` / `LONGPORT_QUOTE_WS_URL` / `LONGPORT_TRADE_WS_URL`
   - 账号密钥（至少配置纸上或实盘其中之一）：
     - `LONGPORT_PAPER_APP_KEY`, `LONGPORT_PAPER_APP_SECRET`, `LONGPORT_PAPER_ACCESS_TOKEN`
     - `LONGPORT_LIVE_APP_KEY`, `LONGPORT_LIVE_APP_SECRET`, `LONGPORT_LIVE_ACCESS_TOKEN`

3. 安装依赖并启动

   ```bash
   uv pip sync
   uv run uvicorn app.main:app --reload
   ```

   默认监听 `http://localhost:8000`，提供 RESTful API。

### 前端（Node 18+）

1. 复制环境变量模板并设定后端地址

   ```bash
   cd frontend
   cp .env.example .env
   ```

2. 安装依赖并启动

   ```bash
   npm install
   npm run dev
   ```

   默认在 `http://localhost:5173` 


## 日志与数据

- 所有数据文件位于 `DATA_STORAGE_PATH`
  - 自生成数据：`data_*.csv`
  - 实盘快照：`storage/data/snapshots/data_*.csv`
- 回测、量化任务日志位于 `LOG_STORAGE_PATH/backtests` 与 `LOG_STORAGE_PATH/quant`
  - 第一行存放任务配置 JSON
  - 后续行为 CSV 格式日志

## LICENSE

本项目采用 GNU Affero General Public License v3.0 (AGPL-3.0) 授权。

您可以自由复制、分发、研究和修改本软件，但必须：

- 开源：任何衍生项目都必须采用相同的 AGPLv3 许可证，并公开源代码。
- 网络服务条款：如果您对外提供本软件的服务（如SaaS），也需开放完整源代码。
- 保留原始版权声明及许可证文件。

完整协议内容请参阅：[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

如需商业授权或有其他需求，请联系作者协商。

