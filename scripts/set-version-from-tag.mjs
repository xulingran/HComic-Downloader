import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = join(__dirname, '..', 'package.json')

try {
  // 获取最近的 git tag（例如 v1.2.3 或 1.2.3）
  const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim()
  // 去掉可选的 v 前缀
  const version = tag.replace(/^v/, '')

  // 验证版本号格式
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`[set-version] 警告: tag "${tag}" 不是有效的 semver 格式，跳过版本更新`)
    process.exit(0)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.version = version
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`[set-version] 版本已从 tag "${tag}" 更新为 ${version}`)
} catch (e) {
  // 没有 tag 时，保留 package.json 中的版本不变
  console.log('[set-version] 未找到 git tag，保留现有版本')
}
