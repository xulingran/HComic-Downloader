import { useState, useCallback } from 'react'

const STORAGE_KEY = 'hcomic_search_history'
const MAX_ITEMS = 20

// Simple XOR obfuscation for search history stored in localStorage.
// This is NOT encryption — it only prevents casual plaintext inspection.
// It does not protect against anyone with access to the source code.
const XOR_KEY = 0x5A

function xorEncode(input: string): string {
  let result = ''
  for (let i = 0; i < input.length; i++) {
    result += String.fromCharCode(input.charCodeAt(i) ^ XOR_KEY)
  }
  return result
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const decoded = xorEncode(raw)
    const parsed = JSON.parse(decoded)
    return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(items: string[]) {
  const json = JSON.stringify(items)
  localStorage.setItem(STORAGE_KEY, xorEncode(json))
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(loadHistory)

  const add = useCallback((term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    setHistory(prev => {
      const filtered = prev.filter(s => s !== trimmed)
      const next = [trimmed, ...filtered].slice(0, MAX_ITEMS)
      saveHistory(next)
      return next
    })
  }, [])

  const remove = useCallback((term: string) => {
    setHistory(prev => {
      const next = prev.filter(s => s !== term)
      saveHistory(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return { history, add, remove, clear }
}
