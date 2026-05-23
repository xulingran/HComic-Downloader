import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../../../src/stores/useSettingsStore'

describe('useSettingsStore — tagBlacklist', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tagBlacklist: { hcomic: [], moeimg: [] },
      filterEnabled: true,
    })
  })

  it('adds a tag to the correct source', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', 'NTR')
    const { tagBlacklist } = useSettingsStore.getState()
    expect(tagBlacklist.hcomic).toEqual(['NTR'])
    expect(tagBlacklist.moeimg).toEqual([])
  })

  it('trims whitespace when adding', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', '  NTR  ')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('ignores empty string', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', '   ')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual([])
  })

  it('deduplicates case-insensitively', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', 'NTR')
    addTag('hcomic', 'ntr')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('removes a tag case-insensitively', () => {
    useSettingsStore.setState({ tagBlacklist: { hcomic: ['NTR', 'rape'], moeimg: [] } })
    const { removeTag } = useSettingsStore.getState()
    removeTag('hcomic', 'ntr')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['rape'])
  })

  it('removing non-existent tag is a no-op', () => {
    useSettingsStore.setState({ tagBlacklist: { hcomic: ['NTR'], moeimg: [] } })
    const { removeTag } = useSettingsStore.getState()
    removeTag('hcomic', 'xyz')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('setTagBlacklist replaces entire blacklist', () => {
    const { setTagBlacklist } = useSettingsStore.getState()
    setTagBlacklist({ hcomic: ['a', 'b'], moeimg: ['c'] })
    expect(useSettingsStore.getState().tagBlacklist).toEqual({ hcomic: ['a', 'b'], moeimg: ['c'] })
  })

  it('setFilterEnabled toggles filter state', () => {
    expect(useSettingsStore.getState().filterEnabled).toBe(true)
    const { setFilterEnabled } = useSettingsStore.getState()
    setFilterEnabled(false)
    expect(useSettingsStore.getState().filterEnabled).toBe(false)
  })
})
