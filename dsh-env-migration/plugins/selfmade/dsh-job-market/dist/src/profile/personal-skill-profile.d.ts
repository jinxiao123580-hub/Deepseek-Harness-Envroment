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
import type { PersonalSkillProfile, PersonalSkill, PersonalSkillSuggestion, SkillEvidence, SkillLevel, JobCategory, Iso } from '../shared/types.js';
/** 个人画像在工作区中的相对路径（`<outputDir>/profile/personal-skills.json`）。 */
export declare const PERSONAL_PROFILE_PATH = "profile/personal-skills.json";
/** 画像 schema 版本；结构发生不兼容变化时递增。 */
export declare const PERSONAL_PROFILE_SCHEMA_VERSION = 1;
/** 等级的可读中文标签，例如 3 → `可以独立完成项目`。 */
export declare const skillLevelLabel: (level: SkillLevel) => string;
/** 构造一个空画像（可带目标方向 / 目标岗位）。 */
export declare const emptyPersonalProfile: (init?: {
    target_categories?: JobCategory[];
    target_roles?: string[];
}) => PersonalSkillProfile;
/**
 * 校验 + 归一化从磁盘读入的画像。
 * 非破坏性：`undefined` / 垃圾输入返回合法空画像；已知字段被归一化；
 * 输入对象（以及每个 skill 条目）上的未知键全部原样保留。
 */
export declare const migratePersonalProfile: (input: unknown) => PersonalSkillProfile;
/**
 * 设置用户确认的技能等级。
 * `source` 变为 `'user'`，`confidence` 恒为 1，`last_updated` 用注入的 `now`。
 */
export declare const setSkillLevel: (profile: PersonalSkillProfile, input: {
    skill_id: string;
    current_level?: SkillLevel;
    target_level?: SkillLevel;
    evidence?: readonly SkillEvidence[];
    note?: string;
    now?: Iso;
}) => PersonalSkillProfile;
/** 从已确认画像中移除某项技能（纯函数）。 */
export declare const removeSkill: (profile: PersonalSkillProfile, skillId: string) => PersonalSkillProfile;
/**
 * 记录一条 AI 推断的建议。
 * 只写入 `pending_suggestions`，**绝不修改 `skills`**，因此不影响 Gap 计算。
 * 同一 `skill_id` 重复建议时以最新一条为准（保留原顺序）。
 */
export declare const suggestSkill: (profile: PersonalSkillProfile, suggestion: Omit<PersonalSkillSuggestion, 'created_at'> & {
    now?: Iso;
}) => PersonalSkillProfile;
/**
 * 用户显式确认后，把一条待确认建议提升为已确认技能。
 * `confirmed !== true` 时抛 `TypeError`（中文提示）；成功后该建议从 `pending_suggestions` 移除。
 */
export declare const confirmSuggestion: (profile: PersonalSkillProfile, input: {
    skill_id: string;
    /** 必须为 true：缺少显式确认一律拒绝。 */
    confirmed: boolean;
    current_level?: SkillLevel;
    target_level?: SkillLevel;
    now?: Iso;
}) => PersonalSkillProfile;
/**
 * 可参与 Gap 分析的技能：仅用户确认过的条目。
 * `pending_suggestions` 与任何 `source !== 'user'` 的条目一律排除。
 */
export declare const confirmedSkills: (profile: PersonalSkillProfile) => PersonalSkill[];
/** 生成给提示词 / 报告用的紧凑中文摘要。 */
export declare const summarizeProfile: (profile: PersonalSkillProfile) => string;
