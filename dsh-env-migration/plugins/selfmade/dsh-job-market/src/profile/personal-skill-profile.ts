/**
 * personal-skill-profile —— 个人能力画像（需求 §九）
 *
 * 铁律（对应用户硬约束）：
 *  1. AI 绝不能自行认定用户「已掌握」某项技能。任何 AI 推断只能写成
 *     `PersonalSkillSuggestion` 放进 `pending_suggestions`，**不得**写入 `skills`，
 *     因此**绝不参与 Gap 计算**；只有用户在 `confirmSuggestion({ confirmed: true })`
 *     显式确认后，才转成 `source: 'user'`、`confidence: 1` 的 `PersonalSkill`。
 *  2. 本文件所有函数均为纯函数：只返回新对象，绝不修改入参。
 *  3. `migratePersonalProfile` 非破坏性：接受 `undefined` / 垃圾数据并返回合法空画像，
 *     同时把输入对象上未知的键原样透传（对齐上游项目的非破坏性迁移哲学）。
 */

import type {
    PersonalSkillProfile,
    PersonalSkill,
    PersonalSkillSuggestion,
    SkillEvidence,
    SkillLevel,
    JobCategory,
    Iso,
} from '../shared/types.js';

/** 个人画像在工作区中的相对路径（`<outputDir>/profile/personal-skills.json`）。 */
export const PERSONAL_PROFILE_PATH = 'profile/personal-skills.json';

/** 画像 schema 版本；结构发生不兼容变化时递增。 */
export const PERSONAL_PROFILE_SCHEMA_VERSION = 1;

/* ============================================================================
 * 技能等级（0..5）
 * ==========================================================================*/

/** 等级语义（需求 §九 原文）。 */
const SKILL_LEVEL_LABELS: readonly string[] = [
    '完全不会',
    '知道基本概念',
    '做过 Demo',
    '可以独立完成项目',
    '熟练解决实际问题',
    '深入掌握，可以处理复杂工程问题',
];

const SKILL_LEVEL_MIN = 0;
const SKILL_LEVEL_MAX = 5;

/** 等级的可读中文标签，例如 3 → `可以独立完成项目`。 */
export const skillLevelLabel = (level: SkillLevel): string =>
    SKILL_LEVEL_LABELS[level] ?? SKILL_LEVEL_LABELS[SKILL_LEVEL_MIN] ?? '完全不会';

/** 兼容旧数据：宽松读取运行期可能出现的非法等级（迁移用，不抛错）。 */
const safeLevelLabel = (level: unknown): string => skillLevelLabel(coerceLevel(level));

/**
 * 严格校验等级：必须是 0..5 的整数，否则抛 `TypeError`（中文提示）。
 * 用于所有**用户输入**路径，保证用户不会意外写入脏数据。
 */
const assertSkillLevel = (value: unknown, field: string): SkillLevel => {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isInteger(numeric) || numeric < SKILL_LEVEL_MIN || numeric > SKILL_LEVEL_MAX) {
        throw new TypeError(
            `技能等级 ${field} 无效：${String(value)}。必须是 ${SKILL_LEVEL_MIN}..${SKILL_LEVEL_MAX} 的整数` +
                `（0=完全不会 1=知道基本概念 2=做过 Demo 3=可以独立完成项目 4=熟练解决实际问题 5=深入掌握，可以处理复杂工程问题）。`,
        );
    }
    return numeric as SkillLevel;
};

/** 宽松读取等级：仅用于磁盘迁移。合法整数夹取到 0..5，其余一律视为 0（绝不抛错）。 */
const coerceLevel = (value: unknown): SkillLevel => {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(numeric)) return 0;
    const rounded = Math.round(numeric);
    if (rounded < SKILL_LEVEL_MIN) return 0;
    if (rounded > SKILL_LEVEL_MAX) return 5;
    return rounded as SkillLevel;
};

/** 归一化任意文本数组。 */
const toStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (trimmed !== '') result.push(trimmed);
    }
    return result;
};

/** 取注入的 `now`，缺省用当前时间。 */
const resolveNow = (value: unknown): Iso =>
    typeof value === 'string' && value.trim() !== '' ? value : new Date().toISOString();

/** 浅拷贝 skill 记录，保留未知键（非破坏性）。 */
const cloneSkillRecord = (raw: unknown): Record<string, PersonalSkill> => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Record<string, PersonalSkill> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
        result[key] = normalizeSkill(value, key);
    }
    return result;
};

