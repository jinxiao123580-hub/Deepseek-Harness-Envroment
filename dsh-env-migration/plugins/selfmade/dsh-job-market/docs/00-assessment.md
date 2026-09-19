# dsh-job-hunting 现有架构评估

评估对象：`https://github.com/allentnetus/dsh-job-hunting` v0.1.3（MIT）
本地克隆：`D:\Deepseek Harness\dsh-job-hunting`

## 0. 评估前提：仓库没有 TypeScript 源码

| 事实 | 证据 |
| --- | --- |
| `git ls-files 'src/*'` = **0 个文件** | 仓库只提交编译产物 |
| `git ls-files 'dist/*'` = **114 个文件** | `dist/src/**/*.js` + `.d.ts` + `.js.map` |
| `.gitignore` 含 `dist/`，但 dist 已被提交 | 属强制提交产物 |

**结论**：无法在上游 TS 源码上做增量改造（不存在 src）。可复用的"接口面"是
`dist/src/**/*.d.ts`（完整类型签名）与 `.js`（实现）。因此本次改造策略为
**新建同族插件 `dsh-job-market`，复用其数据约定与安全设计，不修改 dist 产物**
——保证上游可继续合并，且避免"为了重构而重构"。

---

## 1. 当前有哪些功能可以直接保留

插件是 cordis 插件（`dist/src/index.d.ts`）：

```ts
export declare const name = "dsh-job-hunting";
export declare const inject: readonly ['tools', 'skills', 'workspaceRegistry'];
export declare const apply: (ctx: Context, configInput?: unknown) => (() => void);
```

已注册 **12 个 DSH 工具**（`dist/src/tools/*.js`）：

| 工具名 | 作用 | 关键参数 |
| --- | --- | --- |
| `job_hunting_status` | 显示工作区 / 岗位 / profile / site 状态 | — |
| `job_hunting_collect_browser_jobs` | 只读 BrowserSkill 采集岗位并落库 | `urls`, `confirmed`, `source` |
| `job_hunting_import_jobs` | 导入本地 JSON/Markdown JD 文件 | `path`, `source` |
| `job_hunting_collect_jobs` | 本地采集器 + 状态元数据 | `path`, `source` |
| `job_hunting_generate_report` | 生成 JSON+Markdown+HTML 日报 | `date` |
| `job_hunting_build_site` | 构建自包含静态站点 | — |
| `job_hunting_open_site` | 返回站点 file:// URL | — |
| `job_hunting_resume_parse` | 解析简历（docx/pdf/text/md） | `path`, `confirmed` |
| `job_hunting_resume_assess` | 简历评估（**规则引擎**，非 LLM：`assessor: 'baseline-deterministic'`） | `target` |
| `job_hunting_profile_update` | 创建/更新求职 profile 草稿并确认 | `feedback`, `confirmed` |
| `job_hunting_mark_interest` | 记录兴趣标记 | `confirmed` |
| `job_hunting_sync_interest` | 同步浏览器导出的兴趣池 | `confirmed` |

**可直接保留（复用其设计）**：
- ✅ **只读浏览器安全策略**（`browser-policy.ts`，见第 3 节）——设计优秀，逐条复刻
- ✅ **Workspace 解析与原子 JSON 读写**（`workspace-output`）
- ✅ **profile 版本化 + 非破坏性迁移**（`profile-schema`: `CURRENT_PROFILE_SCHEMA_VERSION = 1`）
- ✅ **岗位规范化 / 去重**（`job-ledger`: `normalizeJob` / `dedupeJobs`）
- ✅ **本地 JSON/Markdown JD 导入通道**（`local-json-adapter` / `local-markdown-adapter`）
- ✅ **静态站点构建 + 数据内嵌**（`site-builder`: `embedSiteData`）
- ✅ **简历解析**（docx via `mammoth`，pdf via `pdfjs-dist`）
- ✅ **"确认门控"（confirmation-gated）交互范式**——所有写操作都要 `confirmed: true`

**不建议复用**：`matcher` 的粗粒度打分（第 4 节）、`reports/daily-report`（非市场统计）。

---

## 2. 当前岗位采集数据结构

`dist/src/domain/types.d.ts:3-18`，实际字段远少于目标 schema：

