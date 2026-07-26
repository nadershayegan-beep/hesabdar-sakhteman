// حسابدار ساختمان توی دید — پوسته‌ی Electron (اپ نصبی ویندوز/مک)
// سرور موجود (app/server.js) به‌عنوان پروسه‌ی فرزند با Node داخلی Electron اجرا می‌شود.
const { app, BrowserWindow, Menu, shell, dialog, session, ipcMain } = require('electron')
const { fork } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs/promises')

const SERVER = path.join(app.getAppPath(), 'srv', 'server.js')
const USER_DIR = app.getPath('userData')      // مسیر داده‌ی کاربر (قابل نوشتن، مستقل از آپدیت)

let child = null
let win = null
let splash = null
let serverUrl = null
let quitting = false

app.setName('حسابدار ساختمان توی دید')
if (!app.requestSingleInstanceLock()) { app.quit(); return }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

// ---------- پنجره‌ی در حال بالا آمدن ----------
function showSplash() {
  splash = new BrowserWindow({
    width: 460, height: 260, frame: false, resizable: false, center: true,
    backgroundColor: '#0f172a', show: true
  })
  const html = `<!doctype html><html dir="rtl"><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0f172a;color:#e5e7eb;
    font-family:Tahoma,system-ui,sans-serif;-webkit-user-select:none">
    <div style="font-size:19px;font-weight:700">حسابدار ساختمان توی دید</div>
    <div style="font-size:13px;opacity:.75">در حال آماده‌سازی…</div>
    <div style="width:190px;height:4px;background:#1f2937;border-radius:4px;overflow:hidden">
      <div style="width:40%;height:100%;background:#38bdf8;animation:m 1.1s ease-in-out infinite"></div></div>
    <div style="font-size:11px;opacity:.5;margin-top:6px">توی‌دید · toyedid.com</div>
    <style>@keyframes m{0%{margin-right:0}50%{margin-right:60%}100%{margin-right:0}}</style></body></html>`
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

// ---------- اجرای سرور ----------
function startServer() {
  return new Promise((resolve, reject) => {
    child = fork(SERVER, [], {
      execArgv: [],                       // سوییچ‌های Electron به فرزند منتقل نشود
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',        // فرزند به‌صورت Node خالص اجرا شود
        HS_PACKAGED: '1',                 // به server.js بگو در حالت اپ نصبی است
        HS_APP_VERSION: app.getVersion(), // نسخه‌ی واقعی نصب‌کننده (برای بررسی آپدیت)
        HS_USER_DIR: USER_DIR,            // داده اینجا ذخیره شود
        NO_PKG: '1',                      // ساخت بسته‌ی zip غیرفعال
        PORT: String(process.env.PORT || 3000)
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    if (child.stdout) child.stdout.on('data', d => process.stdout.write(String(d)))
    if (child.stderr) child.stderr.on('data', d => process.stderr.write(String(d)))

    const timer = setTimeout(() => reject(new Error('سرور در زمان مناسب بالا نیامد')), 30000)
    child.on('message', m => {
      if (!m || typeof m !== 'object') return
      if (m.type === 'ready') { clearTimeout(timer); serverUrl = `http://127.0.0.1:${m.port}`; resolve(serverUrl) }
      if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message || 'خطای سرور')) }
    })
    child.on('exit', code => {
      child = null
      if (quitting) return
      clearTimeout(timer)
      if (!serverUrl) return reject(new Error('سرور بسته شد (کد ' + code + ')'))
      dialog.showErrorBox('خطا', 'موتور برنامه بسته شد. لطفاً برنامه را دوباره باز کنید.')
      app.quit()
    })
  })
}

// ---------- پنجره‌ی اصلی ----------
function createWindow(url) {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1024, minHeight: 640,
    backgroundColor: '#ffffff', show: false, autoHideMenuBar: false,
    title: 'حسابدار ساختمان توی دید',
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false,
      preload: path.join(__dirname, 'preload.js') }
  })
  win.loadURL(url)
  win.once('ready-to-show', () => {
    if (splash) { splash.destroy(); splash = null }
    win.show()
    if (process.platform === 'win32') win.maximize()
  })
  // لینک‌های بیرونی در مرورگر پیش‌فرض باز شوند (بنر و لینک‌های توی‌دید)
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return { action: 'allow' }
    shell.openExternal(u); return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost')) { e.preventDefault(); shell.openExternal(u) }
  })
  win.on('closed', () => { win = null })
}

