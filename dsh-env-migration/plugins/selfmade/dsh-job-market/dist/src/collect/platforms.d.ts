/**
 * 招聘平台定义表 + 列表页原始数据解析。
 *
 * 设计约束（需求 §三 / §十八）：
 *  - `search_url_template` 一律 HTTPS，且主机名必须与只读白名单中的精确主机名一致；
 *  - 模板只包含 **公开搜索页**，绝不包含投递、登录、简历等写入式路径；
 *  - `enabled` 体现需求 §十九 的 MVP 分期：一期只启用 BOSS / 猎聘 / 智联，
 *    51job / 国聘 先录入定义但置为 false。
 *
 * 解析函数 `parseListingPayload` 是纯函数：不抛异常、不做网络访问，
 * 只把「只读浏览器快照」的 payload 归一化为 `RawJobRecord[]`。
 */
import type { JobInput, PlatformDefinition, JobSource } from '../shared/types.js';
/** 五个站点的只读定义。顺序即默认采集顺序。 */
export declare const PLATFORMS: readonly PlatformDefinition[];
/** 按平台 ID 查询定义。未登记的平台返回 undefined。 */
export declare const getPlatform: (id: JobSource) => PlatformDefinition | undefined;
/** 当前启用的平台列表（一期为 BOSS / 猎聘 / 智联）。 */
export declare const enabledPlatforms: () => PlatformDefinition[];
/** 平台无关的岗位原始记录，交给 JobStore 做归一化与去重。 */
export interface RawJobRecord {
    job_title: string;
    company: string;
    location?: string;
    salary_text?: string;
    url?: string;
    source_job_id?: string;
    publish_time?: string;
}
/**
 * 把浏览器采集到的原始记录转成岗位池输入。
 *
 * 采集层刻意不认识 `Job`：它只负责「把页面上看到的东西念出来」，
 * 归一化（薪资/经验/地点解析、技能抽取、去重键）全部留给 JobStore，
 * 这样采集适配器与数据模型可以各自演化而不会互相污染。
 */
export declare const rawJobRecordsToInputs: (records: readonly RawJobRecord[], source: JobSource, collectedAt?: string) => JobInput[];
/**
 * 站点相关的列表页原始 payload 解析。
 *
 * payload 形状 = 只读浏览器快照的输出：
 * `{ visibleJobs?: [{ title, company, location, url, salary, publishTime, jobId }] }`
 * 或等价的 `jobs` 数组。
 *
 * 未知平台或畸形 payload 一律返回 `[]`，**永不抛出**：
 * 采集层宁可少收数据，也不允许因解析异常而进入未知站点路径。
 */
export declare const parseListingPayload: (platformId: JobSource, payload: unknown) => RawJobRecord[];