```ts
export interface JobRecord {
    id: string;            // job-<FNV1a32(identityKey).toString(36)>
    source: string;
    title: string;
    company: string;
    location: string;      // 单一字符串，无 city/district 拆分
    salary?: string;       // 字符串，无 min/max/months
    description?: string;
    requirements: string[];
    url: string;
    postedAt?: string;
    deadline?: string;
    collectedAt: string;
    matchScore?: number;
    matchReasons?: string[];
}
```

**相对目标 schema（用户 §三）的缺口**：

| 目标字段 | 现状 |
| --- | --- |
| `job_id` / `source` / `url` | ✅ 有（`id`/`source`/`url`） |
| `source_job_id` | ❌ 无 |
| `normalized_job_title` / `job_category` | ❌ 无 |
| `company_size` / `industry` | ❌ 无 |
| `city` / `district` | ❌ 只有合并的 `location: string` |
| `salary_min` / `salary_max` / `salary_months` | ❌ 只有 `salary?: string` |
| `experience_min` / `experience_max` | ❌ 无 |
| `education` | ❌ 无 |
| `publish_time` | ⚠️ 近似为 `postedAt` |
| `collected_at` | ✅ 有 |
| **`last_seen_at`** | ❌ **完全缺失 → 无法实现"重复出现只更新 last_seen_at"** |
| `skills_raw` / `skills_normalized` | ❌ 完全无技能字段 |

**存储位置**：活跃 Workspace 的 `data/jobs.json`（`docs/browser-skill-integration.md:71`）。
其他持久化路径：`profile/profile.json`（`profile-storage.d.ts`）、
`data/interest-ledger.json`（`interest-tools.d.ts`）、输出目录 `job-hunting-site`。

---

## 3. BrowserSkill 如何采集 BOSS、51job、猎聘、智联、国聘

### 3.1 关键结论：**它并不"认识"这五个网站**

全仓库 grep `zhipin|51job|liepin|zhaopin|iguopin` 只有 **5 处命中**，全部在
`dist/src/config/default-config.js:2-6` 的白名单里：

```js
export const DEFAULT_BROWSER_ALLOWED_DOMAINS = [
    'www.51job.com', 'www.zhipin.com', 'www.liepin.com',
    'www.zhaopin.com', 'www.iguopin.com',
];
```

**没有任何**按站点区分的搜索 URL 模板、CSS 选择器、翻页规则或字段抽取规则。
它是**通用 URL 驱动**的采集器：调用方给出 URL，它负责安全校验 + 导航 + 读快照。

### 3.2 真实采集流程

`dist/src/browser/browser-skill-adapter.js:138-213` `collectWithBrowserSkill(request, runner)`：

1. `request.config.enabled !== true` → 抛错
2. `validateBrowserPolicy(request, config)`（安全闸门，见第 3.3）
3. `checkBrowserSkill('bsk', runner)` → 不可用则抛 `BrowserSkillUnavailableError`
4. `bsk session start --no-focus` → 用 `readSessionId` 解析 **4 位** session id
   （正则 `/^[A-Za-z0-9]{4}$/`，兼容 JSON `sessionId|session_id`、裸文本、`session id: XXXX` 标签）
5. 对每个 URL 循环：
   - 限速：距上次导航不足 `config.minIntervalMs` 则 `setTimeout` 补足
   - `bsk navigate <url> --session <id>`
   - `bsk snapshot --session <id>` → stdout 解析 JSON
6. `readVisibleJobs(payload, request)`：
   - 先查 `payload.assistanceRequired ?? payload.humanAssistance ?? payload.requiresHuman`
     → 命中则抛 `BrowserHumanAssistanceRequiredError`
   - 取 `payload.visibleJobs ?? payload.jobs`，**必须是数组**
   - 逐条要求 `title` / `company` / `location` / `url` 均为 `string`，否则跳过
   - `normalizeJob({...raw, source: request.source ?? 'browser-skill', ...})`
7. `dedupeJobs([], incomingJobs).slice(0, config.maxItemsPerRun)`
8. `finally` 必执行 `bsk session stop <id>`；若拿不到 session id 才用应急 `bsk session stop --all`
9. 失败与清理错误分别保留，采集失败优先抛原始错误

### 3.3 安全设计（用户 §十八 要求，**逐条复刻**）

`dist/src/browser/browser-policy.js:56-84` `validateBrowserPolicy`：

