import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

const ruff = process.platform === 'win32'
  ? path.join(projectRoot, 'venv', 'Scripts', 'ruff.exe')
  : path.join(projectRoot, 'venv', 'bin', 'ruff')

const args = ['check', '.', ...process.argv.slice(2)]
const result = spawnSync(ruff, args, { stdio: 'inherit', cwd: projectRoot })
process.exit(result.status ?? 1)
