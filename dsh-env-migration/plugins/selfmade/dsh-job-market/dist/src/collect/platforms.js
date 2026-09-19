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
/* ============================================================================
 * 城市编码表
 * ==========================================================================*/
/** BOSS直聘城市编码（`city` 查询参数）。 */
const BOSS_CITY_CODES = {
    北京: '101010100',
    上海: '101020100',
    广州: '101280100',
    深圳: '101280600',
    杭州: '101210100',
    南京: '101190100',
    苏州: '101190400',
    成都: '101270100',
    武汉: '101200100',
    西安: '101110100',
    天津: '101030100',
    重庆: '101040100',
    长沙: '101250100',
    郑州: '101180100',
    青岛: '101120200',
    合肥: '101220100',
    宁波: '101210400',
    东莞: '101281600',
    佛山: '101280800',
    无锡: '101190200',
};
/** 智联招聘城市编码（`jl` 查询参数）。 */
const ZHILIAN_CITY_CODES = {
    北京: '530',
    上海: '538',
    广州: '763',
    深圳: '765',
    杭州: '653',
    南京: '635',
    苏州: '639',
    成都: '801',
    武汉: '736',
    西安: '854',
    天津: '531',
    重庆: '551',
};
/* ============================================================================
 * 平台定义
 * ==========================================================================*/
const PHASE_ONE_NOTE = '一期 MVP（需求 §十九）只启用 BOSS直聘 / 猎聘 / 智联招聘；本平台待二期再开启只读采集。';
const BOSS_NOTES = [
    'BOSS直聘部分列表页需要登录后才可翻页；出现登录/CAPTCHA 立即停止该平台并转人工（需求 §十八）。',
    PHASE_ONE_NOTE,
].join(' ');
const LIEPIN_NOTES = [
    '猎聘 `city` 参数使用平台城市名（如 shrp 之外的常规写法），缺编码时规划器回退为城市名直拼。',
    PHASE_ONE_NOTE,
].join(' ');
const ZHILIAN_NOTES = [
    '智联招聘搜索主机名为 sou.zhaopin.com，与展示主机名 www.zhaopin.com 不同；白名单额外登记 sou.zhaopin.com。',
    PHASE_ONE_NOTE,
].join(' ');
/** 五个站点的只读定义。顺序即默认采集顺序。 */
export const PLATFORMS = [
    {
        id: 'boss',
        name: 'BOSS直聘',
        hostname: 'www.zhipin.com',
        // 占位符：{keyword} 关键词、{city} 城市编码或城市名、{page} 页码。
        search_url_template: 'https://www.zhipin.com/web/geek/job?query={keyword}&city={city}&page={page}',
        city_codes: BOSS_CITY_CODES,
        enabled: true,
        notes: BOSS_NOTES,
    },
    {
        id: 'liepin',
        name: '猎聘',
        hostname: 'www.liepin.com',
        search_url_template: 'https://www.liepin.com/zhaopin/?key={keyword}&city={city}&curPage={page}',
        enabled: true,
        notes: LIEPIN_NOTES,
    },
    {
        id: 'zhilian',
        name: '智联招聘',
        hostname: 'www.zhaopin.com',
        search_url_template: 'https://sou.zhaopin.com/?kw={keyword}&jl={city}&p={page}',
        city_codes: ZHILIAN_CITY_CODES,
        enabled: true,
        notes: ZHILIAN_NOTES,
    },
    {
        id: '51job',
        name: '前程无忧',
        hostname: 'www.51job.com',
        search_url_template: 'https://www.51job.com/pc/search?keyword={keyword}&jobArea={city}&pageNum={page}',
        enabled: false,
        notes: ['前程无忧搜索页参数随站点改版频繁，一期不启用以免误采到非岗位页面。', PHASE_ONE_NOTE].join(' '),
    },
    {
        id: 'iguopin',
        name: '国聘',
        hostname: 'www.iguopin.com',
        search_url_template: 'https://www.iguopin.com/job?keyword={keyword}&city={city}&page={page}',
        enabled: false,
        notes: ['国聘以校招/央企岗位为主，与社招机器人岗位统计口径差异较大，一期不启用。', PHASE_ONE_NOTE].join(' '),
    },
];
/** 按平台 ID 查询定义。未登记的平台返回 undefined。 */
export const getPlatform = (id) => PLATFORMS.find((platform) => platform.id === id);
/** 当前启用的平台列表（一期为 BOSS / 猎聘 / 智联）。 */
export const enabledPlatforms = () => PLATFORMS.filter((platform) => platform.enabled);
/**
 * 把浏览器采集到的原始记录转成岗位池输入。
 *
 * 采集层刻意不认识 `Job`：它只负责「把页面上看到的东西念出来」，
 * 归一化（薪资/经验/地点解析、技能抽取、去重键）全部留给 JobStore，
 * 这样采集适配器与数据模型可以各自演化而不会互相污染。
 */
