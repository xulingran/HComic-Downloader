// 测试质量闸门统一入口（test-quality-gate 规范）。
// 封装前端 ESLint 自定义规则扫描与 Python AST 脚本扫描，跨平台定位 venv Python。
// 复用 scripts/lint-py.mjs 的封装模式（自动定位 venv 可执行文件）。
//
// 用法：
//   npm run lint:test-quality        # 前端 + Python 全量
//   npm run lint:test-quality:py     # 仅 Python
//   node scripts/lint-test-quality.mjs --py
//
// Phase 2a：两规则均 warn 级别（前端 ESLint warn / Python 脚本退出码 0）。
// Phase 2b（清理 backlog 归零后）：前端转 error / Python 加 --strict。
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

const args = process.argv.slice(2)
const pyOnly = args.includes('--py')
const passThrough = args.filter(a => a !== '--py')

// ── Python 侧：AST 扫描 ──────────────────────────────────────────────
function runPythonGate() {
  const pyExe = process.platform === 'win32'
    ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, 'venv', 'bin', 'python')
  const script = path.join(projectRoot, 'scripts', 'lint-test-quality.py')
  // Phase 2a：不加 --strict，warn 级别（退出码始终 0）
  const pyArgs = [script, '--root', 'tests', ...passThrough.filter(a => a !== '--strict')]
  console.log('▶ Python 测试质量扫描（lint-test-quality.py）')
  const result = spawnSync(pyExe, pyArgs, { stdio: 'inherit', cwd: projectRoot })
  // Phase 2a 不阻断；Phase 2b 由调用方加 --strict
  if (result.error) {
    console.error('Python 闸门执行失败：', result.error.message)
    return 1
  }
  return 0
}

// ── 前端侧：ESLint 仅启用 test-quality 规则 ─────────────────────────
function runEslintGate() {
  console.log('▶ 前端测试质量扫描（ESLint test-quality 规则）')
  // 仅对 tests 目录运行 ESLint。规则已在 eslint.config.js 注册为 warn 级别。
  // --no-error-on-unmatched-pattern 防止 tests 为空时报错。
  const eslintArgs = ['eslint', 'tests', ...passThrough]
  const result = spawnSync('npx', eslintArgs, { stdio: 'inherit', cwd: projectRoot, shell: process.platform === 'win32' })
  if (result.error) {
    console.error('ESLint 闸门执行失败：', result.error.message)
    return 1
  }
  // ESLint warn 级别退出码为 0；error 级别（Phase 2b）会返回 1
  return result.status ?? 0
}

let exitCode = 0
if (!pyOnly) {
  // 前端优先（更快反馈）
  exitCode = runEslintGate() || exitCode
}
exitCode = runPythonGate() || exitCode

process.exit(exitCode)
