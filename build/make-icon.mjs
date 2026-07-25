// ساخت آیکن ۱۰۲۴×۱۰۲۴ برنامه — Node خالص، بدون هیچ وابستگی (انکودر PNG دستی با node:zlib)
// طرح: مربع گرد با گرادیان تیره + سیلوئت ساختمان چندطبقه با پنجره‌های آبیِ روشن + درِ ورودی.
// خروجی: desktop/build/icon.png   ·  اجرا:  node build/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIZE = 1024
const buf = Buffer.alloc(SIZE * SIZE * 4) // RGBA، پیش‌فرض شفاف

const lerp = (a, b, t) => Math.round(a + (b - a) * t)
function px(x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y)
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
}
function rect(x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = Math.round(y0); y < Math.round(y1); y++)
    for (let x = Math.round(x0); x < Math.round(x1); x++) px(x, y, r, g, b, a)
}

// عضویت در مربع گرد (radius=R)
const R = 190
function inRounded(x, y) {
  const cx = x < R ? R : (x >= SIZE - R ? SIZE - R - 1 : null)
  const cy = y < R ? R : (y >= SIZE - R ? SIZE - R - 1 : null)
  if (cx !== null && cy !== null) return (x - cx) ** 2 + (y - cy) ** 2 <= R * R
  return true
}

// پس‌زمینه: گرادیان عمودی #0f172a → #1e293b
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1)
  const r = lerp(15, 30, t), g = lerp(23, 41, t), b = lerp(42, 59, t)
  for (let x = 0; x < SIZE; x++) if (inRounded(x, y)) px(x, y, r, g, b, 255)
}

// بدنه‌ی ساختمان
const bx0 = 330, by0 = 292, bx1 = 694, by1 = 840
rect(bx0, by0, bx1, by1, 22, 34, 58)

// پنجره‌های شبکه‌ای (۴×۶)
const cols = 4, rows = 6, wsz = 52, hsz = 52, pad = 34
const gridW = (bx1 - bx0) - 2 * pad, gridH = (by1 - by0) - 2 * pad
const gapX = (gridW - cols * wsz) / (cols - 1), gapY = (gridH - rows * hsz) / (rows - 1)
for (let c = 0; c < cols; c++) for (let rr = 0; rr < rows; rr++) {
  const x0 = bx0 + pad + c * (wsz + gapX), y0 = by0 + pad + rr * (hsz + gapY)
  const dim = ((c + rr) % 3 === 0)
  const col = dim ? [34, 116, 156] : [56, 189, 248]     // #38bdf8 روشن / نسخه‌ی کم‌رنگ‌تر
  rect(x0, y0, x0 + wsz, y0 + hsz, col[0], col[1], col[2])
}

// درِ ورودی (رنگ روشنِ ملایم)
const dw = 74, dh = 96, mid = (bx0 + bx1) / 2
rect(mid - dw / 2, by1 - dh, mid + dw / 2, by1, 150, 190, 214)

// ---------- انکودر PNG (RGBA، بدون وابستگی) ----------
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 }
  return t
})()
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8bit، RGBA
const stride = SIZE * 4
const raw = Buffer.alloc(SIZE * (stride + 1))
for (let y = 0; y < SIZE; y++) { raw[y * (stride + 1)] = 0; buf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride) }
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
writeFileSync(join(HERE, 'icon.png'), png)
console.log(`✓ آیکن ساخته شد: build/icon.png (${SIZE}×${SIZE}, ${png.length} بایت)`)
