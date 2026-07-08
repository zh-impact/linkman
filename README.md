# LinkMan

> 把散落在书签栏、聊天记录、浏览器导出和剪贴板里的成千上万个链接，收拢成一个可检索、可去重、可审计、可回滚的本地知识库。

LinkMan 是一个面向「重度链接收藏者」的本地优先（local-first）链接管理平台。它不是又一个云书签服务——所有数据都落在你自己机器上的 SQLite 与文件系统中；它也不是一个简单的收藏夹——内置的导入/解析/去重/过滤/审计流水线，让 10 万条 URL 的清洗工作可以在片刻完成。

无论是 OneTab、Tablerone、Chrome 导出的 CSV，还是你随手粘贴的纯文本，LinkMan 都能把它们解析成结构化的链接，并按域名、路径前缀或编辑距离自动识别重复与相似项，最后留下一个干净、可搜索、可批量编辑的链接库。每一步操作都会写入操作历史，需要时一键回滚。

## 核心能力

### 全格式导入与渐进式解析

- **支持格式**：纯文本 URL 列表、JSON 数组、`URL | 标题`、`标题 - URL`、OneTab INI、Chrome 历史导出 CSV、Tablerone JSON
- **两步流水线**：导入只负责落盘 + 建 Job，解析在 Files 页面手动触发，进度条实时反馈
- **后台模式**：开启 Background 开关后，解析在后台推进，UI 不阻塞，可继续浏览其他文件
- **可恢复**：服务重启或浏览器刷新后，从中断点继续解析；底层依赖确定性的 URL 切片 + 原子计数器，绝不会重复插入或丢失进度

### 智能去重

- **三种策略**：`strict`（完全匹配）、`normalized`（去 `www`、去末尾 `/`、排序 query、去 fragment）、`smart`（仅去 `www` 与末尾 `/`，保留 query 顺序）
- **可排序**：按原始顺序、字母序或域名分组
- **保留最优**：每组保留首条，其余标记为 `duplicate_removed` 并记录 `duplicate_of`，便于追溯

### 多层相似度过滤

- **内链过滤**：自动识别 `localhost`、`127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16` 等私有网段与本地路径
- **相似链接聚类**：
  - **Domain 分组**：同域下所有链接聚合
  - **Path Prefix 分组**：按可配置深度（默认 `/a/b`）切分路径
  - **Edit Distance 检测**：单行 DP + 长度预过滤 + 行内早退，对长 URL 友好；按域分桶分页加载，避免一次性全量比对

### 链接浏览器

- 分页表格 + 虚拟滚动（`@tanstack/react-virtual`），十万级数据流畅渲染
- 按状态、关键词搜索；多选批量打标签、批量删除、批量导出（CSV/JSON）
- 单条编辑、状态流转可视化

#### 高级搜索语法

搜索框支持两种交互：**普通模式**（默认）对 `originalUrl | normalizedUrl | domain | title | tags` 做模糊匹配；**高级模式**把关键词限定在 URL 的某个部分。开启搜索框右侧的 `Advanced` 开关即可切换。

URL 拆分为四个部分（以 `https://www.example.com/foo/bar?q=1#section` 为例）：

| 部分 | 值           | 含义             |
| ------ | ------------ | ---------------- |
| host   | `www.example.com` | 主机名           |
| path   | `/foo/bar`   | 路径             |
| search | `q=1`        | 查询字符串（不含 `?`） |
| hash   | `section`    | 锚点（不含 `#`） |

**Google 风格前缀语法**（无需 UI，直接输入）：

```
host:github.com            匹配主机名
host:github.com path:pull  AND：host 和 path 同时满足
host:github.com host:gitlab.com  OR：同一前缀多个值匹配任一
foo:bar                    未识别前缀 → 整体作为普通搜索词
host:                      前缀后无值 → 视为普通文本，不触发前缀匹配
host:github.com pull       前缀 + 裸词组合：host 满足且裸词在选中部分匹配
```

**UI 复选框（OR 语义）**：Advanced 开关打开后下方出现四个复选框，多选 = 任一命中。复选框与前缀语法**双向绑定**——输入 `host:foo` 自动勾选 `host`；取消勾选会从搜索框移除对应前缀。

