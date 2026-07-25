// کپی کد سرور از «برنامه (دست نزنید)» به desktop/srv/
// data/ و uploads/ و فایل‌های زائد مک کپی نمی‌شوند.
import { cp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'برنامه (دست نزنید)')
const DST = join(HERE, 'srv')

const SKIP_DIR = new Set(['data', 'uploads', 'node_modules', '.git', '.claude', 'اپدیت', 'بکاپ‌ها'])
const skipFile = n => n.startsWith('._') || n === '.DS_Store' || n.endsWith('.zip')

if (!existsSync(SRC)) { console.error('✗ پوشه منبع پیدا نشد:\n  ' + SRC); process.exit(1) }

async function walk(src, dst) {
  await mkdir(dst, { recursive: true })
  for (const name of await readdir(src)) {
    if (SKIP_DIR.has(name) || skipFile(name)) continue
    const s = join(src, name), d = join(dst, name)
    if ((await stat(s)).isDirectory()) await walk(s, d)
    else await cp(s, d)
  }
}

await rm(DST, { recursive: true, force: true })
await walk(SRC, DST)

// package.json داخل app باید type:module داشته باشد تا fork بتواند ESM را لود کند
const pj = join(DST, 'package.json')
const j = existsSync(pj) ? JSON.parse(await readFile(pj, 'utf8')) : {}
if (j.type !== 'module') { j.type = 'module'; await writeFile(pj, JSON.stringify(j, null, 2)) }

let count = 0
const cnt = async d => { for (const n of await readdir(d)) {
  const p = join(d, n); (await stat(p)).isDirectory() ? await cnt(p) : count++ } }
await cnt(DST)
console.log(`✓ همگام‌سازی شد: ${count} فایل → desktop/srv/`)
