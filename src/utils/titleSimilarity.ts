import type { ComicInfo } from '@shared/types'

export interface DuplicateGroup {
  comics: ComicInfo[]
  scores: Map<string, number>
}

/**
 * 组的代表指纹：取组内所有漫画 normalized title 的字典序最小值。
 * 与收藏分页返回顺序、成员增删无关（只要字典序最小的成员仍在组内）。
 * 空组返回空字符串作为边界保护。
 */
export function groupFingerprint(group: DuplicateGroup): string {
  if (group.comics.length === 0) return ''
  return group.comics
    .map(c => normalizeTitle(c.title))
    .sort()[0] ?? ''
}

/** Remove common bracket suffixes, whitespace, and normalize full-width chars. */
export function normalizeTitle(title: string): string {
  let s = title.trim()
  s = s.replace(/\u3000/g, ' ')
  let prev = ''
  let guard = 0
  while (prev !== s && guard < 10) {
    prev = s
    s = s.replace(/[（(\x5b][^（）()\x5b\]]*[）)\]]/g, '')
    guard++
  }
  s = s.replace(/[\uff01-\uff5e]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  )
  return s.replace(/\s+/g, ' ').trim()
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = new Uint16Array(n + 1)
  let curr = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return prev[n]
}

/** LCS ratio: LCS length / max(len(a), len(b)). */
export function lcsRatio(a: string, b: string): number {
  if (!a || !b) return 0
  return lcsLength(a, b) / Math.max(a.length, b.length)
}

class UnionFind {
  private parent: Map<string, string>
  constructor(ids: Iterable<string>) {
    this.parent = new Map()
    for (const id of ids) this.parent.set(id, id)
  }
  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/**
 * 从一组漫画标题中提取共有字段，作为"下载为专辑"弹窗的默认专辑名建议。
 *
 * 算法（详见 openspec/changes/album-title-from-common-fields/design.md 决策 1）：
 *   1. 选中数 < 2 直接返回 null。
 *   2. 对【原始标题】按 /\s+/ 分词，求所有标题的【集合交集】（位置无关）。
 *   3. 作者前缀独立判定：若所有标题都以同一方括号片段开头，强制保留该前缀。
 *      （与步骤 2 独立，覆盖 `[作者]作品名` 这种无空格边角）
 *   4. 组装：作者前缀 + 空格 + 交集 tokens 空格拼接；trim 后长度 < 2 返回 null。
 *   5. 交集为空时回退：对【原始标题】求字符级最长公共前缀，trim 后 ≥ 2 才用。
 *
 * 注意：步骤 2/3/5 均对【原始标题】操作，不依赖 normalizeTitle 的去括号结果
 * （否则会丢失 [作者] 等有意义前缀）。
 *
 * 纯函数：无副作用，相同输入产生相同输出，禁止访问 React state 或 IPC。
 */
export function extractAlbumTitle(titles: string[]): string | null {
  // 步骤 1：少于 2 本无法提取共有部分
  const filtered = titles.map(t => t ?? '').map(t => t.trim()).filter(t => t.length > 0)
  if (filtered.length < 2) return null

  // 步骤 2：对原始标题分词，求集合交集（位置无关，容忍 token 顺序差异）。
  // 分隔符包含空格、连字符(- —)、下划线、波浪号，覆盖中文漫画标题常见格式：
  //   "系列名-子标题" / "作者_作品" / "标题～副标题"
  // 保持首次标题的相对顺序输出，便于稳定。
  const TOKEN_SEP = /[\s\-—_～~]+/
  const tokenSets = filtered.map(t => new Set(t.split(TOKEN_SEP).filter(tk => tk.length > 0)))
  const orderedIntersection = Array.from(tokenSets[0]).filter(tk =>
    tokenSets.slice(1).every(s => s.has(tk))
  )

  // 步骤 3：作者前缀独立判定 —— 所有标题都以同一方括号片段开头时强制保留
  const authorPrefix = extractCommonAuthorPrefix(filtered)

  // 组装辅助：避免作者前缀重复。三种情况：
  //   A. body 以 "[作者]" + 紧连非空格字符开头（如 body="[作者]某作品"，无空格边角）
  //      → 作者已隐含在首个 token 内，直接返回 body。
  //   B. body 以 "[作者]" + 空格开头（如 body="[作者] 某作品"，或 body 恰为 "[作者]"）
  //      → 剥离开头的作者 token，再统一拼回一次，避免 "[作者] [作者] ..."。
  //   C. body 不以 "[作者]" 开头 → 拼接 "[作者] " + body。
  function withAuthorPrefix(body: string): string {
    if (!authorPrefix) return body
    if (!body.startsWith(authorPrefix)) {
      return `${authorPrefix} ${body}`
    }
    const next = body[authorPrefix.length]
    if (next !== undefined && next !== ' ') {
      // 情况 A：作者与后续字符紧连，已隐含
      return body
    }
    // 情况 B：剥离开头作者 token（含可能的紧跟空格），统一拼回一次
    const rest = body.slice(authorPrefix.length).trim()
    return rest ? `${authorPrefix} ${rest}` : authorPrefix
  }

  let candidate: string | null
  if (orderedIntersection.length > 0) {
    // 步骤 4：组装
    candidate = withAuthorPrefix(orderedIntersection.join(' '))
  } else {
    // 步骤 5：交集为空，回退字符级最长公共前缀（对原始标题）
    const prefix = longestCommonPrefix(filtered)
    candidate = prefix && prefix.trim().length >= 2 ? prefix.trim() : null
    // 回退路径同样通过 withAuthorPrefix 处理作者前缀（去重 + 拼接）
    if (candidate) {
      candidate = withAuthorPrefix(candidate)
    }
  }

  if (candidate === null) return null
  const trimmed = candidate.trim()
  return trimmed.length >= 2 ? trimmed : null
}

/**
 * 调用方友好的包装：提取共有字段作为默认专辑名，提取失败时回退到
 * `批量下载 - ${count}本漫画`，并通过 console.debug 记录提取过程，
 * 便于诊断"为什么这次没提取出作品名"。
 *
 * 日志只在结果与预期不符（选中 ≥ 2 本却回退）或提取成功时输出，
 * 单本/未选中不打日志，避免噪声。
 */
export function pickAlbumDefaultName(titles: string[], count: number): string {
  const extracted = extractAlbumTitle(titles)
  // 用 info 而非 debug：Chrome DevTools 默认隐藏 verbose(debug) 级别，
  // 关键诊断信息用 info 确保默认可见。
  if (extracted) {
    console.info('[album-title] 提取共有字段', {
      inputCount: titles.length,
      sample: titles.slice(0, 3),
      result: extracted,
    })
    return extracted
  }
  console.info('[album-title] 提取失败，回退计数文案', {
    inputCount: titles.length,
    sample: titles.slice(0, 3),
    fallback: `批量下载 - ${count}本漫画`,
  })
  return `批量下载 - ${count}本漫画`
}

/**
 * 若所有标题都以同一方括号片段（如 `[作者]`、`[社团]`）开头，返回该片段（含方括号）；
 * 否则返回 null。匹配方式：取首个标题的方括号前缀，校验其余标题是否都以它开头。
 */
function extractCommonAuthorPrefix(titles: string[]): string | null {
  const match = titles[0].match(/^\s*(\[[^\]]*\])/)
  if (!match) return null
  const bracket = match[1]
  // 所有标题都必须以该方括号片段开头（允许前导空白）
  const leadingRe = new RegExp(`^\\s*${escapeRegExp(bracket)}`)
  return titles.every(t => leadingRe.test(t)) ? bracket : null
}

