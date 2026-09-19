/**
 * 稳定哈希工具。
 *
 * `fnv1a32` 与上游 `dsh-job-hunting/dist/src/domain/job-ledger.js` 的 `hashString`
 * 使用完全相同的算法（FNV-1a 32 位 → base36），以保证两个插件对同一身份键
 * 产生相同后缀，便于互操作与人工核对。
 */
/** FNV-1a 32 位哈希，输出 base36 字符串。 */
export declare const fnv1a32: (value: string) => string;
/** 带命名空间前缀的哈希，避免不同用途的同串碰撞（如 jd 与 job）。 */
export declare const scopedHash: (namespace: string, value: string) => string;
/**
 * 键序稳定的 JSON 序列化，用于对对象求哈希。
 * 只处理 JSON 可表示的值；`undefined` 属性被跳过。
 */
export declare const stableStringify: (value: unknown) => string;
/** 对任意 JSON 值求稳定哈希。 */
export declare const hashValue: (namespace: string, value: unknown) => string;
/** 取内容前 N 个字符 + 全量哈希，便于日志中显示可读标识。 */
export declare const shortHash: (value: string, prefixLength?: number) => string;
