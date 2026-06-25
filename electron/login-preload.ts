import { contextBridge } from 'electron'

contextBridge.executeInMainWorld({
  func: () => {
    const observerPrototype = window.MutationObserver?.prototype as
      | (MutationObserver & { __hcomicCompatInstalled?: boolean })
      | undefined

    if (observerPrototype && !observerPrototype.__hcomicCompatInstalled) {
      const nativeObserve = observerPrototype.observe
      Object.defineProperty(observerPrototype, '__hcomicCompatInstalled', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      })

      observerPrototype.observe = function (
        this: MutationObserver,
        target: Node,
        options?: MutationObserverInit,
      ): void {
        if (!(target instanceof Node)) {
          const stack = new Error().stack || ''
          if (/jquery\.avs(?:-|\.|\/)/i.test(stack)) return
        }
        nativeObserve.call(this, target, options)
      }
    }

    // jmcomic 的 jquery.avs 初始化异常会连带使底部“我的”入口失去响应。
    // 捕获期只兜底文字精确为“我的”的同源入口，其他按钮和站点行为不受影响。
    document.addEventListener('click', (event) => {
      if (!/(?:^|\.)18comic\.|(?:^|\.)jmcomic/i.test(location.hostname)) return
      const target = event.target
      if (!(target instanceof Element)) return

      const control = target.closest('a, button, [role="button"]')
      if (!control || control.textContent?.trim() !== '我的') return

      const rawHref = control instanceof HTMLAnchorElement
        ? control.getAttribute('href')
        : control.getAttribute('data-href')
      const destination = new URL(rawHref || '/user/', location.href)
      if (destination.origin !== location.origin) return

      event.preventDefault()
      event.stopImmediatePropagation()
      location.assign(destination.href)
    }, true)
  },
})