```js
if (config.mode !== 'read-only') throw new TypeError('browserSkill.mode must be "read-only"');
// maxItemsPerRun / minIntervalMs 必须为正整数
// allowedDomains 非空，每项经 assertAllowedDomain 校验为纯主机名
if (config.requireUserApproval !== true || !isApprovalGranted(request))
    throw new Error('explicit user approval is required for BrowserSkill collection');
// 每个 URL 经 assertUrlAllowed：协议必须 http/https，hostname 必须精确等于白名单项
assertNoUnsafeRequestAction(request);
```

`assertNoUnsafeRequestAction`（`browser-policy.js:41-55`）**明确阻断**：

```js
if (request.credentialExtraction === true ||
    request.credentialExtractionExpression?.trim() !== undefined && ... !== '' ||
    request.extractExpression?.trim() !== undefined && ... !== '' ||
    request.submit === true || request.formAction === true)
    throw new TypeError('credential extraction, form actions, and submit actions are not allowed');
const unsafeAction = request.actions?.find((action) =>
    /credential|evaluate|form|submit|write|fill|click|payment|auth|captcha|otp|login/i.test(action));
```

> 注意主机名匹配是**精确相等**（`hostname === domain`），非后缀匹配。

`readAssistanceReason`（`browser-skill-adapter.js:79-98`）把站点反馈映射为人工协助原因：
`captcha` / `otp` / `payment` / `submit-confirmation` / `login` → 即用户要求的
"遇到 CAPTCHA / 登录过期 / 限制页面立即停止并提示人工处理"。

### 3.4 前置依赖：`bsk` 未安装 ⚠️

- `bsk` 来自 **Tencent/BrowserSkill**（外部 CLI + 浏览器扩展），
  `docs/browser-skill-integration.md:3-6` 明确："它们不是 npm 依赖，不会由本包安装"
- 本机实测：`Get-Command bsk` 无结果，全局 npm bin 无 `bsk*`，DSH 安装目录无 browser-skill
- 配置默认 `executable: 'bsk'`

**影响**：MVP 验收第 2 条（自动从 BOSS+猎聘+智联读取岗位）依赖 `bsk`。
必须保留一条**不依赖浏览器的采集通道**（本地 JSON/Markdown 导入 —— 上游已有），
并在 `bsk` 缺席时给出明确可用性提示而非静默降级（上游已是此设计，见
`docs/browser-skill-integration.md:116-117`："找不到 bsk 可执行文件时，工具会返回明确的
不可用状态，不会切换到另一条未经审查的采集路径"）。

---

## 4. 当前岗位如何标准化、去重和匹配

### 4.1 标准化（`dist/src/domain/job-ledger.js:62-99` `normalizeJob`）

- 空白折叠：`value?.replace(/\s+/g, ' ').trim() ?? ''`
- URL 规范化 `normalizeUrl`：清 `hash`、去 `pathname` 尾部 `/`、**`searchParams.sort()`**
- 列表去重保序（`normalizeStringList`）
- 可选字段为空串时**不写入键**

### 4.2 去重键（`job-ledger.js:41-52`）

```js
const buildFallbackIdentity = (job) => [
    normalizeLookupKey(job.company), normalizeLookupKey(job.title), normalizeLookupKey(job.location),
].join('|');
const buildIdentityKey = (job) => {
    const normalizedUrl = normalizeUrl(job.url);
    if (normalizedUrl !== '') return `url:${normalizedUrl}`;
    return `fallback:${buildFallbackIdentity(job)}`;
};
```

id 生成（`job-ledger.js:53-60`）为 **FNV-1a 32 位** 哈希转 base36：

```js
const hashString = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};
// id: `job-${hashString(identityKey)}`
```

`dedupeJobs(existing, incoming)`：existing 先入（先到先得），incoming 先 `normalizeJob` 再比对；
**重复项直接 `continue` 丢弃**。

> ⚠️ **关键缺陷**：去重是"丢弃式"的，**没有 `last_seen_at` 字段，也不更新任何时间戳**。
> 用户 §三 要求的"重复出现时更新 last_seen_at，不重复作为新岗位计数"**必须新建存储层实现**。

### 4.3 匹配（`dist/src/domain/matcher.js:8-55` `matchJob`）

纯加性打分，clamp 到 0..100：