**默认与窄化规则**（关键）：

- Advanced 关闭 → 完全等同于改造前的搜索行为
- Advanced 打开 + 四项全选 → 与关闭字节一致（含 title/tags 命中）
- Advanced 打开 + 全部不勾 → 视为默认，与关闭字节一致
- Advanced 打开 + 取消至少一项（但非全部）→ 进入窄化模式，仅在选中部分搜索（不再匹配 title/tags）
- 任意前缀语法出现 → 强制进入窄化模式（即便 Advanced 关闭）

**无效 URL 回退**：无法被 `new URL()` 解析的链接（剪贴板脏数据、损坏的书签）会跳过部分匹配，直接对 `originalUrl` 做全文 LIKE，不会从结果中消失。

### 操作历史与一键回滚

- 每一次导入、去重、过滤、批量编辑、删除都会写入 `operations` 表
- 记录前后快照 hash、变更明细（added/removed/modified）、统计与错误
- 任意历史节点支持 `rollback`，按 diff 反向应用

### 仪表盘

- 状态分布概览（pending / imported / duplicate*removed / filtered*\* / ...）
- 最近操作时间线、关键指标速览、快捷入口

## 技术栈

| 层         | 选型                                                      |
| ---------- | --------------------------------------------------------- |
| 后端       | Fastify 5 + tRPC 11 + Drizzle ORM + libSQL/SQLite         |
| 前端       | React 19 + Mantine v9 + Vite 8 + TanStack Virtual         |
| 类型与校验 | TypeScript 严格模式 + Zod（tRPC 输入契约）                |
| 代码质量   | Biome（lint + format）、knip（死代码检测）                |
| 工作流     | OpenSpec spec-driven（proposal → design → specs → tasks） |
| 包管理     | pnpm workspaces                                           |

## 快速开始

### 前置条件

- Node.js ≥ 20
- pnpm ≥ 9

### 安装

```bash
pnpm install
```

### 启动开发环境

```bash
# 后端：Fastify + tRPC（端口 3003）
pnpm --filter service dev

# 前端：Vite 开发服务器（端口 5173）
pnpm --filter webapp dev
```

打开 http://localhost:5173 即可使用。后端 tRPC 端点挂载在 `/trpc` 前缀下。

### 数据存储

- **数据库**：SQLite，默认 `data/linkman.db`，可通过环境变量 `DB_FILE_NAME` 覆盖（`apps/service/.env`）
- **导入文件**：原始导入内容落盘到 `data/files/{timestamp}-{filename}`，路径规范化 + 路径穿越保护
- **数据库迁移**：Drizzle Kit 管理，迁移产物在 `apps/service/drizzle/`

```bash
# 生成 / 应用 schema 变更
pnpm --filter service drizzle-kit generate
pnpm --filter service drizzle-kit migrate
```

## 项目结构

```
linkman/
├── apps/
│   ├── service/                     # Fastify + tRPC 后端
│   │   ├── src/
│   │   │   ├── routes/              # tRPC routers
│   │   │   │   ├── import.ts        # 两步导入/解析（create / parse.start / parse.batch）
│   │   │   │   ├── deduplicate.ts   # 去重 preview / execute
│   │   │   │   ├── filter.ts        # 内链过滤 + 相似聚类
│   │   │   │   ├── links.ts         # CRUD / 批量 / 搜索 / 导出
│   │   │   │   ├── files.ts         # 文件读、行读取、删除
│   │   │   │   ├── operations.ts    # 历史列表 + 回滚
│   │   │   │   └── stats.ts         # 仪表盘聚合
│   │   │   ├── lib/
│   │   │   │   ├── db/              # drizzle client + queries + schema
│   │   │   │   ├── files/           # 文件系统抽象（路径保护）
│   │   │   │   ├── import/          # URL 抽取 + 校验 + 缓存
│   │   │   │   ├── log/             # 操作日志 + 快照 + diff + 回滚
│   │   │   │   ├── similarity/      # domain / path-prefix / edit-distance
│   │   │   │   └── url/             # normalize / validate / extract / internal
│   │   │   ├── appRouter.ts         # 顶层 router 聚合
│   │   │   ├── context.ts           # tRPC 上下文
│   │   │   └── server.ts            # Fastify bootstrap
│   │   ├── drizzle/                 # 迁移产物
│   │   └── drizzle.config.ts
│   └── webapp/                      # React + Mantine 前端
│       └── src/
│           ├── pages/               # Home / Links / Files / Dedup / Filter / History
│           ├── layout/              # 根布局 + 顶部导航
│           ├── utils/               # tRPC client、useConfirm
│           ├── theme.ts             # Mantine 主题
│           └── Router.tsx
├── openspec/                        # spec-driven 变更记录（changes/ + specs/）
├── biome.json                       # 代码风格统一配置
├── knip.json                        # 死代码 / 未使用依赖检测
└── pnpm-workspace.yaml
```