const REGEX_SPECIAL = new RegExp('[.*+?^${}()|[\\]\\\\]', 'g')

function escapeRegExp(s: string): string {
  // 用函数形式替换（replacer 返回字面量），避免字符串 replacer 的反向引用展开
  return s.replace(REGEX_SPECIAL, ch => '\\' + ch)
}

/** 字符级最长公共前缀。输入需已 trim。空数组返回空串。 */
function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return ''
  let hi = strs[0].length
  for (let i = 1; i < strs.length; i++) {
    hi = Math.min(hi, strs[i].length)
    for (let j = 0; j < hi; j++) {
      if (strs[i][j] !== strs[0][j]) {
        hi = j
        break
      }
    }
  }
  return strs[0].slice(0, hi)
}

/**
 * Find groups of comics with similar titles using union-find.
 * Returns groups sorted by size descending.
 */
export function findDuplicateGroups(
  comics: ComicInfo[],
  threshold: number = 0.6
): DuplicateGroup[] {
  if (comics.length < 2) return []

  const normalized = comics.map(c => ({ comic: c, norm: normalizeTitle(c.title) }))
  const normByComicId = new Map<string, string>()
  for (const { comic, norm } of normalized) normByComicId.set(comic.id, norm)

  const uf = new UnionFind(comics.map(c => c.id))
  const maxScore = new Map<string, number>()

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const score = lcsRatio(normalized[i].norm, normalized[j].norm)
      if (score >= threshold) {
        uf.union(normalized[i].comic.id, normalized[j].comic.id)
        const key = normalized[i].comic.id < normalized[j].comic.id
          ? `${normalized[i].comic.id}:${normalized[j].comic.id}`
          : `${normalized[j].comic.id}:${normalized[i].comic.id}`
        maxScore.set(key, score)
      }
    }
  }

  const groupMap = new Map<string, ComicInfo[]>()
  for (const { comic } of normalized) {
    const root = uf.find(comic.id)
    let arr = groupMap.get(root)
    if (!arr) { arr = []; groupMap.set(root, arr) }
    arr.push(comic)
  }

  const groups: DuplicateGroup[] = []
  for (const [, groupComics] of groupMap) {
    if (groupComics.length < 2) continue
    const scores = new Map<string, number>()
    for (const c of groupComics) {
      let best = 0
      for (const c2 of groupComics) {
        if (c.id === c2.id) continue
        const key = c.id < c2.id ? `${c.id}:${c2.id}` : `${c2.id}:${c.id}`
        best = Math.max(best, maxScore.get(key) ?? lcsRatio(normByComicId.get(c.id)!, normByComicId.get(c2.id)!))
      }
      scores.set(c.id, best)
    }
    groups.push({ comics: groupComics, scores })
  }

  groups.sort((a, b) => b.comics.length - a.comics.length)
  return groups
}