export const rawJobRecordsToInputs = (records, source, collectedAt) => records.map((record) => {
    const input = {
        source,
        job_title: record.job_title,
        company: record.company,
    };
    if (record.location !== undefined)
        input.location = record.location;
    if (record.salary_text !== undefined)
        input.salary_text = record.salary_text;
    if (record.url !== undefined)
        input.url = record.url;
    if (record.source_job_id !== undefined)
        input.source_job_id = record.source_job_id;
    if (record.publish_time !== undefined)
        input.publish_time = record.publish_time;
    if (collectedAt !== undefined)
        input.collected_at = collectedAt;
    return input;
});
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** 取第一个非空字符串字段（支持 camelCase 与 snake_case 别名）。 */
const firstString = (raw, keys) => {
    for (const key of keys) {
        const value = raw[key];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed !== '')
                return trimmed;
        }
    }
    return undefined;
};
/** 取出候选岗位数组：优先 `visibleJobs`，退化到 `jobs`。 */
const readJobArray = (payload) => {
    const candidates = [payload.visibleJobs, payload.jobs];
    for (const candidate of candidates) {
        if (Array.isArray(candidate))
            return candidate;
    }
    return [];
};
const toRawJobRecord = (entry) => {
    if (!isRecord(entry))
        return undefined;
    const jobTitle = firstString(entry, ['title', 'job_title', 'jobTitle']);
    const company = firstString(entry, ['company', 'companyName', 'company_name']);
    // 缺职位名或公司名的条目无法参与统计，直接跳过（而非抛出）。
    if (jobTitle === undefined || company === undefined)
        return undefined;
    const record = { job_title: jobTitle, company };
    const location = firstString(entry, ['location', 'city', 'jobArea', 'area']);
    if (location !== undefined)
        record.location = location;
    const salaryText = firstString(entry, ['salary', 'salary_text', 'salaryText']);
    if (salaryText !== undefined)
        record.salary_text = salaryText;
    const url = firstString(entry, ['url', 'link', 'href', 'jobUrl', 'job_url']);
    if (url !== undefined)
        record.url = url;
    const sourceJobId = firstString(entry, ['jobId', 'job_id', 'source_job_id', 'id']);
    if (sourceJobId !== undefined)
        record.source_job_id = sourceJobId;
    const publishTime = firstString(entry, ['publishTime', 'publish_time', 'publishDate', 'updateTime']);
    if (publishTime !== undefined)
        record.publish_time = publishTime;
    return record;
};
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
export const parseListingPayload = (platformId, payload) => {
    try {
        if (getPlatform(platformId) === undefined)
            return [];
        if (!isRecord(payload))
            return [];
        const records = [];
        for (const entry of readJobArray(payload)) {
            const record = toRawJobRecord(entry);
            if (record !== undefined)
                records.push(record);
        }
        return records;
    }
    catch {
        return [];
    }
};
//# sourceMappingURL=platforms.js.map