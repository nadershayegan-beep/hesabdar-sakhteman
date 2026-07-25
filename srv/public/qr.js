// تولیدکننده‌ی QR Code بدون وابستگی — روش byte، سطح تصحیح خطا M، نسخه‌های ۱ تا ۱۰ (کافی برای URL)
// بر پایه‌ی الگوریتم Project Nayuki (متن‌باز)

const ECC_CW = { L: [, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], Q: [, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], H: [, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28] }
const NBLK = { L: [, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], Q: [, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] }

const EXP = new Uint8Array(256), LOG = new Uint8Array(256)
;(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D } })()
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]

function numRawModules(v) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36 } return r }
const numDataCw = (v, e) => Math.floor(numRawModules(v) / 8) - ECC_CW[e][v] * NBLK[e][v]

function rsDivisor(deg) {
  const res = new Array(deg).fill(0); res[deg - 1] = 1; let root = 1
  for (let i = 0; i < deg; i++) { for (let j = 0; j < res.length; j++) { res[j] = gfMul(res[j], root); if (j + 1 < res.length) res[j] ^= res[j + 1] } root = gfMul(root, 2) }
  return res
}
function rsRemainder(data, div) {
  const res = new Array(div.length).fill(0)
  for (const b of data) { const factor = b ^ res.shift(); res.push(0); for (let i = 0; i < res.length; i++) res[i] ^= gfMul(div[i], factor) }
  return res
}

// text → { size, modules[y][x] boolean }
export function qrMatrix(text, ecl = 'M') {
  const bytes = [...new TextEncoder().encode(text)]
  let ver = 1
  for (; ver <= 10; ver++) { const countBits = ver < 10 ? 8 : 16; if (4 + countBits + bytes.length * 8 <= numDataCw(ver, ecl) * 8) break }
  if (ver > 10) throw new Error('متن برای QR خیلی بلند است')
  const countBits = ver < 10 ? 8 : 16
  const bits = []
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1) }
  push(4, 4); push(bytes.length, countBits); for (const b of bytes) push(b, 8)
  const capBits = numDataCw(ver, ecl) * 8
  push(0, Math.min(4, capBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  for (let i = 0; bits.length < capBits; i++) push(i % 2 ? 0x11 : 0xEC, 8)
  const dataCw = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; dataCw.push(v) }

  const numBlocks = NBLK[ecl][ver], eccLen = ECC_CW[ecl][ver], rawCw = Math.floor(numRawModules(ver) / 8)
  const numShort = numBlocks - rawCw % numBlocks, shortLen = Math.floor(rawCw / numBlocks)
  const div = rsDivisor(eccLen), blocks = []; let k = 0
  for (let i = 0; i < numBlocks; i++) { const dl = (shortLen - eccLen) + (i < numShort ? 0 : 1); const dat = dataCw.slice(k, k + dl); k += dl; blocks.push({ dat, ecc: rsRemainder(dat, div) }) }
  const allCw = []
  const maxData = Math.max(...blocks.map(b => b.dat.length))
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dat.length) allCw.push(b.dat[i])
  for (let i = 0; i < eccLen; i++) for (const b of blocks) allCw.push(b.ecc[i])

  const size = ver * 4 + 17
  const mod = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true }

  // finder patterns
  const finder = (ox, oy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = ox + dx, y = oy + dy; if (x < 0 || x >= size || y < 0 || y >= size) continue
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
      setFn(x, y, d !== 2 && d !== 4)
    }
  }
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7)
  // timing
  for (let i = 0; i < size; i++) { if (!fn[6][i]) setFn(i, 6, i % 2 === 0); if (!fn[i][6]) setFn(6, i, i % 2 === 0) }
  // alignment
  const alignPos = () => {
    if (ver === 1) return []
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((size - 13) / (n - 1) / 2) * 2, res = [6]
    for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos)
    return res
  }
  const ap = alignPos()
  for (const ay of ap) for (const ax of ap) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  // reserve format (near finders) + version areas
  const reserve = () => {
    for (let i = 0; i < 9; i++) { if (!fn[i][8]) fn[i][8] = true; if (!fn[8][i]) fn[8][i] = true }
    for (let i = 0; i < 8; i++) { fn[size - 1 - i][8] = true; fn[8][size - 1 - i] = true }
    if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fn[size - 11 + j][i] = true; fn[i][size - 11 + j] = true }
  }
  reserve()
  setFn(8, size - 8, true) // dark module

  // place data with zigzag
  let idx = 0
  const placeData = () => {
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert
          if (!fn[y][x] && idx < allCw.length * 8) { mod[y][x] = ((allCw[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++ }
        }
      }
    }
  }
  placeData()

  // format info + masking
  const applyMask = (m, grid) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue
      let invert = false
      switch (m) {
        case 0: invert = (x + y) % 2 === 0; break
        case 1: invert = y % 2 === 0; break
        case 2: invert = x % 3 === 0; break
        case 3: invert = (x + y) % 3 === 0; break
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
        case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break
        case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break
        case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break
      }
      if (invert) grid[y][x] = !grid[y][x]
    }
  }
  const drawFormat = (m, grid) => {
    const eclBits = { M: 0, L: 1, H: 2, Q: 3 }[ecl]
    let data = eclBits << 3 | m, rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10 | rem) ^ 0x5412) & 0x7FFF
    for (let i = 0; i <= 5; i++) grid[i][8] = ((bits >>> i) & 1) !== 0
    grid[7][8] = ((bits >>> 6) & 1) !== 0; grid[8][8] = ((bits >>> 7) & 1) !== 0; grid[8][7] = ((bits >>> 8) & 1) !== 0
    for (let i = 9; i < 15; i++) grid[8][14 - i] = ((bits >>> i) & 1) !== 0
    for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = ((bits >>> i) & 1) !== 0
    for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = ((bits >>> i) & 1) !== 0
    grid[size - 8][8] = true
  }
  const penalty = grid => {
    let p = 0
    for (let y = 0; y < size; y++) { let run = 1; for (let x = 1; x < size; x++) { if (grid[y][x] === grid[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1 } }
    for (let x = 0; x < size; x++) { let run = 1; for (let y = 1; y < size; y++) { if (grid[y][x] === grid[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1 } }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) p += 3
    let dark = 0; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (grid[y][x]) dark++
    const ratio = Math.floor((Math.abs(dark * 20 - size * size * 10) + size * size - 1) / (size * size)); p += ratio * 10
    return p
  }

  let best = null, bestP = Infinity, bestMask = 0
  for (let m = 0; m < 8; m++) {
    const grid = mod.map(r => r.slice())
    applyMask(m, grid); drawFormat(m, grid)
    const pen = penalty(grid)
    if (pen < bestP) { bestP = pen; best = grid; bestMask = m }
  }
  return { size, modules: best }
}

// خروجی SVG (رشته)
export function qrSvg(text, { scale = 6, margin = 4, dark = '#111', light = '#fff' } = {}) {
  const { size, modules } = qrMatrix(text)
  const dim = (size + margin * 2) * scale
  let rects = ''
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x])
    rects += `<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`
}