/**
 * 归一化单条已确认技能：等级夹取到 0..5，`confidence` 归一到 0..1，
 * `source` 只允许 `'user'` / `'ai-suggested'`（缺省按用户确认处理，保持既有语义）。
 * 未知键原样保留。
 */
const normalizeSkill = (value: unknown, key: string): PersonalSkill => {
    const record = value as Record<string, unknown>;
    const skillId = typeof record.skill_id === 'string' && record.skill_id.trim() !== '' ? record.skill_id.trim() : key;
    const currentLevel = coerceLevel(record.current_level);
    const targetLevel = coerceLevel(record.target_level);
    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? clampUnit(record.confidence)
        : 1;
    return {
        ...(record as unknown as PersonalSkill),
        skill_id: skillId,
        current_level: currentLevel,
        // 已确认技能的目标等级不得低于当前等级。
        target_level: targetLevel < currentLevel ? currentLevel : targetLevel,
        evidence: normalizeEvidence(record.evidence),
        last_updated: resolveNow(record.last_updated),
        confidence,
        source: record.source === 'ai-suggested' ? 'ai-suggested' : 'user',
    };
};

/** 夹取到 0..1。 */
const clampUnit = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 归一化单条证据。 */
const normalizeEvidence = (value: unknown): SkillEvidence[] => {
    if (!Array.isArray(value)) return [];
    const result: SkillEvidence[] = [];
    for (const item of value) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
        result.push({ ...(item as SkillEvidence) });
    }
    return result;
};

/** 归一化单条待确认建议。 */
const normalizeSuggestion = (value: unknown): PersonalSkillSuggestion | undefined => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const skillId = typeof record.skill_id === 'string' ? record.skill_id.trim() : '';
    if (skillId === '') return undefined;
    return {
        ...(record as unknown as PersonalSkillSuggestion),
        skill_id: skillId,
        suggested_level: coerceLevel(record.suggested_level),
        reason: typeof record.reason === 'string' ? record.reason : '',
        evidence: normalizeEvidence(record.evidence),
        created_at: resolveNow(record.created_at),
    };
};

/* ============================================================================
 * 构造 / 迁移
 * ==========================================================================*/

/** 构造一个空画像（可带目标方向 / 目标岗位）。 */
export const emptyPersonalProfile = (init?: {
    target_categories?: JobCategory[];
    target_roles?: string[];
}): PersonalSkillProfile => ({
    schemaVersion: PERSONAL_PROFILE_SCHEMA_VERSION,
    updated_at: '',
    skills: {},
    pending_suggestions: [],
    target_categories: init?.target_categories !== undefined ? [...init.target_categories] : [],
    target_roles: init?.target_roles !== undefined ? [...init.target_roles] : [],
});

/**
 * 校验 + 归一化从磁盘读入的画像。
 * 非破坏性：`undefined` / 垃圾输入返回合法空画像；已知字段被归一化；
 * 输入对象（以及每个 skill 条目）上的未知键全部原样保留。
 */
export const migratePersonalProfile = (input: unknown): PersonalSkillProfile => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return emptyPersonalProfile();
    }
    const raw = input as Record<string, unknown>;
    const rawSkills = raw.skills;
    const rawSuggestions = raw.pending_suggestions;
    const rawCategories = raw.target_categories;
    const rawRoles = raw.target_roles;

    // 先用展开保留未知键，再用归一化值覆盖已知键。
    return {
        ...raw,
        schemaVersion: PERSONAL_PROFILE_SCHEMA_VERSION,
        updated_at: resolveNow(raw.updated_at),
        skills: cloneSkillRecord(rawSkills),
        pending_suggestions: Array.isArray(rawSuggestions)
            ? rawSuggestions
                  .map((item) => normalizeSuggestion(item))
                  .filter((item): item is PersonalSkillSuggestion => item !== undefined)
            : [],
        target_categories: toStringArray(rawCategories) as JobCategory[],
        target_roles: toStringArray(rawRoles),
    };
};

/* ============================================================================
 * 用户确认路径（唯一能改变 `skills` 的入口）
 * ==========================================================================*/

/**
 * 设置用户确认的技能等级。
 * `source` 变为 `'user'`，`confidence` 恒为 1，`last_updated` 用注入的 `now`。
 */
