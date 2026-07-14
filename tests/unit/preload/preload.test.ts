// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const { mockExposeInMainWorld, mockInvoke } = vi.hoisted(() => ({
  mockExposeInMainWorld: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue('result')
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))

import '../../../electron/preload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exposedApi = mockExposeInMainWorld.mock.calls[0]?.[1] as any

describe('preload.ts', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('should expose window.hcomic via contextBridge', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('hcomic', expect.any(Object))
  })

  it('should NOT expose ipcRenderer.invoke directly', () => {
    expect(exposedApi.ipcRenderer).toBeUndefined()
  })

  describe('search', () => {
    it('should invoke python:search with correct args', async () => {
      await exposedApi.search('test', 'keyword', 1)
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, undefined, undefined, false, undefined)
    })

    it('should reject invalid query', () => {
      expect(() => exposedApi.search(123, 'keyword', 1)).toThrow('Invalid query')
      expect(() => exposedApi.search('a'.repeat(513), 'keyword', 1)).toThrow('Invalid query')
    })

    it('should allow empty query for homepage search', async () => {
      await exposedApi.search('', 'keyword', 1)
      expect(mockInvoke).toHaveBeenCalledWith('python:search', '', 'keyword', 1, undefined, undefined, false, undefined)
    })

    it('should reject invalid mode', () => {
      expect(() => exposedApi.search('test', 'invalid', 1)).toThrow('Invalid mode')
    })

    it('should reject invalid page', () => {
      expect(() => exposedApi.search('test', 'keyword', 0)).toThrow('Invalid page')
      expect(() => exposedApi.search('test', 'keyword', NaN)).toThrow('Invalid page')
      expect(() => exposedApi.search('test', 'keyword', 1.5)).toThrow('Invalid page')
      expect(() => exposedApi.search('test', 'keyword', 1001)).toThrow('Invalid page')
    })

    it('should reject invalid source', () => {
      expect(() => exposedApi.search('test', 'keyword', 1, 'evil')).toThrow('Invalid source')
    })

    it('should pass source when valid', async () => {
      await exposedApi.search('test', 'keyword', 1, 'moeimg')
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, 'moeimg', undefined, false, undefined)
    })

    it('should reject non-boolean allowInteractiveChallenge', () => {
      expect(() => exposedApi.search('test', 'keyword', 1, undefined, undefined, 'yes' as unknown as boolean)).toThrow(
        'Invalid allowInteractiveChallenge',
      )
    })

    it('should pass allowInteractiveChallenge=true for user-initiated search', async () => {
      await exposedApi.search('test', 'keyword', 1, 'jm', undefined, true)
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, 'jm', undefined, true, undefined)
    })

    it('should default allowInteractiveChallenge to false when omitted', async () => {
      await exposedApi.search('test', 'keyword', 1)
      // 第 7 参数（allowInteractiveChallenge）缺省时归一化为 false，不转发 undefined
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, undefined, undefined, false, undefined)
    })

    it('should forward languageFilter="chinese" for NH filter', async () => {
      await exposedApi.search('test', 'keyword', 1, 'nh', undefined, false, 'chinese')
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, 'nh', undefined, false, 'chinese')
    })

    it('should default languageFilter to undefined when omitted', async () => {
      await exposedApi.search('test', 'keyword', 1, 'nh')
      // 第 8 参数（languageFilter）缺省时不转发，主进程据此识别为未启用筛选
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, 'nh', undefined, false, undefined)
    })

    it('should normalize empty-string languageFilter to undefined', async () => {
      await exposedApi.search('test', 'keyword', 1, 'nh', undefined, false, '')
      expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 1, 'nh', undefined, false, undefined)
    })

    it('should reject non-string languageFilter', () => {
      expect(() => exposedApi.search('test', 'keyword', 1, 'nh', undefined, false, 123 as unknown as string)).toThrow(
        'Invalid languageFilter',
      )
    })

    it('should reject unsupported languageFilter value', () => {
      // 'japanese' 不在 SEARCH_LANGUAGE_FILTERS 枚举中，必须在 preload 早期拒绝
      expect(() => exposedApi.search('test', 'keyword', 1, 'nh', undefined, false, 'japanese')).toThrow(
        'Invalid languageFilter',
      )
    })

    it('should reject languageFilter containing control characters', () => {
      expect(() => exposedApi.search('test', 'keyword', 1, 'nh', undefined, false, 'chinese\x00')).toThrow(
        'Invalid languageFilter',
      )
    })
  })

  describe('bikaCheckIn', () => {
    it('invokes the dedicated channel without credentials or other arguments', async () => {
      await exposedApi.bikaCheckIn()

      expect(mockInvoke).toHaveBeenCalledWith('python:bika-check-in')
    })
  })

  describe('download', () => {
    it('should invoke python:download with correct args', async () => {
      const comicData = { title: 'Test', url: 'http://x.com', source: 'hcomic' }
      await exposedApi.download('id-1', comicData)
      expect(mockInvoke).toHaveBeenCalledWith('python:download', 'id-1', comicData, undefined, undefined)
    })

    it('should reject empty comicId', () => {
      expect(() => exposedApi.download('', {})).toThrow('Invalid comicId')
    })

    it('should reject null comicData', () => {
      expect(() => exposedApi.download('id', null)).toThrow('Invalid comicData')
    })
  })

  describe('getFavourites', () => {
    it('should invoke with default page 1', async () => {
      await exposedApi.getFavourites()
      expect(mockInvoke).toHaveBeenCalledWith('python:get-favourites', 1, undefined, false)
    })

    it('should invoke with specified page', async () => {
      await exposedApi.getFavourites(3)
      expect(mockInvoke).toHaveBeenCalledWith('python:get-favourites', 3, undefined, false)
    })

    it('should reject invalid page', () => {
      expect(() => exposedApi.getFavourites(0)).toThrow('Invalid page')
    })

    it('should default allowInteractiveChallenge to false (background-safe)', async () => {
      await exposedApi.getFavourites(1, 'jm')
      expect(mockInvoke).toHaveBeenCalledWith('python:get-favourites', 1, 'jm', false)
    })

    it('should forward allowInteractiveChallenge=true to main process', async () => {
      await exposedApi.getFavourites(1, 'jm', true)
      expect(mockInvoke).toHaveBeenCalledWith('python:get-favourites', 1, 'jm', true)
    })

    it('should reject non-boolean allowInteractiveChallenge', () => {
      expect(() => exposedApi.getFavourites(1, 'jm', 'yes' as unknown as boolean)).toThrow('Invalid allowInteractiveChallenge')
      expect(() => exposedApi.getFavourites(1, 'jm', 1 as unknown as boolean)).toThrow('Invalid allowInteractiveChallenge')
    })

    it('should treat null/undefined allowInteractiveChallenge as false', async () => {
      await exposedApi.getFavourites(1, 'jm', undefined)
      expect(mockInvoke).toHaveBeenLastCalledWith('python:get-favourites', 1, 'jm', false)
      await exposedApi.getFavourites(1, 'jm', null)
      expect(mockInvoke).toHaveBeenLastCalledWith('python:get-favourites', 1, 'jm', false)
    })
  })

  describe('setConfig', () => {
    it('should invoke with key and value', async () => {
      await exposedApi.setConfig('themeMode', 'dark')
      expect(mockInvoke).toHaveBeenCalledWith('python:set-config', 'themeMode', 'dark')
    })

    it('should accept and forward myTags', async () => {
      const myTags = {
        hcomic: ['NTR'],
        moeimg: [],
        jm: ['校園'],
        bika: [],
        copymanga: [],
        nh: [],
      }

      await exposedApi.setConfig('myTags', myTags)

      expect(mockInvoke).toHaveBeenCalledWith('python:set-config', 'myTags', myTags)
    })

    it('should reject unknown config key', () => {
      expect(() => exposedApi.setConfig('evilKey', 'value')).toThrow('Invalid config key')
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('cancelDownload', () => {
    it('should invoke with taskId', async () => {
      await exposedApi.cancelDownload('task-1')
      expect(mockInvoke).toHaveBeenCalledWith('python:cancel-download', 'task-1')
    })

    it('should reject empty taskId', () => {
      expect(() => exposedApi.cancelDownload('')).toThrow('Invalid taskId')
    })

    it('should reject overlong taskId', () => {
      expect(() => exposedApi.cancelDownload('a'.repeat(257))).toThrow('Invalid taskId')
    })
  })

  describe('applyAuth', () => {
    it('should invoke with curlText', async () => {
      await exposedApi.applyAuth('curl example.com')
      expect(mockInvoke).toHaveBeenCalledWith('python:apply-auth', 'curl example.com', undefined)
    })

    it('should invoke with curlText and source', async () => {
      await exposedApi.applyAuth('curl example.com', 'jm')
      expect(mockInvoke).toHaveBeenCalledWith('python:apply-auth', 'curl example.com', 'jm')
    })

    it('should reject empty curlText', () => {
      expect(() => exposedApi.applyAuth('')).toThrow('Invalid curlText')
      expect(() => exposedApi.applyAuth('   ')).toThrow('Invalid curlText')
      expect(() => exposedApi.applyAuth('c'.repeat(65537))).toThrow('Invalid curlText')
    })
  })

  describe('openUrl', () => {
    it('should invoke open-external', async () => {
      await exposedApi.openUrl('https://h-comic.com')
      expect(mockInvoke).toHaveBeenCalledWith('open-external', 'https://h-comic.com')
    })

    it('should reject empty URL', () => {
      expect(() => exposedApi.openUrl('')).toThrow('Invalid URL')
    })

    it('should reject overlong URL', () => {
      expect(() => exposedApi.openUrl('https://x.com/' + 'a'.repeat(2048))).toThrow('Invalid URL')
    })
  })

  describe('fetchPreviewImage', () => {
    it('should invoke python:fetch-preview-image with URL', async () => {
      await exposedApi.fetchPreviewImage('https://h-comic.link/api/nh/media123/pages/1')
      expect(mockInvoke).toHaveBeenCalledWith('python:fetch-preview-image', 'https://h-comic.link/api/nh/media123/pages/1', undefined, undefined, undefined, undefined)
    })

    it('should forward generation to IPC when provided (reader-jump-preload-priority)', async () => {
      await exposedApi.fetchPreviewImage('https://h-comic.link/api/nh/media123/pages/1', undefined, undefined, undefined, 3)
      expect(mockInvoke).toHaveBeenCalledWith('python:fetch-preview-image', 'https://h-comic.link/api/nh/media123/pages/1', undefined, undefined, undefined, 3)
    })

    it('should reject invalid generation', () => {
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, undefined, undefined, -1)).toThrow('Invalid generation')
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, undefined, undefined, NaN)).toThrow('Invalid generation')
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, undefined, undefined, '3' as unknown as number)).toThrow('Invalid generation')
    })

    it('should expose cancelPreviewGenerations and forward to IPC', async () => {
      await exposedApi.cancelPreviewGenerations(2)
      expect(mockInvoke).toHaveBeenCalledWith('python:cancel-preview-generations', 2)
    })

    it('should reject invalid cancelPreviewGenerations before', () => {
      expect(() => exposedApi.cancelPreviewGenerations(-1)).toThrow('Invalid before')
      expect(() => exposedApi.cancelPreviewGenerations('2' as unknown as number)).toThrow('Invalid before')
    })

    it('should reject invalid preview image URL', () => {
      expect(() => exposedApi.fetchPreviewImage('')).toThrow('Invalid preview image URL')
      expect(() => exposedApi.fetchPreviewImage(123)).toThrow('Invalid preview image URL')
      expect(() => exposedApi.fetchPreviewImage('https://x.com/' + 'a'.repeat(2048))).toThrow('Invalid preview image URL')
    })
  })

  describe('stateless methods', () => {
    it('getConfig should invoke python:get-config', async () => {
      await exposedApi.getConfig()
      expect(mockInvoke).toHaveBeenCalledWith('python:get-config')
    })

    it('getDownloads should invoke python:get-downloads', async () => {
      await exposedApi.getDownloads()
      expect(mockInvoke).toHaveBeenCalledWith('python:get-downloads')
    })

    it('verifyAuth should invoke python:verify-auth', async () => {
      await exposedApi.verifyAuth()
      expect(mockInvoke).toHaveBeenCalledWith('python:verify-auth', undefined)
    })

    it('verifyAuth should pass source to python:verify-auth', async () => {
      await exposedApi.verifyAuth('jm')
      expect(mockInvoke).toHaveBeenCalledWith('python:verify-auth', 'jm')
    })
  })

  describe('onDownloadProgress', () => {
    it('should reject non-function callback', () => {
      expect(() => exposedApi.onDownloadProgress('not-a-function')).toThrow('Invalid callback')
      expect(() => exposedApi.onDownloadProgress(123)).toThrow('Invalid callback')
      expect(() => exposedApi.onDownloadProgress(null)).toThrow('Invalid callback')
      expect(() => exposedApi.onDownloadProgress(undefined)).toThrow('Invalid callback')
    })

    it('should accept a function callback', () => {
      const callback = vi.fn()
      expect(() => exposedApi.onDownloadProgress(callback)).not.toThrow()
    })
  })

  describe('onFavouriteTagsProgress', () => {
    it('should subscribe to the dedicated favourite-tags:progress channel', () => {
      // 不像 onDownloadProgress 那样校验 callback（onChannel 不强制类型），但必须使用专用通道
      const callback = vi.fn()
      exposedApi.onFavouriteTagsProgress(callback)

      // exposedApi.onFavouriteTagsProgress 内部通过 onChannel 订阅 NOTIFICATION_CHANNELS.FAVOURITE_TAGS_PROGRESS
      // 这里只能从行为上验证它不抛错且返回取消订阅函数
    })

    it('should return an unsubscribe function', () => {
      const callback = vi.fn()
      const unsubscribe = exposedApi.onFavouriteTagsProgress(callback)
      expect(typeof unsubscribe).toBe('function')
    })
  })

  // 回归：validateCredentialPair helper 必须被三个登录函数复用，
  // 任一处漏接或语义漂移（如 trim 逻辑丢失）都应被这里的统一断言捕获。
  describe('login helpers (validateCredentialPair)', () => {
    const loginMethods = ['moeimgLogin', 'bikaLogin', 'hcomicLogin'] as const

    for (const method of loginMethods) {
      describe(`${method}`, () => {
        it('rejects empty username', () => {
          expect(() => exposedApi[method]('', 'pass')).toThrow('Invalid username')
          expect(() => exposedApi[method]('   ', 'pass')).toThrow('Invalid username')
        })

        it('rejects non-string username', () => {
          expect(() => exposedApi[method](123, 'pass')).toThrow('Invalid username')
          expect(() => exposedApi[method](null, 'pass')).toThrow('Invalid username')
        })

        it('rejects username over 256 chars', () => {
          expect(() => exposedApi[method]('a'.repeat(257), 'pass')).toThrow('Invalid username')
        })

        it('rejects empty password', () => {
          expect(() => exposedApi[method]('user', '')).toThrow('Invalid password')
          expect(() => exposedApi[method]('user', '   ')).toThrow('Invalid password')
        })

        it('rejects non-string password', () => {
          expect(() => exposedApi[method]('user', 123)).toThrow('Invalid password')
          expect(() => exposedApi[method]('user', null)).toThrow('Invalid password')
        })

        it('accepts valid credential pair and invokes IPC', () => {
          exposedApi[method]('user', 'pass')
          // 断言性次数：合法凭据恰好触发一次 IPC 调用（校验通过后转发一次，不重复/不漏）
          expect(mockInvoke).toHaveBeenCalledTimes(1)
        })
      })
    }
  })

  // 回归：nhApplyApiKey 必须做与后端对称的 API Key 输入校验
  // （remove-nh-password-login spec）。
  describe('nhApplyApiKey (validateNhApiKey)', () => {
    it('rejects empty / whitespace-only api key', () => {
      expect(() => exposedApi.nhApplyApiKey('')).toThrow('Invalid NH API Key')
      expect(() => exposedApi.nhApplyApiKey('   ')).toThrow('Invalid NH API Key')
    })

    it('rejects non-string api key', () => {
      expect(() => exposedApi.nhApplyApiKey(123)).toThrow('Invalid NH API Key')
      expect(() => exposedApi.nhApplyApiKey(null)).toThrow('Invalid NH API Key')
    })

    it('rejects control characters', () => {
      expect(() => exposedApi.nhApplyApiKey('bad\nkey')).toThrow('control characters')
      expect(() => exposedApi.nhApplyApiKey('bad\x00key')).toThrow('control characters')
    })

    it('rejects api key over 1024 chars', () => {
      expect(() => exposedApi.nhApplyApiKey('a'.repeat(1025))).toThrow('Invalid NH API Key')
    })

    it('accepts valid api key and invokes IPC', () => {
      exposedApi.nhApplyApiKey('nh-api-key-xxx')
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenCalledWith('python:nh-apply-api-key', 'nh-api-key-xxx')
    })

    it('does not expose nhLogin anymore', () => {
      expect((exposedApi as Record<string, unknown>).nhLogin).toBeUndefined()
    })
  })

  // 回归：validateComicIdAndOptionalSource helper 必须被三个收藏函数复用。
  describe('favourites helpers (validateComicIdAndOptionalSource)', () => {
    const favMethods = ['addToFavourites', 'checkFavourite', 'removeFromFavourites'] as const

    for (const method of favMethods) {
      describe(`${method}`, () => {
        it('rejects empty comicId', () => {
          expect(() => exposedApi[method]('')).toThrow('Invalid comicId')
        })

        it('rejects non-string comicId', () => {
          expect(() => exposedApi[method](123)).toThrow('Invalid comicId')
          expect(() => exposedApi[method](null)).toThrow('Invalid comicId')
        })

        it('rejects comicId over 256 chars', () => {
          expect(() => exposedApi[method]('a'.repeat(257))).toThrow('Invalid comicId')
        })

        it('rejects non-string source', () => {
          expect(() => exposedApi[method]('id', 123)).toThrow('Invalid source')
          expect(() => exposedApi[method]('id', { x: 1 })).toThrow('Invalid source')
        })

        it('accepts undefined/null source', () => {
          expect(() => exposedApi[method]('id', undefined)).not.toThrow()
          expect(() => exposedApi[method]('id', null)).not.toThrow()
        })

        it('accepts valid comicId + source and invokes IPC', () => {
          exposedApi[method]('id', 'hcomic')
          // 断言性次数：合法 comicId+source 恰好触发一次 IPC 调用
          expect(mockInvoke).toHaveBeenCalledTimes(1)
        })
      })
    }
  })

  // 回归：fetchPreviewImage 的 scrambleId/comicId 必须接受字符串/undefined/null，
  // 拒绝其他类型（早期类型守卫，主进程会做权威校验）。
  describe('fetchPreviewImage scrambleId/comicId guards', () => {
    it('rejects non-string scrambleId', () => {
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', 123)).toThrow('Invalid scrambleId')
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', { a: 1 })).toThrow('Invalid scrambleId')
    })

    it('rejects non-string comicId', () => {
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, 123)).toThrow('Invalid comicId')
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, false)).toThrow('Invalid comicId')
    })

    it('accepts string/undefined/null scrambleId/comicId', () => {
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', 'sid', 'cid')).not.toThrow()
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', undefined, undefined)).not.toThrow()
      expect(() => exposedApi.fetchPreviewImage('https://x/y.jpg', null, null)).not.toThrow()
    })
  })
})
