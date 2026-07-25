// خواننده‌ی فایل ZIP بدون وابستگی (پشتیبانی از روش store و deflate)
import { inflateRawSync } from 'node:zlib'

// buf → [{ name, data:Buffer }]
export function readZip(buf) {
  // یافتن رکورد پایان دایرکتوری مرکزی (EOCD)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('فایل انتخاب‌شده یک زیپ معتبر نیست')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ساختار زیپ خراب است')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('هدر محلی زیپ خراب است')
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(dataStart, dataStart + compSize)
    let data
    if (method === 0) data = Buffer.from(comp)
    else if (method === 8) data = inflateRawSync(comp)
    else throw new Error('روش فشرده‌سازی پشتیبانی نمی‌شود')
    if (!name.endsWith('/')) entries.push({ name, data })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}