// دانلود بکاپ/CSV → پنجره‌ی «ذخیره در…»
function wireDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'ذخیره‌ی فایل', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) })
  })
}

// ---------- منوی فارسی ----------
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const tpl = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about', label: 'درباره' }, { type: 'separator' },
      { role: 'hide', label: 'پنهان کردن' }, { role: 'quit', label: 'خروج' }] }] : []),
    { label: 'پرونده', submenu: [
      { label: 'بازآوری صفحه', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
      { label: 'چاپ…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
      { label: 'پوشه‌ی داده‌ها', click: () => shell.openPath(USER_DIR) },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'بستن پنجره' } : { role: 'quit', label: 'خروج' }
    ] },
    { label: 'ویرایش', submenu: [
      { role: 'undo', label: 'واگرد' }, { role: 'redo', label: 'ازنو' }, { type: 'separator' },
      { role: 'cut', label: 'برش' }, { role: 'copy', label: 'رونوشت' }, { role: 'paste', label: 'چسباندن' },
      { role: 'selectAll', label: 'انتخاب همه' }
    ] },
    { label: 'نمایش', submenu: [
      { role: 'resetZoom', label: 'اندازه‌ی عادی' }, { role: 'zoomIn', label: 'بزرگ‌نمایی' },
      { role: 'zoomOut', label: 'کوچک‌نمایی' }, { type: 'separator' },
      { role: 'togglefullscreen', label: 'تمام‌صفحه' },
      { role: 'toggleDevTools', label: 'ابزار توسعه‌دهنده' }
    ] },
    { label: 'امنیت', submenu: [
      { label: 'ریست رمز مدیر…', click: async () => {
        const r = await dialog.showMessageBox(win, {
          type: 'warning', title: 'ریست رمز مدیر', message: 'رمز مدیر ساختمان ریست شود؟',
          detail: 'این کار فقط از روی همین کامپیوتر امکان‌پذیر است.\n' +
                  'بعد از تأیید، ۱۰ دقیقه فرصت دارید در صفحه‌ی ورود رمز جدید بگذارید.\n' +
                  'همه‌ی نشست‌های باز بسته می‌شوند. داده‌های مالی دست‌نخورده می‌ماند.',
          buttons: ['بله، ریست کن', 'انصراف'], defaultId: 1, cancelId: 1
        })
        if (r.response !== 0) return
        try { await fs.writeFile(path.join(USER_DIR, 'reset.request'), String(Date.now())) }
        catch (e) { return dialog.showErrorBox('خطا', String(e && e.message || e)) }
        if (win) win.reload()
        dialog.showMessageBox(win, { type: 'info', message: 'حالا در صفحه‌ی ورود روی «ریست از این کامپیوتر» بزنید.' })
      } }
    ] },
    { label: 'راهنما', submenu: [
      { label: 'دانلود نسخه‌ی جدید…', click: () => shell.openExternal('https://github.com/nadershayegan-beep/hesabdar-sakhteman/releases/latest') },
      { label: 'وب‌سایت توی‌دید', click: () => shell.openExternal('https://toyedid.com') },
      { label: 'نسخه‌ی برنامه', click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'درباره', message: 'حسابدار ساختمان توی دید',
          detail: 'نسخه ' + app.getVersion() + '\nمسیر داده‌ها:\n' + USER_DIR, buttons: ['باشه'] }) }
    ] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl))
}

