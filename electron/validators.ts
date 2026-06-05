export type Validator<T> = (value: unknown) => value is T

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public value?: unknown,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ── Atomic type validators ───────────────────────────────────────────────

export function string(): Validator<string> {
  return (value): value is string => {
    if (typeof value !== 'string') {
      throw new ValidationError(`Expected string, got ${typeof value}`)
    }
    return true
  }
}

export function number(): Validator<number> {
  return (value): value is number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`Expected finite number, got ${typeof value}`)
    }
    return true
  }
}

export function boolean(): Validator<boolean> {
  return (value): value is boolean => {
    if (typeof value !== 'boolean') {
      throw new ValidationError(`Expected boolean, got ${typeof value}`)
    }
    return true
  }
}

export function object(): Validator<Record<string, unknown>> {
  return (value): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) {
      throw new ValidationError(`Expected object, got ${typeof value}`)
    }
    return true
  }
}

export function integer(): Validator<number> {
  return (value): value is number => {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`Expected integer, got ${value}`)
    }
    return true
  }
}

// ── String constraint validators ─────────────────────────────────────────

export function minLength(min: number): Validator<string> {
  return (value): value is string => {
    if (typeof value !== 'string') {
      throw new ValidationError(`Expected string, got ${typeof value}`)
    }
    if (value.length < min) {
      throw new ValidationError(`String length must be at least ${min}, got ${value.length}`)
    }
    return true
  }
}

export function maxLength(max: number): Validator<string> {
  return (value): value is string => {
    if (typeof value !== 'string') {
      throw new ValidationError(`Expected string, got ${typeof value}`)
    }
    if (value.length > max) {
      throw new ValidationError(`String length must be at most ${max}, got ${value.length}`)
    }
    return true
  }
}

export function length(min: number, max: number): Validator<string> {
  return and(minLength(min), maxLength(max))
}

// ── Number constraint validators ─────────────────────────────────────────

export function range(min: number, max: number): Validator<number> {
  return (value): value is number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`Expected finite number, got ${typeof value}`)
    }
    const n = value as number
    if (n < min || n > max) {
      throw new ValidationError(`Number must be between ${min} and ${max}, got ${n}`)
    }
    return true
  }
}

export function minValue(min: number): Validator<number> {
  return (value): value is number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`Expected finite number, got ${typeof value}`)
    }
    const n = value as number
    if (n < min) {
      throw new ValidationError(`Number must be >= ${min}, got ${n}`)
    }
    return true
  }
}

// ── Pattern validators ───────────────────────────────────────────────────

export function pattern(regex: RegExp, message?: string): Validator<string> {
  return (value): value is string => {
    const s = value as string
    if (!regex.test(s)) {
      throw new ValidationError(message || `String does not match pattern ${regex}`)
    }
    return true
  }
}

export function oneOf<T extends string | number>(allowed: readonly T[]): Validator<T> {
  return (value): value is T => {
    if (!allowed.includes(value as T)) {
      throw new ValidationError(`Value must be one of: ${allowed.join(', ')}`)
    }
    return true
  }
}

// ── Combinators ──────────────────────────────────────────────────────────

export function and<T>(...validators: Validator<T>[]): Validator<T> {
  return (value): value is T => {
    for (const validator of validators) {
      try {
        if (!validator(value)) return false
      } catch (err) {
        if (err instanceof ValidationError) return false
        throw err
      }
    }
    return true
  }
}

// ── Security validators ──────────────────────────────────────────────────

export function noControlChars(): Validator<string> {
  return (value): value is string => {
    const s = value as string
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(s)) {
      throw new ValidationError('String contains control characters')
    }
    return true
  }
}

export function noPathSeparators(): Validator<string> {
  return (value): value is string => {
    const s = value as string
    if (s.includes('/') || s.includes('\\')) {
      throw new ValidationError('String contains path separators')
    }
    return true
  }
}

export function noPathTraversal(): Validator<string> {
  return (value): value is string => {
    const s = value as string
    if (s.includes('..')) {
      throw new ValidationError('String contains path traversal characters')
    }
    return true
  }
}

export function absolutePath(): Validator<string> {
  return pattern(
    /^[a-zA-Z]:\\|^\\\\|^\//,
    'Path must be absolute (Windows drive, UNC, or Unix root)',
  )
}

// ── Tag blacklist validator ──────────────────────────────────────────────

export function tagBlacklist(): Validator<{ hcomic: string[]; moeimg: string[]; jmcomic: string[]; bika: string[] }> {
  return (value): value is { hcomic: string[]; moeimg: string[]; jmcomic: string[]; bika: string[] } => {
    if (typeof value !== 'object' || value === null) {
      throw new ValidationError('tagBlacklist must be an object')
    }
    const obj = value as Record<string, unknown>
    for (const key of ['hcomic', 'moeimg', 'jmcomic', 'bika']) {
      const arr = obj[key]
      if (!Array.isArray(arr)) {
        throw new ValidationError(`tagBlacklist.${key} must be an array`)
      }
      if (arr.length > 500) {
        throw new ValidationError(`tagBlacklist.${key} must not exceed 500 items`)
      }
      const seen = new Set<string>()
      for (const item of arr) {
        if (typeof item !== 'string' || item.length === 0 || item.length > 64) {
          throw new ValidationError(`tagBlacklist.${key} items must be non-empty strings, max 64 chars`)
        }
        const lower = item.toLowerCase()
        if (seen.has(lower)) {
          throw new ValidationError(`tagBlacklist.${key} contains duplicate: ${item}`)
        }
        seen.add(lower)
      }
    }
    return true
  }
}

// ── Assertion helper ─────────────────────────────────────────────────────

export function assert<T>(
  validator: Validator<T>,
  value: unknown,
  label: string,
): asserts value is T {
  try {
    if (!validator(value)) {
      throw new ValidationError(`Invalid ${label}`, label, value)
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new ValidationError(
        err.field ? `Invalid ${err.field}` : `Invalid ${label}`,
        err.field || label,
        err.value !== undefined ? err.value : value,
      )
    }
    throw err
  }
}