## 开发约定

### 代码风格（Biome 强制）

- 缩进 2 空格，行宽 100，行尾 LF
- JavaScript/TypeScript：**单引号**、**省略分号**（`semicolons: asNeeded`）
- 自动整理 import 顺序（`assist.actions.source.organizeImports`）
- 提交前运行 `pnpm exec biome check --write .`，CI 应保持零警告

```bash
pnpm format        # 仅格式化
pnpm exec biome check --write .   # 格式化 + 安全 lint 修复
```

### 类型与契约

- 全仓 TypeScript 严格模式；改动后必须通过 `pnpm --filter service exec tsc --noEmit` 与 `pnpm --filter webapp exec tsc --noEmit`
- tRPC 过程输入必须用 **Zod** schema 校验；不要在路由层手写 `as` 类型断言
- DB schema 单一来源：`apps/service/src/lib/db/schema.ts`；查询统一封装在 `lib/db/queries.ts`
- 共享类型导出自 `apps/service/src/types/index.ts`；前端通过 `@linkman/service` workspace 直接引用

### 后端 API 约定

- 所有端点挂在 `/trpc` 前缀，使用 tRPC v11 非批处理模式：mutation body 直接是输入对象（**不要**包 `{json:...}`）
- 服务端 Fastify 配置：`bodyLimit: 50MB`、`maxParamLength: 5000`、CORS 允许 `username` 自定义头
- 破坏性操作（去重、过滤、批量删除）必须：
  1. `captureBeforeState()` 拿到快照 hash
  2. 执行写操作
  3. `diffLinks()` 计算变更
  4. `logOperation()` 落库，便于后续回滚

### 并发与正确性

- 解析 Job 用 `withJobLock(jobId, fn)` 串行化，确保每个 batch 读到不同的 `importedCount` 切片
- 计数器更新必须用 SQL 原子表达式 `sql\`${col} + ${delta}\``，禁止 read-modify-write
- 内存缓存（如 parse cache）只是优化，**正确性必须能在缓存 miss 时自愈**（重读文件 + 确定性切片恢复）

### 大数据与性能

- 列表渲染一律走虚拟滚动（`useVirtualizer`）；按域分桶分页加载，禁止一次性 `getAllLinks` 进入 UI
- 导出 / 全量分析路径允许 `getAllLinks`，但应保留在请求-响应模型内，不引入 SSE/subscription

### 变更管理（OpenSpec）

任何超过 trivial 的改动都走 spec-driven 流程：

```bash
/opsx:new <change-name>     # 创建变更目录（spec-driven schema）
/opsx:ff    <change-name>   # 一键生成 proposal → design → specs → tasks
/opsx:apply <change-name>   # 按 tasks.md 实施
/opsx:archive <change-name> # 归档并将 delta specs 同步到 openspec/specs/
```

- 所有 capability 规格集中在 `openspec/specs/<capability>/spec.md`
- 历史变更归档在 `openspec/changes/archive/`
- 每个需求用 `Requirement` + `Scenario` 格式描述，便于自动化校验

### 提交规范

- Conventional Commits：`feat: ...` / `fix: ...` / `refactor: ...` / `docs: ...`
- 一次提交对应一次逻辑变更；不要把不相关的 lint 修复与功能改动混在一起
- Changesets 自动化版本与发布（`@changesets/cli`）

## 许可证

[GNU Affero General Public License v3.0 or later](LICENSE)
