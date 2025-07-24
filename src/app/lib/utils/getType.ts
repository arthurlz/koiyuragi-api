// 定义可能的返回类型
type GetTypeResult =
  | 'Array'
  | 'Null'
  | 'Object'
  | 'string'
  | 'number'
  | 'bigint'
  | 'boolean'
  | 'symbol'
  | 'undefined'
  | 'function'

/**
 * 返回值类型：GetTypeResult
 * @param value 任何值
 */
export function getType(value: unknown): GetTypeResult {
  if (value === null) {
    return 'Null'
  }
  if (Array.isArray(value)) {
    return 'Array'
  }
  const t = typeof value
  if (t === 'object') {
    return 'Object'
  }
  return t as GetTypeResult
}
