import { useState } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { DuplicateDetector } from '../components/tools/DuplicateDetector'
import { TagFilterSettings } from '../components/settings/TagFilterSettings'
import { FavouriteTagSettings } from '../components/settings/FavouriteTagSettings'

const SECTIONS = [
  { id: 'tag-filter', label: '标签过滤', icon: '\u{1F3F7}\uFE0F' },
  { id: 'favourite-tags', label: '推荐标签', icon: '\u2B50' },
  { id: 'duplicate', label: '重复检测', icon: '\u{1F4CB}' },
] as const

export function ToolboxPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const { tagBlacklist, addTag, removeTag } = useSettingsStore()

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId)
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => setActiveSection(null), 1500)
  }

  return (
    <div className="flex gap-0 max-w-5xl">
      <div className="w-[150px] shrink-0">
        <nav className="sticky top-6 space-y-0.5 pr-3">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
            工具箱
          </div>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${activeSection === section.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
            >
              <span className="mr-2">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 min-w-0 space-y-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">工具箱</h2>

        <div id="section-tag-filter">
          <TagFilterSettings
            tagBlacklist={tagBlacklist}
            addTag={addTag}
            removeTag={removeTag}
          />
        </div>

        <div id="section-favourite-tags">
          <FavouriteTagSettings />
        </div>

        <div id="section-duplicate">
          <DuplicateDetector />
        </div>
      </div>
    </div>
  )
}
