// سازنده‌ی فایل ZIP بدون وابستگی (روش deflate استاندارد)
import { deflateRawSync } from 'node:zlib'

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// entries: [{ name: 'uploads/x.jpg', data: Buffer }]
export function makeZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    // فایل‌های .command / .sh باید بعد از اکسترکت اجرایی بمانند
    const exec = /\.(command|sh)$/i.test(e.name)
    const extAttrs = ((0o100000 | (exec ? 0o755 : 0o644)) >>> 0) * 65536  // مجوز یونیکس در ۱۶ بیت بالا
    const crc = crc32(e.data)
    const comp = deflateRawSync(e.data)
    const uSize = e.data.length
    const cSize = comp.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)   // signature
    local.writeUInt16LE(20, 4)           // version needed
    local.writeUInt16LE(0x0800, 6)       // flags: UTF-8 filename
    local.writeUInt16LE(8, 8)            // method: deflate
    local.writeUInt16LE(0, 10)           // mod time
    local.writeUInt16LE(0, 12)           // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(cSize, 18)
    local.writeUInt32LE(uSize, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)           // extra length

    chunks.push(local, nameBuf, comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)      // central dir signature
    cd.writeUInt16LE((3 << 8) | 20, 4)   // version made by: host=Unix, spec=2.0 (تا مجوزها اعمال شوند)
    cd.writeUInt16LE(20, 6)              // version needed
    cd.writeUInt16LE(0x0800, 8)          // flags
    cd.writeUInt16LE(8, 10)              // method
    cd.writeUInt16LE(0, 12)              // time
    cd.writeUInt16LE(0, 14)              // date
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(cSize, 20)
    cd.writeUInt32LE(uSize, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)              // extra len
    cd.writeUInt16LE(0, 32)              // comment len
    cd.writeUInt16LE(0, 34)              // disk number
    cd.writeUInt16LE(0, 36)              // internal attrs
    cd.writeUInt32LE(extAttrs, 38)       // external attrs: مجوز یونیکس فایل
    cd.writeUInt32LE(offset, 42)         // local header offset
    central.push(Buffer.concat([cd, nameBuf]))

    offset += local.length + nameBuf.length + comp.length
  }

  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)       // end of central dir signature
  end.writeUInt16LE(0, 4)                // disk
  end.writeUInt16LE(0, 6)                // cd start disk
  end.writeUInt16LE(entries.length, 8)   // entries this disk
  end.writeUInt16LE(entries.length, 10)  // total entries
  end.writeUInt32LE(cdBuf.length, 12)    // cd size
  end.writeUInt32LE(offset, 16)          // cd offset
  end.writeUInt16LE(0, 20)               // comment len

  return Buffer.concat([...chunks, cdBuf, end])
}
