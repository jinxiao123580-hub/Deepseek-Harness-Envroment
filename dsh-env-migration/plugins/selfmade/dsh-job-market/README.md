# dsh-job-market

> AI 求职市场分析与学习规划系统 —— DeepSeek Harness 插件
>
> 从真实招聘岗位出发，回答两个问题：**市场到底要什么**，以及 **我接下来 8 周该学什么**。

改造自 [`allentnetus/dsh-job-hunting`](https://github.com/allentnetus/dsh-job-hunting)，
复用其工作区约定、数据文件布局与只读采集安全设计；参考（但不照搬）
[`shengjidaguai-china/BossHunter`](https://github.com/shengjidaguai-china/BossHunter) 的采集思路。

---

## 目录

1. [架构说明](#1-架构说明)
2. [文件列表](#2-文件列表)
3. [启动方法（开发）](#3-启动方法开发)
4. [如何装到现有 DSH web profile](#4-如何装到现有-dsh-web-profile)
5. [第一次如何配置](#5-第一次如何配置)
6. [如何启动一次岗位扫描](#6-如何启动一次岗位扫描)
7. [如何查看市场分析](#7-如何查看市场分析)
8. [如何设置当前技能](#8-如何设置当前技能)
9. [如何生成 8 周计划](#9-如何生成-8-周计划)
10. [测试结果](#10-测试结果)

附录：[工具清单](#附录-a-18-个工具) · [产出文件](#附录-b-产出文件) · [硬约束对照表](#附录-c-需求硬约束对照表) · [设计取舍](#附录-d-关键设计取舍与理由)

---

## 1. 架构说明

### 1.1 为什么是「新建同族插件」而不是「改造上游源码」

评估阶段（见 [`docs/00-assessment.md`](docs/00-assessment.md)）发现上游仓库
**只提交了编译产物**：`git ls-files 'src/*'` = 0 个文件，`git ls-files 'dist/*'` = 114 个文件。
没有 TypeScript 源码可改，只能读 `.d.ts` 与 `.js` 反推契约。

因此采取的策略是：**不改动 `dist/` 产物**，新建 `dsh-job-market`，
在数据层面与上游完全对齐，从而两个插件可以装进同一个 profile、共用同一个 Workspace：

| 约定 | 值 | 说明 |
| --- | --- | --- |
| 岗位池 | `data/jobs.json` | 上游 `job_hunting_*` 工具与本插件读写同一份数据 |
| 个人档案目录 | `profile/` | 上游放 `profile.json`，本插件放 `personal-skills.json`，互不覆盖 |
| 输出树 | `input/ profile/ data/ reports/ assets/ config/ taxonomy/` | 与上游 `ensureOutputTree` 一致 |
| 工作区解析 | sessionId → cwd → 唯一工作区 | 与上游 `resolveActiveWorkspace` 同序 |
| 原子写 | `.{basename}.{pid}.{timestamp}.tmp` → `rename` | 与上游同款，避免半截文件 |
| 哈希 | FNV-1a 32 位 → base36 | 与上游 `hashString` 同算法 |
| 采集安全 | 只读 + 精确域名白名单 + 显式批准 | 逐字复刻上游 `browser-policy` 语义 |

### 1.2 分层

```
┌──────────────────────────────────────────────────────────────┐
│ src/index.ts            cordis 插件入口（inject 3 项能力）     │
├──────────────────────────────────────────────────────────────┤
│ src/tools/index.ts      18 个 DSH 工具 = 用户动作的边界        │
├──────────────────────────────────────────────────────────────┤
│ src/workflow/           编排层：串起闭环，负责全部 I/O          │
│   market-workflow.ts    analyzeMarket / planLearning /        │
│                         updateMarket / getStatus / trace      │
├──────────────────────────────────────────────────────────────┤
│ 领域层（纯函数，便于单测，全部可回溯）                          │
│  classify/   岗位方向分类器                                    │
│  jd/         JD 结构化解析 + 缓存（规则优先）                   │
│  taxonomy/   技能体系 + 标准化（系统核心）                      │
│  store/      跨平台去重 + last_seen_at 语义                    │
│  market/     市场统计 + 快照 + 趋势 + 路线增量调整               │
│  profile/    个人能力画像（0-5 级，只有本人能声明）              │
│  gap/        Gap 评分与可解释优先级                            │
│  plan/       目标拆分 + 项目目录 + 4/8/12 周路线                │
│  report/     Dashboard 组装 + Markdown 报告 + 数据回溯          │
├──────────────────────────────────────────────────────────────┤
│ 基础层                                                         │
│  shared/     types(唯一契约源) / text / hash / config          │
│  workspace/  工作区解析 + 原子 JSON 读写                        │
│  collect/    平台定义 + 检索计划 + 只读策略 + BrowserSkill 采集  │
│  jobs/       本地 JSON/CSV/Markdown 导入（无浏览器时的兜底）     │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 闭环数据流

```
配置方向 ──► 生成检索计划 ──► 采集/导入 ──► 跨平台去重 ──► 岗位池
  (config)      (keywords)     (只读/本地)   (dedupe_key)  (jobs.json)
                                                                │
                            ┌───────────────────────────────────┘
                            ▼
                     分类器 ──► JD 解析 ──► 技能标准化
                  (8 个方向)  (缓存优先)   (taxonomy 归一)
                            │
                            ▼
                    市场快照 ──► 技能频次(required/preferred/bonus 划分)
                  (snapshots)   共现 lift · 方向分布 · 薪资 · 经验
                            │
        ┌───────────────────┴────────────────────┐
        ▼                                        ▼
  数据回溯(trace)                          个人能力画像(0-5 级)
  任意比例 → 真实岗位列表                    (只有用户能写入)
                                                 │
                                                 ▼
                                            Gap 评分
                        priority = demand × importance × gap × coverage ÷ cost
                                                 │
                                                 ▼
                                    可验收目标 + 项目驱动 + 8 周路线
                                                 │
                                                 ▼
                                    定期重采 → 快照对比 → 增量调整建议
                                              (绝不推翻原计划)
```

### 1.4 三条贯穿全局的硬规则

**规则一：数字只能由程序算。**
所有数量、比例、薪资、趋势都在 `src/market/` 里由真实岗位计算。
模型只被允许参与「解析 / 分类 / 归一化 / 解释」四件事，从不参与任何统计数值的生成。
每个技能频次都带 `required_job_ids / preferred_job_ids / bonus_job_ids / job_ids`，
点开任意一个百分比都能列出支撑它的真实岗位（`job_market_trace_skill`）。

**规则二：技能统计不按字符串。**
`SkillNormalizer` 是系统核心。把 `C++ / C++11/14/17 / Modern C++` 归到
`cpp` 与 `modern-cpp`，把 `ROS 2 / ROS2 / Robot Operating System 2` 统一为 `ros2`，
把 `Ubuntu` 归入 `linux` 同时保留 `ubuntu` 子标签。
匹配遵循「最长优先 + 不重叠贪心」，ASCII 别名要求词边界（不会把 `ros` 命中进 `ros2`），
中文别名按子串（中文没有词边界）。体系可人工编辑：`taxonomy/skill-taxonomy.json`。

**规则三：AI 不得擅自认定你已掌握任何技能。**
AI 只能把建议写进 `pending_suggestions`，必须用户显式确认才进 `skills`。
`setSkillLevel` 只接受用户自评，`source` 恒为 `user`。
规划时若某个高频技能你从未评估，系统按 **0 级** 临时纳入（保守方向：假设你不会），
并如实回传在 `autoAssessed` 里，**绝不写回你的个人画像**。

---

## 2. 文件列表

包根：`D:\Deepseek Harness\dsh-job-market` · 41 个源文件 · 11,061 行 TypeScript

### 2.1 我手写的核心（契约层 / 编排层 / 基础层）

| 文件 | 大小 | 职责 |
| --- | --- | --- |
| `src/shared/types.ts` | 25.7 KB | **唯一契约源**。Job / SkillTaxonomy / JdAnalysis / MarketSnapshot / GapReport / LearningRoadmap / DashboardData 等全部类型 |
| `src/shared/text.ts` | 13.8 KB | 薪资（万/千/K/年薪/日薪/13薪）、经验、学历、地点、URL、公司名、职位名解析 |
| `src/shared/hash.ts` | 1.9 KB | FNV-1a 32 位（与上游同算法） |
| `src/shared/config.ts` | 9.6 KB | 默认配置 + `parseConfig` 校验（只读模式强校验、目标岗位非空） |
| `src/workspace/workspace.ts` | 6.1 KB | 工作区解析、输出树、原子 JSON 读写 |
| `src/store/job-store.ts` | 12.2 KB | `createJob` / `mergeJob` / `upsertJobs`（跨平台去重 + `last_seen_at`） |
| `src/taxonomy/taxonomy.ts` | 9.5 KB | taxonomy 加载/校验/合并/索引，损坏时回退内置体系 |
| `src/taxonomy/skill-normalizer.ts` | 8.7 KB | 别名匹配、implies 传递展开、最长优先不重叠 |
| `src/jd/jd-cache.ts` | 6.5 KB | 缓存键 = jd_hash + analysis_version + prompt_version |
| `src/plan/learning-roadmap.ts` | 9.7 KB | 4/8/12 周路线（按学习依赖相位排序，非按优先级堆叠） |
| `src/report/dashboard.ts` | 16.4 KB | 六块看板组装、Markdown 报告、`traceSkill` 回溯 |
| `src/workflow/market-workflow.ts` | 28.9 KB | 编排层：5 个用例 + 未评估技能处理 |
| `src/tools/index.ts` | 36.8 KB | 18 个 DSH 工具 |
| `src/index.ts` | 3.6 KB | cordis 入口（注册失败逆序回滚） |
| `src/skill/job-market.skill.ts` | 5.0 KB | 给宿主 agent 的作业指导书 |
| `src/jobs/local-import.ts` | 12.3 KB | JSON / CSV / Markdown 三通道导入 |
| `scripts/smoke.mjs` | 19.5 KB | 端到端冒烟测试 |

### 2.2 领域模块

| 文件 | 大小 | 职责 |
| --- | --- | --- |
| `src/taxonomy/default-taxonomy.ts` | 50.2 KB | 内置技能体系（12 大类，180+ 技能，含别名/上位/蕴含关系） |
| `src/classify/job-category-classifier.ts` | 17.7 KB | 8 个岗位方向分类，标题×4 / 描述×2 / 要求×1 加权 |
| `src/jd/jd-parser.ts` | 33.8 KB | JD 结构化（17 字段）+ required/preferred/bonus 判定 |
| `src/jd/prompts.ts` | 5.1 KB | 模型兜底解析用的提示词 |
| `src/market/market-analyzer.ts` | 35.7 KB | 技能频次 / 共现 lift / 方向分布 / 薪资 / 经验 / 城市 |
| `src/market/market-snapshot.ts` | 21.8 KB | 快照累积、趋势、`diffRoadmap` 增量调整 |
| `src/profile/personal-skill-profile.ts` | 18.6 KB | 0-5 级画像、证据、建议与确认状态机 |
| `src/gap/gap-analyzer.ts` | 17.5 KB | Gap 评分公式 + 逐条解释 |
| `src/plan/goal-planner.ts` | 44.8 KB | 可验收目标拆分（ROS2 拆到 Node/Topic/…/Nav2） |
| `src/plan/project-catalog.ts` | 17.5 KB | 项目模板（移动机器人全链路）+ TOP20 覆盖统计 |
| `src/collect/platforms.ts` | 9.5 KB | 5 平台定义 + 列表页 payload 解析 + 采集记录转岗位输入 |
| `src/collect/search-planner.ts` | 12.9 KB | 目标岗位 → 检索关键词扩展 → 只读 URL 计划 |
| `src/collect/browser-policy.ts` | 7.0 KB | 只读策略：精确白名单、禁止写入式动作、人工批准 |
| `src/collect/browser-collector.ts` | 16.5 KB | 腾讯 BrowserSkill（`bsk`）采集适配器 |

### 2.3 测试

| 文件 | 覆盖点 |
| --- | --- |
| `test/text.test.ts` | 薪资 / 经验 / 地点 / 学历 / URL / 公司名 / 职位名 |
| `test/job-store.test.ts` | 跨平台合并、跨日期只刷新 `last_seen_at` |
| `test/skill-normalizer.test.ts` | C++17→cpp+modern-cpp、ROS 2→ros2、Ubuntu→linux+ubuntu、词边界、最长优先 |
| `test/market.test.ts` | 百分比、required/preferred 划分、共现 lift、方向分离、趋势、除零 |
| `test/gap-plan.test.ts` | 评分公式、解释非空、AI 建议不自动生效、验收标准、每周七要素 |
| `test/classifier-jd-cache.test.ts` | 岗位分类、JD 缓存失效、三通道导入 |

### 2.4 文档与配置

| 文件 | 说明 |
| --- | --- |
| `README.md` | 本文档：10 项交付（架构 / 文件 / 启动 / 安装 / 配置 / 采集 / 分析 / 技能 / 计划 / 测试） |
| `docs/00-assessment.md` | 改造前的 7 项评估（可保留功能 / 数据结构 / BrowserSkill 采集 / 标准化去重 / profile / 报告 / 缺失模块） |
| `cordis.patch.yml` | bundle patch：`- insert: [{id: job-market, name: dsh-job-market}]` |
| `package.json` | `dsh.bundle.patch` 声明 + peerDeps + 脚本 |

---

## 3. 启动方法（开发）

本机 TypeScript 装在独立目录，避免污染插件自身的 `node_modules`：

```powershell
$tsc = "D:\Deepseek Harness\.build-tools\node_modules\typescript\bin\tsc"
cd "D:\Deepseek Harness\dsh-job-market"

# 类型检查（不产出）
node $tsc -p tsconfig.json --noEmit

# 构建
node $tsc -p tsconfig.json

# 单元测试（86 项）
node --test "dist/test/*.test.js"

# 端到端冒烟（全链路，含真实文件产出）
node scripts/smoke.mjs
```

> ⚠️ **必须用 glob 形式** `node --test "dist/test/*.test.js"`。
> 目录形式 `node --test dist/test/` 在 Node 24 下会报
> `Error: Cannot find module '...\dist\test'` + `code: 'MODULE_NOT_FOUND'`。
> `package.json` 的 `test:unit` 脚本已经写成 glob。

模块解析说明：插件的 `node_modules/@deepseek-ai` 是一个**目录联接**，
指向 `C:\Users\10905\.dsh\profiles\node_modules\@deepseek-ai`，
这样 `@deepseek-ai/dsh-tools` 等 peer 依赖无需联网即可解析，且插件目录保持干净。

---

## 4. 如何装到现有 DSH web profile

已经装好了。以下是**可复现的步骤**（也是换机器时的做法）。

### 4.1 ⚠️ 先确认「实例 → profile 目录」的映射（最容易踩的坑）

**DSH Launcher 的每个实例可以覆盖 `DSH_HOME`。**
一旦覆盖，该实例的 profile 就落在**完全不同的目录树**下 ——
`profiles/web-3` 这个相对路径在两个不同 `DSH_HOME` 下是**两个毫不相干的 profile**。

本机实际映射（来自 `%APPDATA%\dsh-launcher\launcher-config.json`）：

| 实例 | profile | DSH_HOME | profile 实际路径 |
| --- | --- | --- | --- |
| Default | `web` | 默认 `~/.dsh` | `C:\Users\10905\.dsh\profiles\web` |
| 社区精选增强包 | `web-3` | 默认 `~/.dsh` | `C:\Users\10905\.dsh\profiles\web-3` |
| 科研实例 | `web` | `C:\Users\10905\.dsh-research` | `C:\Users\10905\.dsh-research\profiles\web` |
| 学习实例 | `web-3` | `…\.dsh-runtime\homes\<实例id>` | `…\homes\<实例id>\profiles\web-3` |

所以**装之前必须先查出目标实例的 `dshHome`**：

```powershell
$cfg = [System.IO.File]::ReadAllText("$env:APPDATA\dsh-launcher\launcher-config.json", [System.Text.Encoding]::UTF8) | ConvertFrom-Json
foreach ($i in $cfg.instances) {
  $h = if ($i.dshHome) { $i.dshHome } else { "$env:USERPROFILE\.dsh" }
  "name={0}  profile={1}  profileDir={2}\profiles\{1}" -f $i.name, $i.profile, $h
}
```

> 两个 PowerShell 陷阱：`$home` 是**只读内置变量**，赋值会静默失败（改用 `$lh` 之类的名字）；
> 直接 `ConvertFrom-Json` 读该文件会因编码报 `Invalid object passed in`，
> 必须先用 `[System.IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)`。

要装到哪个实例，就编辑**那一行输出的 `profileDir`** 下的 `package.json`。

### 4.2 编辑目标 profile 的 `package.json`

两处都要改 —— **只加 dependencies 不够，还要加进 bundles**，
否则 pnpm 会装但 DSH 不会加载：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        // ... 原有项 ...
        "dsh-job-market"          // ← 加这一行
      ]
    }
  },
  "dependencies": {
    // ... 原有项 ...
    "dsh-job-market": "link:D:/Deepseek Harness/dsh-job-market"   // ← 加这一行
  }
}
```

> 路径用正斜杠 `/`。建议先备份为 `package.json.bak-job-market`。

### 4.3 建立链接

```powershell
# 把 <profileDir> 换成 4.1 查出来的真实路径
cd "<profileDir>"
& "C:\Users\10905\AppData\Roaming\npm\pnpm.ps1" install --prefer-offline
```

验证链接与加载：

```powershell
(Get-Item node_modules\dsh-job-market).Target   # → D:\Deepseek Harness\dsh-job-market

node -e "import('dsh-job-market').then(m=>{const t=[];m.apply({tools:{register(x){t.push(x.name);return()=>{}}},skills:{register(){return()=>{}}},workspaceRegistry:{list:()=>[],get:()=>undefined,resolveByPath:async()=>undefined}});console.log(m.name, t.length, 'tools')})"
# → dsh-job-market 18 tools
```

### 4.4 重启 DSH

**必须重启该实例**才会加载新 bundle —— 在 DSH Launcher 里切换/重启对应实例即可。
重启后新会话里说「求职市场状态」验证（会命中 `job_market_status`）。

### 4.5 卸载

```powershell
# 把 <profileDir> 换成 4.1 查出来的真实路径
cd "<profileDir>"
Copy-Item package.json.bak-job-market package.json -Force
& "C:\Users\10905\AppData\Roaming\npm\pnpm.ps1" install --prefer-offline
```

### 4.6 本机当前安装状态

| 实例 | profile 声明 | node_modules 链接 |
| --- | --- | --- |
| Default | ✅ | ✅ |
| 学习实例 | ✅ | ✅ |
| 社区精选增强包 | ❌ | ❌ |
| 科研实例 | ❌ | ❌ |

> ⚠️ 独立 `DSH_HOME` 的实例**不会**继承默认 home 的 `skills/`。
> 学习实例的 `…\homes\<id>\skills\` 目前**不存在** ——
> 它的 skill 需要单独装到那个目录下，见 `学习实例-安装清单与Prompt.md`。

---

## 5. 第一次如何配置

在 DSH 里直接说自然语言即可，宿主 agent 会挑对应工具执行。
也可以按下面顺序手动跑一遍。

### 第 1 步：初始化工作区

> 「初始化求职市场工作区」

调用 `job_market_init`，产出：

```
<工作区>/
├── taxonomy/skill-taxonomy.json    ← 180+ 技能，可人工编辑
├── config/job-search.json
└── profile/personal-skills.json
```

### 第 2 步：配置求职方向

> 「我要找机器人软件、ROS2 开发、机器人控制算法、机器人嵌入式工程师，
> 城市上海杭州苏州南京，经验 0-3 年，薪资 15K 以上」

调用 `job_market_configure`：

```jsonc
{
  "target_roles": ["机器人软件工程师", "ROS2开发", "机器人控制算法", "机器人嵌入式工程师"],
  "locations": ["上海", "杭州", "苏州", "南京"],
  "experience_min": 0, "experience_max": 3,
  "salary_min_k": 15
}
```

### 第 3 步（建议先做）：录入你自己的技能等级

见 [第 8 节](#8-如何设置当前技能)。**先录入**能让第一次生成的计划就贴合你的实际水平。

### 第 4 步：确认 `bsk` 是否可用

```powershell
Get-Command bsk
```

`bsk` 是 **腾讯 BrowserSkill** 的外部 CLI + 浏览器扩展，不是 npm 依赖，
本包不会安装它。**没装也能用**——走本地导入通道（第 6 节）。
`job_market_plan_collection` 会如实上报 `browserSkill.available`。

---

## 6. 如何启动一次岗位扫描

### 6.1 路径 A：自动采集（需要 `bsk`）

> 「帮我扫描一下机器人软件岗位」

三步：

**① 生成计划**（`job_market_plan_collection`）
把 4 个目标岗位扩展成 13 个检索关键词 × 4 城市 × 2 页，
产出各平台**公开搜索页**的 HTTPS URL 列表。

**② 展示 URL 并取得明确同意**
工具描述里写死：`confirmed` 是 `const: true` —— 模型无法默认填 `true`，必须真的问过你。

**③ 执行只读采集**（`job_market_collect_jobs`）
```jsonc
{ "urls": ["https://www.zhipin.com/...", "..."], "confirmed": true, "platform": "boss" }
```

采集严格遵守只读边界：固定序列 `session start --no-focus` →
逐个 `navigate` + `snapshot`（间隔不小于 `minIntervalMs`）→ `session stop`；
`sessionId` 必须匹配 `/^[A-Za-z0-9]{4}$/`。
遇到**验证码 / 登录过期 / 支付 / 提交确认**会立即停下该平台并抛出
`BrowserHumanAssistanceRequiredError`（code `HUMAN_ASSISTANCE_REQUIRED`），提示人工处理。

### 6.2 路径 B：本地导入（无需浏览器，MVP 推荐）

导出的岗位文件放进工作区，支持三种格式：

| 格式 | 要求 |
| --- | --- |
| JSON | `JobInput[]`、`{jobs: [...]}` 或单个对象 |
| CSV | 首行表头，中英文列名均可，支持双引号包裹与字段内逗号 |
| Markdown | `## 岗位标题` 分块，块内 `键：值` 行，其余文本进描述 |

> 「导入 `input/jobs-seed.json`」

```jsonc
// 最小可用的 JSON 岗位
{
  "岗位": "机器人软件工程师",
  "公司": "上海某某智能科技有限公司",
  "城市": "上海",
  "薪资": "25-40K",
  "经验": "3-5年",
  "学历": "本科及以上",
  "链接": "https://www.zhipin.com/job/1001",
  "来源": "BOSS直聘",
  "描述": "负责 ROS2 移动机器人软件开发，熟练掌握 C++ 与 Linux，使用 TF2 与 Nav2。",
  "要求": "熟练掌握 C++\n熟悉 ROS2"
}
```

列名别名很宽松：`岗位/岗位名称/职位/title`、`公司/公司名称/company`、
`城市/地点/工作地点/city`、`薪资/薪水/salary`、`经验/工作经验`、`学历`、
`链接/网址/url`、`来源/平台`、`描述/岗位描述`、`要求/任职要求`。
数值字段（`salary_min`/`salary_max`/`experience_min`/`experience_max`）会自动合成可读原文，
**薪资/经验只在一处解析**，保证导入与采集两条入口口径完全一致。

### 6.3 去重语义

- 同一岗位在 BOSS 与猎聘各出现一次 → **合并为 1 条**（`dedupe_key` 刻意不含来源）
- 同一岗位第二天再见到 → `last_seen_at` 刷新、`seen_count` +1，**不计为新岗位**
- 公司名会剥掉分支机构括号与反复出现的公司后缀（「XX科技有限公司」==「XX科技」）
- 职位名会去掉括号段与职级噪声词

冒烟测试实测：13 条种子 → 12 个岗位（1 条跨平台合并），重复导入 0 新增。

---

## 7. 如何查看市场分析

> 「分析一下现在机器人软件岗位需要什么」

调用 `job_market_analyze`（可选 `recent_days` / `cities` / `categories` /
`salary_min_k` / `experience_max` 过滤）。产出：

### 7.1 技能需求排行

实测输出（12 个真实岗位）：

```
技能            岗位数  出现率  Required  Preferred  加权需求
C++                8  66.7%  66.7%   0.0%     0.667
ROS2               8  66.7%  66.7%   0.0%     0.667
Linux              5  41.7%  41.7%   0.0%     0.417
Embedded           4  33.3%  33.3%   0.0%     0.333
Algorithms         3  25.0%  25.0%   0.0%     0.250
MCU                3  25.0%  25.0%   0.0%     0.250
Navigation Stack   3  25.0%  25.0%   0.0%     0.250
STM32              3  25.0%  25.0%   0.0%     0.250
Python             3  25.0%  16.7%   8.3%     0.208
```

三档是**划分**，恒有 `required + preferred + bonus == job_count`，
所以两个比例可以直接当分母核对，不会出现重叠区间。

`weighted_demand = (required×1.0 + preferred×0.5 + bonus×0.25) ÷ 总岗位数`。

### 7.2 岗位方向分布（分方向统计，不跨方向混算）

```
嵌入式             3 个岗位  (25.0%)
机器人软件           2 个岗位  (16.7%)
ROS2              2 个岗位  (16.7%)
运动规划            1 个岗位  (8.3%)
机器人感知           1 个岗位  (8.3%)
强化学习/具身智能       1 个岗位  (8.3%)
机器人控制           1 个岗位  (8.3%)
SLAM              1 个岗位  (8.3%)
```

每个方向内部单独统计 TOP 技能，因此**不会**因为 SLAM 岗大量要 Ceres/G2O
就告诉你嵌入式方向优先学 Ceres。

### 7.3 技能共现

`ROS2 + C++`、`ROS2 + Linux` 这类真正成套出现的组合，带 `lift` 提升度：
`lift = P(a,b) / (P(a)×P(b))`，>1 表示成套，<1 表示互相排斥。

### 7.4 数据回溯（点名要核实某个百分比时）

> 「ROS2 68% 是怎么算出来的？哪些岗位要求 ROS2？」

调用 `job_market_trace_skill`：

```
· ROS2 出现 8 次，要求它的真实岗位：
    苏州某某自动化有限公司 — 机器人控制算法工程师 (zhaopin)
    上海某某导航有限公司 — SLAM 算法工程师 (boss)
    南京某某机器人有限公司 — ROS2 机器人软件工程师 (liepin)
    杭州某某机器人有限公司 — ROS2 开发工程师 (liepin)
    杭州某某控制有限公司 — 机器人嵌入式工程师 (zhaopin)
```

每个岗位都带公司、职位、城市、原始 URL 与来源平台。

### 7.5 Dashboard 与趋势

`job_market_dashboard` 返回六块：市场总览 / 技能需求排行 / 岗位方向 /
我的能力 / 学习路线 / 趋势，并带 `provenance` 声明数字来源。

趋势跨快照累积（`ROS2 61% → 68% → 72%`）。排序**先按最新市场占比降序**，
再按变化幅度降序 —— 这样「占比高但在下降」的核心技能不会被 limit 截断掉，
那恰恰是你最该看到的那一条。

### 7.6 Markdown 报告

每次分析会写 `reports/market-<日期>.md`（中文七节报告）与 `.json`。

---

## 8. 如何设置当前技能

技能等级是 **0-5 级**，口径固定：

| 等级 | 含义 |
| --- | --- |
| 0 | 完全不会 |
| 1 | 知道概念 |
| 2 | 做过 Demo |
| 3 | 能独立完成项目 |
| 4 | 能熟练解决实际问题 |
| 5 | 深入掌握 |

> 「C++ 我能独立做项目，目标是精通。有课程设计项目。
> Linux 只到会用，ROS2 刚知道概念。」

调用 `job_market_set_skill`：

```jsonc
{
  "skill": "C++",
  "current_level": 3,
  "target_level": 5,
  "evidence": [{ "kind": "project", "title": "C++ 课程设计", "detail": "实现了一个简易 ROS 节点" }],
  "confirmed": true
}
```

**关键约束**：
- `confirmed` 是 `const: true`，必须是你真的说过，模型不能替你填
- `source` 恒为 `user`，AI 建议永远进不了 `skills`
- 每项带 `evidence` / `last_updated` / `confidence`，可随时人工修改
- 技能名自动过标准化：写「C++17」会正确落到 `cpp` + `modern-cpp`

### AI 建议通道

若 AI 从简历/项目里**推测**你可能有某能力，它只能通过 `suggestSkill` 写入
`pending_suggestions`，然后你需要显式确认：

> 「接受你对 SLAM 的建议」
> 「不要这个建议」

分别调用 `job_market_confirm_skill_suggestion`（`confirmed: true` / `false`）。
驳回只从 `pending_suggestions` 里移除，**对 Gap 计算零影响**。

### 查看当前画像

> 「看看我的能力画像」

`job_market_get_skill_profile` 返回全部技能、目标等级、证据、待确认建议与摘要。

---

## 9. 如何生成 8 周计划

> 「根据目前岗位市场给我生成未来8周学习计划」

调用 `job_market_plan_learning`（`weeks`: 4/8/12，默认 8；可指定 `project_id`、`hours_per_week`）。

### 9.1 Gap 评分公式

```
priority = market_demand^w × importance^w × skill_gap^w × role_coverage^w ÷ learning_cost^w
```

五项权重全部是配置项（`gapWeights`），每项还带一个**必须非空的中文解释**，
说明它为什么排在这个位置。实测：

```
#   技能            市场占比  当前→目标  Gap    优先级   理由
1   C++               67.0%   3→5      0.40    0.177  C++：市场加权需求 0.67（67% 岗位要求，共 8 个岗位），对目标方向关键度…
2   ROS2              67.0%   1→4      0.60    0.159  ROS2：市场加权需求 0.67（67% 岗位要求，共 8 个岗位），对目标方向关…
3   Linux             42.0%   2→4      0.40    0.096  Linux：市场加权需求 0.42（42% 岗位要求，共 5 个岗位），对目标方向…
4   Algorithms        25.0%   0→3      0.60    0.057  …
5   Navigation Stack  25.0%   0→3      0.60    0.034  …
```

`skill_gap = (target − current) ÷ 5`。

### 9.2 未评估技能怎么处理

GapAnalyzer 只遍历你已确认的技能 —— 这守住了「AI 不得擅自认定已掌握」，
但副作用是：你没评估过的 `Nav2 / TF2 / SLAM` 会从计划里整个消失，
于是「市场要什么」和「我该学什么」脱节。

折中做法（`src/workflow/market-workflow.ts`）：在**内存里**为市场高频
（出现 ≥ 2 个岗位）、且你未评估的技能补一条 0 级条目，目标 3 级（能独立完成项目）。
方向是保守的 —— 假设你不会，而不是假设你会。三条硬保证：

1. 绝不写回 `profile/personal-skills.json`
2. `autoAssessed` 如实回传，工具会明确告诉你「这些是按 0 级临时纳入的」
3. 你自己设过等级的技能永远不会被覆盖

> 实测效果：只声明 5 项技能时，8 周路线的第 6-8 周会退化成「阶段复盘」占位；
> 加上未评估技能后，8 周全部填满真实市场技能。

### 9.3 目标必须可验收

禁止「学习 C++」这类不可验收目标。`acceptance_criteria` **必须非空**，
且只有全部满足才能标记完成（`job_market_complete_goal` 会拒绝空验收标准与未确认的请求）。

ROS2 会被拆成具体能力点：
`Node / Topic / Service / Action / Parameter / Launch / TF2 / URDF / QoS / rosbag / RViz / Nav2`。

### 9.4 项目驱动

`PROJECT_CATALOG` 提供项目模板，移动机器人全链路：

```
STM32/ESP32 → 电机+编码器+IMU → micro-ROS → ROS2 → TF/Odom → EKF
→ LiDAR → SLAM → Nav2 → RViz
```

报告会明确告诉你「完成该项目覆盖目标岗位 TOP20 技能中的 N 项」。
把多个技能压缩进一个项目，比零散刷知识点更能提升通过率。

### 9.5 路线排序逻辑

**不是**简单按优先级堆叠。排序按「学习依赖相位」：
编程/Linux 是地基 → 嵌入式/通信/硬件是中层 → 机器人/控制/规划/SLAM/感知/强化学习是上层；
同相位内按难度升序；再按市场岗位数降序。

理由：Gap 优先级回答「什么最值得学」，路线回答「按什么顺序学得会」，两者不能混为一谈。

实测 8 周输出：

```
第  1 周 | 掌握 C++（内存与所有权管理、泛型编程与工程化构建） + 掌握 Algorithms…  |  8 岗位 |  8h
第  2 周 | 掌握 Python（虚拟环境与依赖管理、类型注解与 dataclass…）              |  3 岗位 |  8h
第  3 周 | 掌握 Linux（系统排查与工程环境维护） + 掌握 Embedded（外设驱动…）       |  5 岗位 | 12h
第  4 周 | 掌握 MCU（…） + 掌握 …                                              |  8 岗位 | 15h
第  5 周 | 掌握 Navigation Stack（…）                                          |  3 岗位 |  8h
第  6 周 | 掌握 TF2（坐标系变换与树维护）                                        |  2 岗位 |  8h
第  7 周 | 掌握 Motion Control（…）                                            |  2 岗位 | 12h
第  8 周 | 掌握 PID（闭环整定与响应指标优化）                                     |  2 岗位 | 12h
```

每周都带齐七要素：本周目标 / 具体任务 / 为什么学 / 对应多少岗位 /
预计投入时间 / 验收条件 / 项目产出。

### 9.6 定期重采与动态调整

> 「更新一下求职市场」

`job_market_update` 重新分析、追加新快照、对比上一份路线，
输出**继续 / 新增 / 提高优先级 / 降低优先级 / 删除**建议，每条都带原因。

`policy` 恒为 `'incremental'` —— **绝不直接推翻你的学习计划**，只给增量建议：

```
本次仅产出增量调整建议（policy=incremental），不会推翻你的原计划：
共 5 条建议 —— 继续 5 项、提高优先级 0 项、降低优先级 0 项、新增 0 项、建议移除 0 项。
所有变更都只是建议，需你确认后才会写入学习路线。
```

---

## 10. 测试结果

### 10.1 类型检查

```
node "D:\Deepseek Harness\.build-tools\node_modules\typescript\bin\tsc" -p tsconfig.json
→ EXIT = 0，零类型错误（strict + verbatimModuleSyntax + NodeNext）
```

### 10.2 单元测试

```
node --test "dist/test/*.test.js"
→ tests 86 / pass 86 / fail 0
```

覆盖需求 §二十 指定的重点：技能标准化、岗位去重、百分比计算、
Gap 评分、岗位分类、JD 缓存、市场快照，另加薪资/经验/学历/地点解析与三通道导入。

### 10.3 端到端冒烟

```
node scripts/smoke.mjs
→ 全链路通过：0 个失败
```

真实走完 MVP 验收链路（13 条种子岗位 → 12 个去重后岗位）：

| 环节 | 结果 |
| --- | --- |
| 工具注册 | 18 个 |
| taxonomy 技能数 | ≥ 150 |
| 采集计划 | 13 个关键词扩展，全部 HTTPS |
| 导入解析 | 13/13 |
| 跨平台去重 | 13 → 12（1 条合并） |
| 重复导入 | 0 新增，12 刷新 |
| 市场统计 | 8 个方向、4 个城市、共现对非空 |
| 三档划分不变式 | 全部满足 `req+pref+bonus == job_count` |
| 数据回溯 | 每个技能 `job_ids.length == job_count`，每个岗位带 URL |
| JD 解析模型调用 | **0 次** |
| 8 周路线 | 8 周全部填满，每周有验收条件与项目产出 |
| 增量调整 | `policy = incremental`，5 条建议全带原因 |
| 产出文件 | 8/8 全部生成 |

产出文件实测大小：

```
data/jobs.json                     14.0 KB (12 项)
data/jd-cache.json                 53.2 KB
data/market-snapshots.json        178.8 KB
data/learning-goals.json            6.0 KB (5 项)
data/learning-roadmap.json         10.5 KB
profile/personal-skills.json        1.9 KB
config/job-search.json              0.2 KB
taxonomy/skill-taxonomy.json       75.1 KB
```

### 10.4 测试过程中发现并修复的 4 个真实缺陷

写测试的价值在这里体现 —— 4 个都是**功能可用但结果错误**的问题：

**① JD 解析：一条「优先」污染整段要求。**
`normalizeText` 会把 `\n` 折成空格，于是 `['熟练掌握 C++', '了解 Python 优先']`
被粘成同一句话，"优先" 标记把 C++ 也判成了 `preferred`。
直接违反需求 §五「必须区分 required / preferred」。

修复：`src/jd/jd-parser.ts` 的 `buildJdText` 与 `extractMentions` 改用
**保留换行**的规范化（`normalizeKeepingLineBreaks`）。
换行是 JD 天然的条目边界，必须留给 `splitSentences`。

**② 三档计数可重叠，比例不再是划分。**
同一岗位里同一技能既在标题（required）又在「优先」句（preferred），
两档各记一次 → `required + preferred + bonus = 4 > job_count = 3`。
用户无法从比例读出真实结构。

修复：`src/market/market-analyzer.ts` 的 `buildJobSkillView` 改为
**每个岗位对每个技能只落最高档**，恒有 `req + pref + bonus == job_count`。

**③ 趋势把最重要的技能截断掉。**
`buildAllTrends` 只按 `delta_pp` 降序排，limit=20 时
「占比高但本次下降」的核心技能（ROS2 从 75% → 50%）排在最末尾被整条丢弃。

修复：改为**先按最新市场占比降序**，再按变化幅度降序。

**④ 标题被正文淹没（分类器）。**
「机器人软件工程师」因为正文提到 4 次 ROS2 被判成 `ros2` 方向 ——
标题（最强的方向信号）反被淹没。

修复：`src/classify/job-category-classifier.ts` 权重从
标题×3/描述×2/要求×2 改为 **标题×4/描述×2/要求×1**。
理由：正文内部本就会互相复述，要求段再算两遍等于把同一句话放大，属于虚高分。

---

## 附录 A. 18 个工具

| 工具 | 用途 |
| --- | --- |
| `job_market_status` | 工作区与全局状态、安全默认值 |
| `job_market_init` | 一次性初始化（输出树 / taxonomy / 画像） |
| `job_market_configure` | 配置目标岗位、城市、经验、薪资、关键词 |
| `job_market_plan_collection` | 扩展关键词 → 生成只读采集计划 |
| `job_market_collect_jobs` | 经 BrowserSkill 只读采集（需 `confirmed: true`） |
| `job_market_import_jobs` | 本地 JSON/CSV/Markdown 导入（无浏览器兜底） |
| `job_market_analyze` | 分类 + 解析 + 标准化 + 市场统计 |
| `job_market_dashboard` | 六块看板 |
| `job_market_trace_skill` | 技能 → 真实岗位列表（数据回溯） |
| `job_market_trends` | 跨快照技能需求趋势 |
| `job_market_get_skill_profile` | 读取个人能力画像 |
| `job_market_set_skill` | 设置技能等级（需 `confirmed: true`） |
| `job_market_confirm_skill_suggestion` | 接受/驳回 AI 建议 |
| `job_market_plan_learning` | Gap + 目标 + 4/8/12 周路线 |
| `job_market_complete_goal` | 标记目标完成（需验收标准 + 确认） |
| `job_market_update` | 重新扫描 + 增量调整建议 |
| `job_market_prepare_jd_prompt` | 生成模型解析 prompt（复杂 JD 兜底） |
| `job_market_ingest_jd_analysis` | 回灌模型解析结果（写入缓存） |

---

## 附录 B. 产出文件

```
<工作区>/
├── input/                     手动导入的岗位文件
├── profile/
│   └── personal-skills.json   个人能力画像（只有本人声明）
├── data/
│   ├── jobs.json              岗位池（与上游 job-hunting 共用）
│   ├── jd-cache.json          JD 解析缓存
│   ├── market-snapshots.json  历史市场快照（用于趋势）
│   ├── learning-goals.json    学习目标
│   └── learning-roadmap.json  学习路线
├── reports/
│   ├── market-<日期>.md       中文市场分析报告
│   ├── market-<日期>.json     Dashboard 数据
│   └── roadmap-<日期>.md      学习路线报告
├── taxonomy/
│   └── skill-taxonomy.json    可人工编辑的技能体系
└── config/
    └── job-search.json        求职方向配置
```

---

## 附录 C. 需求硬约束对照表

| # | 需求 | 落点 |
| --- | --- | --- |
| §四 | 5 平台统一岗位池 | `collect/platforms.ts` PLATFORMS（一期启用 BOSS/猎聘/智联） |
| §三 | 岗位字段 + 跨平台跨日期去重 | `shared/types.ts` Job（34 字段）+ `store/job-store.ts` |
| §四 | 岗位扩展搜索词、差异过大不混统计 | `collect/search-planner.ts` + 分类器 + 分方向统计 |
| §五 | 17 字段 JD、区分 required/preferred/bonus | `jd/jd-parser.ts` + `★缺陷①修复` |
| §六 | 技能标准化，禁止字符串统计 | `taxonomy/skill-normalizer.ts` + `default-taxonomy.ts` |
| §七 | 频次三比例 + 共现 | `market/market-analyzer.ts` + `★缺陷②修复` |
| §八 | 方向分开统计（8 方向） | `classify/job-category-classifier.ts` + `★缺陷④修复` |
| §九 | 0-5 级、证据、AI 不得擅自认定 | `profile/personal-skill-profile.ts`（`pending_suggestions` 状态机） |
| §十 | 评分公式 + 必须解释理由 | `gap/gap-analyzer.ts`（`explanation` 非空） |
| §十一 | 可验收目标 + 能力拆分 | `plan/goal-planner.ts`（ROS2 拆到 12 个能力点） |
| §十二 | 项目驱动 + TOP20 覆盖报告 | `plan/project-catalog.ts` |
| §十三 | 4/8/12 周、每周七要素 | `plan/learning-roadmap.ts` |
| §十四 | 历史快照 + 趋势 + 增量调整不推翻计划 | `market/market-snapshot.ts`（`policy: 'incremental'`）+ `★缺陷③修复` |
| §十五 | Dashboard 六块 | `report/dashboard.ts` |
| §十六 | 数据可回溯；数字只能程序算 | `traceSkill` / `traceCategory` + `provenance` |
| §十七 | LLM 成本：hash 缓存、规则优先 | `jd/jd-cache.ts`（实测 **0 次模型调用**） |
| §十八 | 只读、不绕验证码、不自动投递 | `collect/browser-policy.ts` + `BrowserHumanAssistanceRequiredError` |
| §十九 | MVP 验收 | `scripts/smoke.mjs` 全链路 0 失败 |
| §二十 | 复用优先、保持插件结构、加单测 | 86 项单测 + 18 工具 + cordis 入口 |

**明确不做**（需求原话）：自动投递、自动打招呼、自动聊天、自动填表、简历海投。
`status` 工具每次都会回传 `autoApply: false`、`readOnlyCollection: true`。

---

## 附录 D. 关键设计取舍与理由

**为什么新建插件而不是改上游？**
上游无 `src/`，只有 `dist/`。改 `dist/` 会让上游合并变得不可能，
而新建插件可以在数据层完全对齐（同一 `jobs.json`、同一工作区），
代价只是多一个包名。

**为什么插件内部零 LLM 调用？**
上游 `job-hunting` 全仓库无 prompt、无 LLM SDK，`resume-assessor` 自证是
确定性规则引擎。这条路线的好处是**成本可预测、结果可复现、可写单测**。
所以本插件也走「规则优先 + 宿主 agent 兜底」：规则能做的绝不调模型，
复杂语义才由宿主 agent 通过 `prepare_jd_prompt` / `ingest_jd_analysis` 介入。
实测 12 个岗位的解析模型调用数为 **0**。

**为什么采集不是唯一入口？**
`bsk` 是外部 CLI + 浏览器扩展，不是 npm 依赖，本机 `Get-Command bsk` 无结果。
如果自动采集是唯一通道，MVP 验收就无法离线完成。
本地 JSON/CSV/Markdown 导入让同一岗位池、同一去重逻辑、同一统计口径可以独立验证。

**为什么 `dedupe_key` 不含来源？**
需求要求「跨平台跨日期去重」。含来源就退化成平台内去重，
BOSS 与猎聘的同一条岗位会变成两条，技能比例被系统性高估。

**为什么路线不按 Gap 优先级排序？**
Gap 优先级回答「什么最值得学」，路线要回答「按什么顺序学得会」。
按优先级堆叠会得到「第 1 周学 C++、第 2 周学 SLAM」这种跳过地基的顺序。

**为什么未评估技能按 0 级纳入而不写回画像？**
不纳入 → 计划脱离市场实际；写回画像 → 违反「AI 不得擅自认定」。
内存临时纳入 + `autoAssessed` 如实回传，两者都满足。

---

## License

MIT。改造自 [`allentnetus/dsh-job-hunting`](https://github.com/allentnetus/dsh-job-hunting)（MIT）。
