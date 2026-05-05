import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { SearchPage } from './pages/SearchPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      default:
        return <div className="text-[var(--text-primary)]">Coming soon: {activePage}</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col">
        <Header onSearch={(q) => console.log('Search:', q)} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