export const setSkillLevel = (
    profile: PersonalSkillProfile,
    input: {
        skill_id: string;
        current_level?: SkillLevel;
        target_level?: SkillLevel;
        evidence?: readonly SkillEvidence[];
        note?: string;
        now?: Iso;
    },
): PersonalSkillProfile => {
    const skillId = typeof input.skill_id === 'string' ? input.skill_id.trim() : '';
    if (skillId === '') {
        throw new TypeError('技能 ID 不能为空：setSkillLevel 需要合法的 skill_id。');
    }
    const existing = profile.skills[skillId];
    const currentLevel =
        input.current_level === undefined
            ? coerceLevel(existing?.current_level)
            : assertSkillLevel(input.current_level, 'current_level');

    // target_level 缺省等于 current_level；且不得低于 current_level
    // （用户自评等级提高时，若原目标更低，则自动抬升到 current_level）。
    let targetLevel: SkillLevel;
    if (input.target_level === undefined) {
        targetLevel = currentLevel;
    } else {
        const requested = assertSkillLevel(input.target_level, 'target_level');
        targetLevel = requested < currentLevel ? currentLevel : requested;
    }

    const now = resolveNow(input.now);
    const evidence =
        input.evidence !== undefined ? input.evidence.map((item) => ({ ...item })) : (existing?.evidence ?? []);
    const note = input.note !== undefined ? input.note : existing?.note;

    const next: PersonalSkill = {
        ...(existing ?? {}),
        skill_id: skillId,
        current_level: currentLevel,
        target_level: targetLevel,
        evidence,
        last_updated: now,
        confidence: 1,
        source: 'user',
    };
    if (note !== undefined) next.note = note;

    return {
        ...profile,
        updated_at: now,
        skills: { ...profile.skills, [skillId]: next },
    };
};

/** 从已确认画像中移除某项技能（纯函数）。 */
export const removeSkill = (profile: PersonalSkillProfile, skillId: string): PersonalSkillProfile => {
    const key = typeof skillId === 'string' ? skillId.trim() : '';
    if (key !== '' && Object.prototype.hasOwnProperty.call(profile.skills, key)) {
        const nextSkills = { ...profile.skills };
        delete nextSkills[key];
        return {
            ...profile,
            updated_at: new Date().toISOString(),
            skills: nextSkills,
        };
    }
    return { ...profile, skills: { ...profile.skills } };
};

/* ============================================================================
 * AI 建议路径（绝不触碰 `skills`）
 * ==========================================================================*/

/**
 * 记录一条 AI 推断的建议。
 * 只写入 `pending_suggestions`，**绝不修改 `skills`**，因此不影响 Gap 计算。
 * 同一 `skill_id` 重复建议时以最新一条为准（保留原顺序）。
 */
export const suggestSkill = (
    profile: PersonalSkillProfile,
    suggestion: Omit<PersonalSkillSuggestion, 'created_at'> & { now?: Iso },
): PersonalSkillProfile => {
    const skillId = typeof suggestion.skill_id === 'string' ? suggestion.skill_id.trim() : '';
    if (skillId === '') {
        throw new TypeError('技能 ID 不能为空：suggestSkill 需要合法的 skill_id。');
    }
    const suggestedLevel = assertSkillLevel(suggestion.suggested_level, 'suggested_level');
    const now = resolveNow((suggestion as { now?: unknown }).now);

    const entry: PersonalSkillSuggestion = {
        skill_id: skillId,
        suggested_level: suggestedLevel,
        reason: typeof suggestion.reason === 'string' ? suggestion.reason : '',
        evidence: Array.isArray(suggestion.evidence)
            ? suggestion.evidence.map((item) => ({ ...item }))
            : [],
        created_at: now,
    };

    const kept = profile.pending_suggestions.filter((item) => item.skill_id !== skillId);

    // 显式只动 pending_suggestions 与 updated_at：skills 原样带过。
    return {
        ...profile,
        updated_at: now,
        skills: { ...profile.skills },
        pending_suggestions: [...kept, entry],
    };
};

/**
 * 用户显式确认后，把一条待确认建议提升为已确认技能。
 * `confirmed !== true` 时抛 `TypeError`（中文提示）；成功后该建议从 `pending_suggestions` 移除。
 */