| 条件 | 分值 |
| --- | --- |
| `targetRoles` 命中 title+details | **+35** |
| `targetCompanies` 命中 company | +20 |
| `targetIndustries` 命中 company+details | +10 |
| `preferredLocations` 命中 location | +15 |
| `excludedLocations` 命中 location | **−45** |
| `keywords` 命中全文 | `+min(10 + n*5, 20)` |
| `avoid` 命中全文 | `−min(20 + n*5, 30)` |

返回 `{ score, reasons }`。

> ⚠️ 这是"岗位对人"的单维匹配分，**与用户 §十 要求的
> `priority = market_demand × importance × skill_gap × role_coverage ÷ learning_cost`
> 完全不是一回事**。技能维度、等级维度、可解释性均缺失。

---

## 5. 当前用户 profile 如何保存

- **路径**：`profile/profile.json`（`profile-storage.d.ts`: `PROFILE_PATH = 'profile/profile.json'`），
  相对 Workspace 根
- **格式**：JSON，带 schema 版本 `CURRENT_PROFILE_SCHEMA_VERSION = 1`
- **迁移**：`migrateCareerProfile(input)` 返回 `{profile, migrated, fromVersion, toVersion}`；
  首次迁移会在原文件旁**保留副本**，随后经 Workspace 原子写入落盘；后续读取无副作用
  （`profile-storage.d.ts:16-32`）
- **schema**（`dist/src/domain/types.d.ts:34-54`）：

```ts
export interface CareerProfile {
    schemaVersion?: number;
    targetRoles: string[];          // ✅ 对应用户 §四 target_roles
    targetIndustries: string[];
    targetCompanies: string[];
    preferredLocations: string[];   // ✅ 对应 locations
    excludedLocations: string[];
    keywords: string[];             // ✅
    avoid: string[];
    version: number;                // 用户确认版本号（与 schemaVersion 分离）
    state?: 'profile-confirmed';
    confirmedAt?: string;
    userFeedbackHistory?: ProfileFeedback[];
    modelSuggestions?: ResumeAssessmentSuggestion[];
    notes?: string[];
    unknowns?: string[];
    shareIndustriesAcrossCities?: boolean;
    industriesByCity?: Record<string, string[]>;
}
```

- **状态机**：`profile-state-machine` 强制 `parsed → user-confirmed → assessed` →
  `profile-draft` → `profile-confirmed`，非法跃迁抛 `ProfileStateTransitionError`
  （`code: 'INVALID_STATE_TRANSITION' | 'MISSING_ASSESSMENT'`）
- **写入门控**：`job_hunting_profile_update` 需 `confirmed: true` 才发布

**缺口**：
- ❌ **没有 `experience` 配置**（用户要 0-3 年）
- ❌ **没有 `salary` 配置**（用户要 >= 15K）
- ❌ **没有任何技能等级字段**（用户 §九 的 0-5 级 + evidence 全缺）

---

## 6. 当前报告系统如何生成

### 6.1 日报（`dist/src/reports/daily-report.d.ts`）

`buildDailyReport(jobs: JobRecord[], profile: CareerProfile, date: string): DailyReport`
→ `writeReportBundle(report, outputRoot)`。

`DailyReport` 结构：`{date, generatedAt, collectedAt[], profileVersion, newJobs[],
recommendedJobs[], deadlineReminders[], sourceStatuses[], failures[], anomalies[]}`，
其中 `DailyReportJob = JobRecord & {matchScore, matchReasons}`，
`DeadlineReminder = DailyReportJob & {daysUntilDeadline}`。

**注意**：这是**岗位推荐日报**（新岗位 / 推荐 / 截止提醒 / 采集异常），
**不是市场需求统计**。用户 §七～§八 要求的技能频率、required/preferred 比例、
共现、分方向统计**完全不存在**。

### 6.2 静态站点（"求职情报站"）

- `templates/default/`：`index.html` (2018B) + `app.css` (13864B) + `app.js` (59704B)
- `buildSite({outputDir, jobs, generatedAt, selection})` →
  `{indexPath, assetPaths[], data}`；`embedSiteData(template, data)` 把数据**内嵌进 HTML**
  以便 `file://` 直接打开（无 CORS 问题）
- `SiteData = {generatedAt, jobs, selection?}`；
  `SiteSelection = {cities?, industries?, industrySuggestions?, shareIndustriesAcrossCities?,
  industriesByCity?}`
