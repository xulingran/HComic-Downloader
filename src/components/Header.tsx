import { useState } from 'react'

interface HeaderProps {
  onSearch: (query: string) => void
}

export function Header({ onSearch }: HeaderProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      onSearch(query.trim())
    }
  }

  return (
    <header className="h-14 bg-[var(--bg-primary)] border-b border-[var(--border)] flex items-center px-4 gap-4">
      <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索漫画..."
          className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] 
                     text-[var(--text-primary)] placeholder-[var(--text-secondary)]
                     focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
        >
          搜索
        </button>
      </form>
    </header>
  )
}