export const confirmSuggestion = (
    profile: PersonalSkillProfile,
    input: {
        skill_id: string;
        /** 必须为 true：缺少显式确认一律拒绝。 */
        confirmed: boolean;
        current_level?: SkillLevel;
        target_level?: SkillLevel;
        now?: Iso;
    },
): PersonalSkillProfile => {
    if (input === null || typeof input !== 'object' || input.confirmed !== true) {
        throw new TypeError(
            '确认技能建议必须显式传入 confirmed: true：AI 建议不得自动生效，只有用户明确确认后才能写入个人能力画像。',
        );
    }
    const skillId = typeof input.skill_id === 'string' ? input.skill_id.trim() : '';
    if (skillId === '') {
        throw new TypeError('技能 ID 不能为空：confirmSuggestion 需要合法的 skill_id。');
    }

    const pending = profile.pending_suggestions.find((item) => item.skill_id === skillId);
    if (pending === undefined) {
        throw new TypeError(
            `未找到技能 ${skillId} 的待确认建议：只有存在于 pending_suggestions 中的 AI 建议才能被确认。`,
        );
    }

    // 用户可覆盖 AI 建议的等级。
    const currentLevel =
        input.current_level === undefined
            ? coerceLevel(pending.suggested_level)
            : assertSkillLevel(input.current_level, 'current_level');
    const targetLevel =
        input.target_level === undefined ? currentLevel : assertSkillLevel(input.target_level, 'target_level');
    const effectiveTarget = targetLevel < currentLevel ? currentLevel : targetLevel;

    const now = resolveNow(input.now);
    const existing = profile.skills[skillId];
    const next: PersonalSkill = {
        ...(existing ?? {}),
        skill_id: skillId,
        current_level: currentLevel,
        target_level: effectiveTarget,
        evidence: pending.evidence.map((item) => ({ ...item })),
        last_updated: now,
        confidence: 1,
        source: 'user',
    };
    if (existing?.note !== undefined) next.note = existing.note;

    return {
        ...profile,
        updated_at: now,
        skills: { ...profile.skills, [skillId]: next },
        pending_suggestions: profile.pending_suggestions.filter((item) => item.skill_id !== skillId),
    };
};

/* ============================================================================
 * 查询 / 摘要
 * ==========================================================================*/

/**
 * 可参与 Gap 分析的技能：仅用户确认过的条目。
 * `pending_suggestions` 与任何 `source !== 'user'` 的条目一律排除。
 */
export const confirmedSkills = (profile: PersonalSkillProfile): PersonalSkill[] => {
    const skills = profile.skills ?? {};
    return Object.values(skills)
        .filter((skill): skill is PersonalSkill => skill !== null && typeof skill === 'object')
        .filter((skill) => skill.source === 'user')
        .sort((a, b) => {
            const left = a.skill_id ?? '';
            const right = b.skill_id ?? '';
            return left < right ? -1 : left > right ? 1 : 0;
        })
        .map((skill) => ({ ...skill }));
};

/** 生成给提示词 / 报告用的紧凑中文摘要。 */
export const summarizeProfile = (profile: PersonalSkillProfile): string => {
    const skills = confirmedSkills(profile);
    const categories = Array.from(new Set(profile.target_categories ?? []));
    const roles = Array.from(new Set(profile.target_roles ?? []));
    const pending = Array.isArray(profile.pending_suggestions) ? profile.pending_suggestions.length : 0;

    const scope =
        categories.length === 0 && roles.length === 0
            ? '未设置'
            : [
                  categories.length === 0 ? '' : `方向 ${categories.slice(0, 6).join('、')}`,
                  roles.length === 0 ? '' : `岗位 ${roles.slice(0, 6).join('、')}`,
              ]
                  .filter((part) => part !== '')
                  .join('；');

    const lines = [
        `个人能力画像（schema v${PERSONAL_PROFILE_SCHEMA_VERSION}）：已确认技能 ${skills.length} 项，待确认的 AI 建议 ${pending} 条（不参与 Gap 计算）。`,
        `目标：${scope}。`,
    ];

    if (skills.length === 0) {
        lines.push('已确认技能：暂无。请先自评等级，或用 AI 建议后逐条确认。');
    } else {
        const parts = skills.map(
            (skill) =>
                `${skill.skill_id} ${safeLevelLabel(skill.current_level)}（${coerceLevel(skill.current_level)}级）` +
                `→目标 ${safeLevelLabel(skill.target_level)}（${coerceLevel(skill.target_level)}级）`,
        );
        lines.push(`已确认技能：${parts.join('；')}。`);
    }

    if (pending > 0) {
        const ids = profile.pending_suggestions
            .slice(0, 8)
            .map((item) => `${item.skill_id}(${coerceLevel(item.suggested_level)}级)`);
        lines.push(`待用户确认的 AI 建议：${ids.join('、')}${pending > 8 ? ' 等' : ''}。`);
    }

    if (typeof profile.updated_at === 'string' && profile.updated_at !== '') {
        lines.push(`最近更新：${profile.updated_at}。`);
    }
    return lines.join('\n');
};
