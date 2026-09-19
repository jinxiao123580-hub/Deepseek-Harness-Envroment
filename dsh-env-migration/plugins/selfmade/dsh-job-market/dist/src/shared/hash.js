/**
 * 稳定哈希工具。
 *
 * `fnv1a32` 与上游 `dsh-job-hunting/dist/src/domain/job-ledger.js` 的 `hashString`
 * 使用完全相同的算法（FNV-1a 32 位 → base36），以保证两个插件对同一身份键
 * 产生相同后缀，便于互操作与人工核对。
 */
/** FNV-1a 32 位哈希，输出 base36 字符串。 */
export const fnv1a32 = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};
/** 带命名空间前缀的哈希，避免不同用途的同串碰撞（如 jd 与 job）。 */
export const scopedHash = (namespace, value) => `${namespace}-${fnv1a32(`${namespace}\u0000${value}`)}`;
/**
 * 键序稳定的 JSON 序列化，用于对对象求哈希。
 * 只处理 JSON 可表示的值；`undefined` 属性被跳过。
 */
export const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
};
/** 对任意 JSON 值求稳定哈希。 */
export const hashValue = (namespace, value) => scopedHash(namespace, stableStringify(value));
/** 取内容前 N 个字符 + 全量哈希，便于日志中显示可读标识。 */
export const shortHash = (value, prefixLength = 8) => `${value.slice(0, prefixLength)}…${fnv1a32(value)}`;
//# sourceMappingURL=hash.js.map