- `suggestIndustryClassifications(industries)` 返回 `{requested, suggested, reason}`
- 输出目录默认 `job-hunting-site`
- 交互：兴趣标记经 `exportInterestMarks(state, jobs)` →
  `InterestExport {records[], knownJobIds[], unknownIds[], updatedAt}` →
  `job_hunting_sync_interest` 回写 `data/interest-ledger.json`

**可复用**：`buildSite` / `embedSiteData` 的**自包含单文件站点模式**很适合承载用户 §15
的六块 Dashboard；`data.jobs` 已经是完整岗位数组，天然支持"点 68% 看是哪些岗位"的回溯需求。

### 6.3 Workspace 输出树（推断自上述路径常量）

```
<workspace>/
  profile/profile.json                  # 求职 profile（含 schemaVersion 迁移）
  data/jobs.json                        # 岗位池
  data/interest-ledger.json             # 兴趣标记
  job-hunting-site/                     # 静态站点
    index.html  app.css  app.js
  .job-hunting-manifest.json            # 桌面快捷方式归属清单
```

---

## 7. 为实现目标还缺少哪些模块

| 建议模块 | 现状 | 判定 |
| --- | --- | --- |
| **JobCategoryClassifier** | 无任何分类逻辑；`matcher` 只做关键词命中打分 | ❌ **全缺** |
| **JDParser** | **插件内部零 LLM 调用**（全仓库无 prompt、无缓存层）；`resume-assessor` 是确定性规则引擎（`assessor: 'baseline-deterministic'`），"智能"步骤全靠宿主 DSH agent 读 skill content 后自行完成；**无 JD 解析** | ❌ **全缺** |
| **SkillNormalizer** | 无技能概念 | ❌ **全缺** |
| **SkillTaxonomy** | 无 taxonomy 文件（`templates/` 下只有站点前端） | ❌ **全缺** |
| **MarketAnalyzer** | 无任何聚合统计 | ❌ **全缺** |
| **PersonalSkillProfile** | `CareerProfile` 只有 roles/locations/keywords，**无技能等级** | ❌ **全缺** |
| **GapAnalyzer** | `matcher.matchJob` 是单维岗位匹配分，非 Gap | ❌ **全缺** |
| **GoalPlanner** | 无 | ❌ **全缺** |
| **LearningRoadmap** | 无 | ❌ **全缺** |
| **MarketSnapshot** | 无历史快照概念；`daily-report` 每次覆盖式生成 | ❌ **全缺** |
| 岗位扩展搜索词 | 无；采集中 URL 完全由外部提供 | ❌ **全缺**（需自建，复用白名单校验） |
| 结构化薪资/经验/学历 | `salary?: string` 自由文本 | ⚠️ **需新增字段** |
| `last_seen_at` 增量去重 | `dedupeJobs` 丢弃重复，无时间戳更新 | ⚠️ **需新存储层** |
| LLM 成本缓存 | 无 JD 哈希/`analysisVersion`/`promptVersion` 缓存 | ❌ **全缺** |
| 数据可回溯 | `SiteData.jobs` 已是全量数组，**具备基础** | ⚠️ **需显式建立 skill→jobIds 索引** |

**可复用基座（不重写）**：只读 BrowserSkill 安全策略、Workspace 原子读写、
profile 版本化迁移、`normalizeJob` 的规范化规则、FNV-1a 哈希、确认门控范式、
自包含单文件站点模式、本地 JSON/Markdown 导入通道。

---

## 8. 结论与改造方案

**上游无 src，无法在源码上增量改造。** 采用方案：

> 新建同族插件 **`dsh-job-market`**（独立 DSH 插件、独立 TS 源码、独立测试），
> **复用**上游的数据约定（同一 Workspace、同一 `profile/profile.json`、同一 `data/jobs.json`、
> 同一站点输出目录）与安全设计（逐条复刻只读策略），
> **新增**用户 §二十 要求的全部 10 个模块，实现"采集→去重→结构化→标准化→市场统计→
> 能力画像→Gap→优先级→学习路线→动态调整"完整闭环。

好处：
1. 不改 `dist/` 产物 → 上游可继续合并，符合"不要为了重构而重构"
2. 与 `dsh-job-hunting` 共享同一 Workspace 数据 → 两个插件可并存协同
3. 全部新增模块有真实 TS 源码 → **可写单元测试**（上游 dist-only 无法测）
4. 保持 DSH plugin 结构（cordis 插件 + `dsh.bundle` + `tools`/`skills` 注入）
