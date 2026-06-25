// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  string, number, boolean, object, integer,
  minLength, maxLength, length, range, minValue,
  pattern, oneOf,
  and,
  noControlChars, noPathSeparators, noPathTraversal, absolutePath,
  tagBlacklist,
  duplicateBlacklist,
  missingBlacklist,
  assert,
  withOptionalSource,
  ValidationError,
} from '../../../electron/validators'

describe('validators.ts', () => {
  describe('atomic type validators', () => {
    it('string() passes for strings', () => {
      expect(string()('hello')).toBe(true)
    })

    it('string() throws for non-strings', () => {
      expect(() => string()(123)).toThrow(ValidationError)
      expect(() => string()(null)).toThrow(ValidationError)
      expect(() => string()(undefined)).toThrow(ValidationError)
    })

    it('number() passes for finite numbers', () => {
      expect(number()(42)).toBe(true)
      expect(number()(0)).toBe(true)
      expect(number()(-3.14)).toBe(true)
    })

    it('number() rejects NaN and Infinity', () => {
      expect(() => number()(NaN)).toThrow(ValidationError)
      expect(() => number()(Infinity)).toThrow(ValidationError)
    })

    it('number() rejects non-numbers', () => {
      expect(() => number()('42')).toThrow(ValidationError)
    })

    it('boolean() passes for booleans', () => {
      expect(boolean()(true)).toBe(true)
      expect(boolean()(false)).toBe(true)
    })

    it('boolean() rejects non-booleans', () => {
      expect(() => boolean()(0)).toThrow(ValidationError)
      expect(() => boolean()('true')).toThrow(ValidationError)
    })

    it('object() passes for non-null objects', () => {
      expect(object()({})).toBe(true)
      expect(object()({ a: 1 })).toBe(true)
    })

    it('object() rejects null and non-objects', () => {
      expect(() => object()(null)).toThrow(ValidationError)
      expect(() => object()(42)).toThrow(ValidationError)
      // Note: arrays pass object() since typeof [] === 'object' and !== null
      expect(object()([])).toBe(true)
    })

    it('integer() passes for integers', () => {
      expect(integer()(0)).toBe(true)
      expect(integer()(-1)).toBe(true)
      expect(integer()(42)).toBe(true)
    })

    it('integer() rejects non-integers', () => {
      expect(() => integer()(1.5)).toThrow(ValidationError)
      expect(() => integer()('1')).toThrow(ValidationError)
    })
  })

  describe('string constraint validators', () => {
    it('minLength passes when length >= min', () => {
      expect(minLength(3)('abc')).toBe(true)
      expect(minLength(3)('abcd')).toBe(true)
    })

    it('minLength throws when length < min', () => {
      expect(() => minLength(3)('ab')).toThrow(ValidationError)
    })

    it('minLength throws ValidationError for non-strings', () => {
      expect(() => minLength(3)(42)).toThrow(ValidationError)
      expect(() => minLength(3)(null)).toThrow(ValidationError)
      expect(() => minLength(3)(undefined)).toThrow(ValidationError)
    })

    it('maxLength passes when length <= max', () => {
      expect(maxLength(3)('abc')).toBe(true)
      expect(maxLength(3)('ab')).toBe(true)
    })

    it('maxLength throws when length > max', () => {
      expect(() => maxLength(3)('abcd')).toThrow(ValidationError)
    })

    it('maxLength throws ValidationError for non-strings', () => {
      expect(() => maxLength(3)(42)).toThrow(ValidationError)
      expect(() => maxLength(3)(null)).toThrow(ValidationError)
      expect(() => maxLength(3)(undefined)).toThrow(ValidationError)
    })

    it('length combines min and max', () => {
      expect(length(2, 5)('abc')).toBe(true)
      expect(length(2, 5)('a')).toBe(false) // and() catches errors, returns false
      expect(length(2, 5)('abcdef')).toBe(false)
    })
  })

  describe('number constraint validators', () => {
    it('range passes for values within range', () => {
      expect(range(0, 100)(50)).toBe(true)
      expect(range(0, 100)(0)).toBe(true)
      expect(range(0, 100)(100)).toBe(true)
    })

    it('range rejects values outside range', () => {
      expect(() => range(0, 100)(-1)).toThrow(ValidationError)
      expect(() => range(0, 100)(101)).toThrow(ValidationError)
    })

    it('range throws ValidationError for non-numbers', () => {
      expect(() => range(0, 100)('50')).toThrow(ValidationError)
      expect(() => range(0, 100)(null)).toThrow(ValidationError)
      expect(() => range(0, 100)(NaN)).toThrow(ValidationError)
    })

    it('minValue passes for values >= min', () => {
      expect(minValue(0)(0)).toBe(true)
      expect(minValue(0)(100)).toBe(true)
    })

    it('minValue rejects values < min', () => {
      expect(() => minValue(0)(-1)).toThrow(ValidationError)
    })

    it('minValue throws ValidationError for non-numbers', () => {
      expect(() => minValue(0)('100')).toThrow(ValidationError)
      expect(() => minValue(0)(null)).toThrow(ValidationError)
      expect(() => minValue(0)(NaN)).toThrow(ValidationError)
    })
  })

  describe('pattern validators', () => {
    it('pattern passes for matching strings', () => {
      expect(pattern(/^abc$/)('abc')).toBe(true)
    })

    it('pattern rejects non-matching strings', () => {
      expect(() => pattern(/^abc$/)('abcd')).toThrow(ValidationError)
    })

    it('oneOf passes for allowed values', () => {
      expect(oneOf(['a', 'b', 'c'])('a')).toBe(true)
    })

    it('oneOf rejects disallowed values', () => {
      expect(() => oneOf(['a', 'b', 'c'])('d')).toThrow(ValidationError)
    })
  })

  describe('combinator: and()', () => {
    it('passes when all validators pass', () => {
      const v = and(string(), minLength(3), maxLength(10))
      expect(v('hello')).toBe(true)
    })

    it('returns false when a validator throws', () => {
      const v = and(string(), minLength(10))
      expect(v('hi')).toBe(false)
    })

    it('returns false when a validator returns false', () => {
      const alwaysFalse: (v: unknown) => v is string = (_v: unknown): _v is string => false
      const v = and(string(), alwaysFalse)
      expect(v('test')).toBe(false)
    })

    it('swallows specific error messages — returns only true/false', () => {
      const v = and(string(), minLength(5))
      // Should not throw — returns false
      expect(() => v('hi')).not.toThrow()
      expect(v('hi')).toBe(false)
    })
  })

  describe('security validators', () => {
    it('noControlChars rejects strings with control characters', () => {
      expect(noControlChars()('hello')).toBe(true)
      expect(() => noControlChars()('hel\x00lo')).toThrow(ValidationError)
      expect(() => noControlChars()('hel\x1flo')).toThrow(ValidationError)
    })

    it('noPathSeparators rejects strings with / or \\', () => {
      expect(noPathSeparators()('hello')).toBe(true)
      expect(() => noPathSeparators()('path/to/file')).toThrow(ValidationError)
      expect(() => noPathSeparators()('path\\to\\file')).toThrow(ValidationError)
    })

    it('noPathTraversal rejects strings with ..', () => {
      expect(noPathTraversal()('hello')).toBe(true)
      expect(() => noPathTraversal()('../etc')).toThrow(ValidationError)
      expect(() => noPathTraversal()('foo/../bar')).toThrow(ValidationError)
    })

    it('absolutePath accepts absolute paths', () => {
      expect(absolutePath()('C:\\Users\\test')).toBe(true)
      expect(absolutePath()('/home/user')).toBe(true)
      expect(absolutePath()('\\\\server\\share')).toBe(true)
    })

    it('absolutePath rejects relative paths', () => {
      expect(() => absolutePath()('relative/path')).toThrow(ValidationError)
      expect(() => absolutePath()('file.txt')).toThrow(ValidationError)
    })
  })

  describe('tagBlacklist()', () => {
    const valid4 = (overrides: Record<string, string[]> = {}) => ({
      hcomic: [] as string[], moeimg: [] as string[], jm: [] as string[], bika: [] as string[], copymanga: [] as string[],
      ...overrides,
    })

    it('passes for valid tag blacklist', () => {
      const v = tagBlacklist()
      expect(v(valid4({ hcomic: ['tag1', 'tag2'] }))).toBe(true)
    })

    it('rejects non-object', () => {
      expect(() => tagBlacklist()(null)).toThrow(ValidationError)
      expect(() => tagBlacklist()('string')).toThrow(ValidationError)
    })

    it('rejects non-array values', () => {
      expect(() => tagBlacklist()(valid4({ hcomic: 'not-array' as unknown as string[] }))).toThrow(ValidationError)
    })

    it('rejects arrays exceeding 500 items', () => {
      const big = Array(501).fill('tag')
      expect(() => tagBlacklist()(valid4({ hcomic: big }))).toThrow(ValidationError)
    })

    it('rejects empty strings', () => {
      expect(() => tagBlacklist()(valid4({ hcomic: [''] }))).toThrow(ValidationError)
    })

    it('rejects strings over 64 chars', () => {
      expect(() => tagBlacklist()(valid4({ hcomic: ['a'.repeat(65)] }))).toThrow(ValidationError)
    })

    it('rejects duplicates (case-insensitive)', () => {
      expect(() => tagBlacklist()(valid4({ hcomic: ['Tag', 'tag'] }))).toThrow(ValidationError)
    })

    it('accepts max 500 items', () => {
      const exact = Array(500).fill(0).map((_, i) => `tag${i}`)
      expect(tagBlacklist()(valid4({ hcomic: exact }))).toBe(true)
    })

    it('validates all four source keys', () => {
      expect(() => tagBlacklist()(valid4({ jm: 'bad' as unknown as string[] }))).toThrow(ValidationError)
      expect(() => tagBlacklist()(valid4({ bika: [''] }))).toThrow(ValidationError)
      expect(tagBlacklist()(valid4({ jm: ['tag'], bika: ['tag'] }))).toBe(true)
    })
  })

  describe('duplicateBlacklist()', () => {
    it('passes for valid entries with memberCount', () => {
      const v = duplicateBlacklist()
      expect(v({ hcomic: [{ fingerprint: '指纹A', memberCount: 3 }] })).toBe(true)
    })

    it('passes for entries with null memberCount (legacy migration)', () => {
      const v = duplicateBlacklist()
      expect(v({ hcomic: [{ fingerprint: '指纹A', memberCount: null }] })).toBe(true)
    })

    it('passes for legacy pure-string entries', () => {
      const v = duplicateBlacklist()
      expect(v({ hcomic: ['旧指纹'] })).toBe(true)
    })

    it('passes for empty object', () => {
      expect(duplicateBlacklist()({})).toBe(true)
    })

    it('rejects non-object', () => {
      expect(() => duplicateBlacklist()(null)).toThrow(ValidationError)
      expect(() => duplicateBlacklist()('string')).toThrow(ValidationError)
    })

    it('rejects non-array source values', () => {
      expect(() => duplicateBlacklist()({ hcomic: 'not-array' })).toThrow(ValidationError)
    })

    it('rejects entries exceeding 500 items', () => {
      const big = Array(501).fill({ fingerprint: 'fp', memberCount: 1 })
      expect(() => duplicateBlacklist()({ hcomic: big })).toThrow(ValidationError)
    })

    it('rejects entry missing fingerprint', () => {
      expect(() => duplicateBlacklist()({ hcomic: [{ memberCount: 3 }] })).toThrow(ValidationError)
    })

    it('rejects empty fingerprint', () => {
      expect(() => duplicateBlacklist()({ hcomic: [{ fingerprint: '', memberCount: 3 }] })).toThrow(ValidationError)
    })

    it('rejects fingerprint over 200 chars', () => {
      expect(() => duplicateBlacklist()({ hcomic: [{ fingerprint: 'a'.repeat(201), memberCount: 3 }] })).toThrow(ValidationError)
    })

    it('rejects non-integer memberCount', () => {
      expect(() => duplicateBlacklist()({ hcomic: [{ fingerprint: 'fp', memberCount: 1.5 }] })).toThrow(ValidationError)
    })

    it('rejects negative memberCount', () => {
      expect(() => duplicateBlacklist()({ hcomic: [{ fingerprint: 'fp', memberCount: -1 }] })).toThrow(ValidationError)
    })

    it('rejects duplicate fingerprints within same source', () => {
      expect(() => duplicateBlacklist()({
        hcomic: [
          { fingerprint: 'fp', memberCount: 1 },
          { fingerprint: 'fp', memberCount: 2 },
        ],
      })).toThrow(ValidationError)
    })

    it('rejects non-object/non-string entry', () => {
      expect(() => duplicateBlacklist()({ hcomic: [123] })).toThrow(ValidationError)
    })
  })

  describe('missingBlacklist()', () => {
    // missingBlacklist 与 duplicateBlacklist 数据结构同构（{ [source]: { fingerprint, memberCount }[] }），
    // 校验规则一致。这里复用同一组用例确保对称。
    it('passes for valid entries with memberCount', () => {
      const v = missingBlacklist()
      expect(v({ hcomic: [{ fingerprint: '指纹A', memberCount: 3 }] })).toBe(true)
    })

    it('passes for entries with null memberCount (legacy migration)', () => {
      const v = missingBlacklist()
      expect(v({ hcomic: [{ fingerprint: '指纹A', memberCount: null }] })).toBe(true)
    })

    it('passes for legacy pure-string entries', () => {
      const v = missingBlacklist()
      expect(v({ hcomic: ['旧指纹'] })).toBe(true)
    })

    it('passes for empty object', () => {
      expect(missingBlacklist()({})).toBe(true)
    })

    it('rejects non-object', () => {
      expect(() => missingBlacklist()(null)).toThrow(ValidationError)
      expect(() => missingBlacklist()('string')).toThrow(ValidationError)
    })

    it('rejects non-array source values', () => {
      expect(() => missingBlacklist()({ hcomic: 'not-array' })).toThrow(ValidationError)
    })

    it('rejects entries exceeding 500 items', () => {
      const big = Array(501).fill({ fingerprint: 'fp', memberCount: 1 })
      expect(() => missingBlacklist()({ hcomic: big })).toThrow(ValidationError)
    })

    it('rejects entry missing fingerprint', () => {
      expect(() => missingBlacklist()({ hcomic: [{ memberCount: 3 }] })).toThrow(ValidationError)
    })

    it('rejects duplicate fingerprints within same source', () => {
      expect(() => missingBlacklist()({
        hcomic: [
          { fingerprint: 'fp', memberCount: 1 },
          { fingerprint: 'fp', memberCount: 2 },
        ],
      })).toThrow(ValidationError)
    })

    it('rejects non-object/non-string entry', () => {
      expect(() => missingBlacklist()({ hcomic: [123] })).toThrow(ValidationError)
    })
  })

  describe('assert()', () => {
    it('does not throw for valid values', () => {
      expect(() => assert(string(), 'hello', 'test')).not.toThrow()
    })

    it('throws ValidationError for invalid values', () => {
      expect(() => assert(string(), 123, 'test')).toThrow(ValidationError)
    })

    it('wraps error messages with label', () => {
      try {
        assert(string(), 123, 'myField')
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        expect((e as ValidationError).message).toContain('myField')
      }
    })

    it('re-throws non-ValidationError exceptions', () => {
      const throws: (v: unknown) => v is string = (_v: unknown): _v is string => { throw new Error('custom') }
      expect(() => assert(throws, 'x', 'test')).toThrow('custom')
    })
  })

  describe('withOptionalSource()', () => {
    it('skips and leaves params untouched when source is undefined', () => {
      const params: Record<string, unknown> = { foo: 1 }
      withOptionalSource(params, undefined, 'test')
      expect(params).toEqual({ foo: 1 })
      expect(params.source).toBeUndefined()
    })

    it('skips and leaves params untouched when source is null', () => {
      const params: Record<string, unknown> = { foo: 1 }
      withOptionalSource(params, null, 'test')
      expect(params).toEqual({ foo: 1 })
      expect(params.source).toBeUndefined()
    })

    it('injects valid ComicSource into params.source', () => {
      const params: Record<string, unknown> = { foo: 1 }
      withOptionalSource(params, 'jm', 'search')
      expect(params.source).toBe('jm')
    })

    it('accepts all five COMIC_SOURCES values', () => {
      for (const src of ['hcomic', 'moeimg', 'jm', 'bika', 'copymanga']) {
        const params: Record<string, unknown> = {}
        expect(() => withOptionalSource(params, src, 'test')).not.toThrow()
        expect(params.source).toBe(src)
      }
    })

    it('throws ValidationError with <label> source for unknown source', () => {
      const params: Record<string, unknown> = {}
      expect(() => withOptionalSource(params, 'evil', 'search')).toThrow('Invalid search source')
      expect(params.source).toBeUndefined()
    })

    it('throws ValidationError for non-string source', () => {
      const params: Record<string, unknown> = {}
      expect(() => withOptionalSource(params, 123, 'favourites')).toThrow('Invalid favourites source')
      expect(() => withOptionalSource(params, { x: 1 }, 'random')).toThrow('Invalid random source')
    })

    it('includes the label in the error field', () => {
      try {
        withOptionalSource({}, 'bad', 'get_favourite_tags')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).field).toBe('get_favourite_tags source')
      }
    })
  })
})
