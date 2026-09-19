/**
 * dsh-job-market — 默认技能体系（Skill Taxonomy）。
 *
 * 这是系统最重要的数据资产：把 JD 里千奇百怪的写法映射到规范技能。
 *
 * 设计约束（与 `src/taxonomy/skill-normalizer.ts` 的匹配器严格对齐）：
 *  - 别名匹配 **最长优先 + 不重叠**：`C++17` 命中 `cpp17`，不会被 `cpp`/`c` 吞掉；
 *    `ROS 2` 命中 `ros2`，不会被 `ros` 吞掉。
 *  - **纯 ASCII 别名需要词边界**（左右不能是字母/数字/`+`/`#`/`.`/`_`），
 *    因此 `c` 不会匹配到 `C++` 内部；中文别名按子串匹配。
 *  - `implies` 会 **传递展开**（带环保护），所以 `cpp17` 最终得到
 *    `cpp17` + `cpp` + `modern-cpp` 三个技能。
 *  - `validateTaxonomy` 会把 `name` 与 `id` 自动并入 `aliases`，因此
 *    `name` 也是别名：不要把 name 写成 `go`/`r`/`d` 这类常见英文单词。
 *  - 全部别名保持小写；不要制造会大量误命中的短别名（如裸 `can`、裸 `make`、裸 `ros2` 之外的歧义串）。
 *
 * 维护方式：本文件是「内置默认体系」，工作区可用
 * `taxonomy/skill-taxonomy.json` 按 id 覆盖/追加（见 `mergeTaxonomies`）。
 */
import type { SkillTaxonomy } from '../shared/types.js';
/** 默认技能体系版本号；修改技能/别名/implies 关系时应递增。 */
export declare const DEFAULT_TAXONOMY_VERSION = 1;
export declare const DEFAULT_TAXONOMY: SkillTaxonomy;
