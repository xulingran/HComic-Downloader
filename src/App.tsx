import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const handleSearch = (query: string) => {
    console.log('Search:', query)
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={handleSearch} />
        <main className="flex-1 overflow-auto p-6">
          <div className="text-[var(--text-primary)]">
            Page: {activePage}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
