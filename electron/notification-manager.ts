import { app, Notification, BrowserWindow } from 'electron'
import { ACTIVE_DOWNLOAD_STATUSES } from '../shared/types'

const NOTIFICATION_BATCH_LIMIT = 100

export class NotificationManager {
  // 活跃态直接复用 shared 单一来源：消除"任一处增删状态需要多点同步"的隐患。
  // 历史实现曾在本地硬编码 4 个字面量，与 shared 集合语义对齐仅靠测试保证——
  // 现直接派生，避免漂移。
  private static readonly ACTIVE_STATUSES = ACTIVE_DOWNLOAD_STATUSES

  private activeTaskSet = new Set<string>()
  private completedTasks: Array<{ title: string; outputPath?: string }> = []
  private failedTasks: Array<{ title: string; error?: string }> = []
  private notifyOnComplete = true
  private notifyWhenForeground: 'inactive' | 'always' = 'inactive'
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow | null) {
    this.mainWindow = win
  }

  updateSettings(notifyOnComplete: boolean, notifyWhenForeground: 'inactive' | 'always') {
    this.notifyOnComplete = notifyOnComplete
    this.notifyWhenForeground = notifyWhenForeground
  }

  get notifyOnCompleteValue(): boolean {
    return this.notifyOnComplete
  }

  get notifyWhenForegroundValue(): 'inactive' | 'always' {
    return this.notifyWhenForeground
  }

  handleProgress(event: { taskId: string; status: string; title: string }) {
    if (NotificationManager.ACTIVE_STATUSES.has(event.status)) {
      this.activeTaskSet.add(event.taskId)
    } else {
      this.activeTaskSet.delete(event.taskId)
    }

    if (event.status === 'completed') {
      this.completedTasks.push({ title: event.title })
    }

    if (event.status === 'failed') {
      this.failedTasks.push({ title: event.title })
    }

    const shouldNotify = this.activeTaskSet.size === 0
      || (this.completedTasks.length + this.failedTasks.length >= NOTIFICATION_BATCH_LIMIT)
    if (shouldNotify && (this.completedTasks.length > 0 || this.failedTasks.length > 0)) {
      this.sendBatchNotification()
      this.completedTasks.length = 0
      this.failedTasks.length = 0
    }
  }

  private sendBatchNotification() {
    if (!this.notifyOnComplete) return
    if (this.notifyWhenForeground === 'inactive' && this.mainWindow?.isFocused()) return

    if (!Notification.isSupported()) return

    const successCount = this.completedTasks.length
    const failCount = this.failedTasks.length

    let title: string
    let body: string

    if (successCount === 1 && failCount === 0) {
      title = app.getName()
      body = `下载完成：${this.completedTasks[0].title}`
    } else {
      const parts: string[] = []
      if (successCount > 0) parts.push(`成功 ${successCount} 本`)
      if (failCount > 0) parts.push(`失败 ${failCount} 本`)
      title = app.getName()
      body = `批量下载完成：${parts.join('，')}`
    }

    const notification = new Notification({ title, body })
    notification.on('click', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore()
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    })
    notification.show()
  }
}