// ---------- آپدیت خودکار (در صورت تنظیم publish) ----------
function checkUpdates() {
  if (!app.isPackaged) return
  try {
    // تا وقتی مخزن گیت‌هاب واقعی تنظیم نشده (owner=CHANGE_ME)، آپدیت خودکار را بی‌سروصدا رد کن
    try {
      const cfg = require('node:fs').readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
      if (cfg.includes('CHANGE_ME')) return
    } catch { }
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.on('error', () => { })   // خطاهای شبکه/آپدیت بی‌صدا نادیده گرفته شوند
    autoUpdater.on('update-downloaded', async () => {
      const r = await dialog.showMessageBox(win, {
        type: 'info', title: 'نسخه‌ی جدید', message: 'نسخه‌ی جدید آماده‌ی نصب است.',
        detail: 'داده‌های شما دست‌نخورده می‌ماند.', buttons: ['نصب و راه‌اندازی دوباره', 'بعداً'], defaultId: 0, cancelId: 1
      })
      if (r.response === 0) { quitting = true; if (child) child.kill(); autoUpdater.quitAndInstall() }
    })
    autoUpdater.checkForUpdates().catch(() => { })
  } catch { /* electron-updater تنظیم نشده — بی‌اهمیت */ }
}

// ---------- تولید PDF از صفحات چاپیِ داخلی ----------
const OUT_DIR = () => path.join(USER_DIR, 'اسناد صادرشده')
const safeFile = s => String(s || 'سند').replace(/[\/\\:*?"<>|\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90)

// یک صفحه‌ی /print/... را در پنجره‌ی پنهان بارگذاری و به PDF تبدیل و ذخیره می‌کند.
async function renderPdf(relPath, filename) {
  if (!serverUrl) throw new Error('سرور آماده نیست')
  if (!/^\/print\//.test(relPath || '')) throw new Error('مسیر نامعتبر')
  await fs.mkdir(OUT_DIR(), { recursive: true })
  const outPath = path.join(OUT_DIR(), safeFile(filename) + '.pdf')
  let pw = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  try {
    await pw.loadURL(serverUrl + relPath)              // با نشست مشترک، کوکی ورود ارسال می‌شود
    await pw.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : true'
    ).catch(() => {})
    const data = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, landscape: false })
    await fs.writeFile(outPath, data)
    return outPath
  } finally { if (pw) { pw.destroy(); pw = null } }
}

ipcMain.handle('hs:save-pdf', async (_e, { path: rel, filename }) => {
  try { const p = await renderPdf(rel, filename); shell.showItemInFolder(p); return { ok: true, path: p } }
  catch (e) { return { ok: false, error: String(e && e.message || e) } }
})

ipcMain.handle('hs:save-pdf-batch', async (_e, { items }) => {
  const out = []
  for (const it of (items || [])) {
    try { out.push({ ok: true, path: await renderPdf(it.path, it.filename), filename: it.filename }) }
    catch (e) { out.push({ ok: false, filename: it.filename, error: String(e && e.message || e) }) }
  }
  if (out.some(r => r.ok)) shell.openPath(OUT_DIR())
  return { ok: out.some(r => r.ok), results: out, dir: OUT_DIR() }
})

ipcMain.handle('hs:reveal-path', async (_e, { path: p }) => {
  try { shell.showItemInFolder(p); return { ok: true } } catch (e) { return { ok: false, error: String(e) } }
})

ipcMain.handle('hs:open-outdir', async () => {
  try { await fs.mkdir(OUT_DIR(), { recursive: true }); shell.openPath(OUT_DIR()); return { ok: true } }
  catch (e) { return { ok: false, error: String(e) } }
})

// ---------- چرخه‌ی عمر ----------
app.whenReady().then(async () => {
  buildMenu(); wireDownloads(); showSplash()
  try {
    const url = await startServer()
    createWindow(url)
    setTimeout(checkUpdates, 4000)
  } catch (err) {
    if (splash) { splash.destroy(); splash = null }
    dialog.showErrorBox('اجرای برنامه ناموفق بود', String(err && err.message || err))
    app.quit()
  }
})

app.on('window-all-closed', () => { quitting = true; app.quit() })
app.on('before-quit', () => { quitting = true; if (child) { try { child.kill() } catch { } } })
process.on('exit', () => { if (child) { try { child.kill() } catch { } } })
