// پل امن بین رابط کاربری (renderer) و پروسه‌ی اصلی Electron.
// فقط چند تابع محدود و مشخص در اختیار صفحه قرار می‌گیرد؛ دسترسی مستقیم به Node داده نمی‌شود.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hesabdar', {
  isDesktop: true,
  // ساخت PDF از یک صفحه‌ی چاپیِ داخلی (مثل /print/unit/12) و ذخیره در پوشه‌ی «اسناد صادرشده»
  // path: مسیر نسبی که باید با /print/ شروع شود. filename: نام فایل بدون پسوند.
  savePdf: (path, filename) => ipcRenderer.invoke('hs:save-pdf', { path, filename }),
  // ساخت گروهی: آرایه‌ای از {path, filename} → آرایه‌ی نتایج
  savePdfBatch: (items) => ipcRenderer.invoke('hs:save-pdf-batch', { items }),
  // نمایش یک فایل/پوشه در Finder یا File Explorer
  revealPath: (path) => ipcRenderer.invoke('hs:reveal-path', { path }),
  // باز کردن پوشه‌ی «اسناد صادرشده»
  openOutDir: () => ipcRenderer.invoke('hs:open-outdir')
})
