import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

const black = process.platform === 'win32'
  ? path.join(projectRoot, 'venv', 'Scripts', 'black.exe')
  : path.join(projectRoot, 'venv', 'bin', 'black')

const args = ['.', ...process.argv.slice(2)]
const result = spawnSync(black, args, { stdio: 'inherit', cwd: projectRoot })
process.exit(result.status ?? 1)
