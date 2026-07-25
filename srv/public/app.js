import { toJalaali, toGregorian } from '/jalaali.js'
import { qrSvg } from '/qr.js'
const gStr = (jy, jm, jd) => { const g = toGregorian(jy, jm, jd); return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}` }

// ==================== کمک‌کارهای پایه ====================
const $ = s => document.querySelector(s)
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
const faDigit = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d])
const enDigit = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
const sep = n => faDigit(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'))
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// متن‌هایی که از سرور می‌آیند و عدد لاتین دارند (مثل «تیر 1405») با ارقام فارسی نمایش داده شوند
const escFa = s => faDigit(esc(s))

// واحد پول: همه‌چیز به ریال ذخیره می‌شود، نمایش طبق تنظیمات
let MONEY_UNIT = 'toman'
const r2d = r => MONEY_UNIT === 'toman' ? (r || 0) / 10 : (r || 0)
const d2r = d => MONEY_UNIT === 'toman' ? Math.round(d * 10) : Math.round(d)
const money = r => sep(Math.round(r2d(r)))
const curFa = () => MONEY_UNIT === 'toman' ? 'تومان' : 'ریال'
const moneyU = r => money(r) + ' ' + curFa()
const signed = r => (r < 0 ? '−' : '') + money(Math.abs(r))

const api = (u, o) => fetch(u, o).then(async r => {
  const d = await r.json().catch(() => ({}))
  if (r.status === 401) { location.reload(); throw new Error('نیاز به ورود') }
  if (!r.ok) throw new Error(d.error || 'خطای ارتباط با سرور')
  return d
})
const post = (u, body, method = 'POST') => api(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })

let toastT = null
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '')
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 3000)
}
const guard = fn => async (...a) => { try { await fn(...a) } catch (e) { toast(e.message, true) } }

// ---------- مودال ----------
function openModal(title, bodyHtml, footHtml) {
  $('#modalTitle').textContent = title
  $('#modalBody').innerHTML = bodyHtml
  const f = $('#modalFoot')
  if (footHtml) { f.innerHTML = footHtml; f.classList.remove('hidden') } else { f.innerHTML = ''; f.classList.add('hidden') }
  $('#modal').classList.remove('hidden')
  return $('#modalBody')
}
const closeModal = () => $('#modal').classList.add('hidden')
$('#modalX').onclick = closeModal
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal() }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

function confirmBox(msg, onYes) {
  openModal('تأیید', `<p style="font-size:14px;line-height:2">${esc(msg)}</p>`,
    `<button class="btn danger" id="cfYes">بله، انجام شود</button><button class="btn" id="cfNo">انصراف</button>`)
  $('#cfNo').onclick = closeModal
  $('#cfYes').onclick = guard(async () => { closeModal(); await onYes() })
}

// ---------- تاریخ ----------
const todayJ = () => { const d = new Date(); return toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
function dateBoxHtml(pre, j) {
  const t = j || todayJ()
  return `<div class="datebox">
    <input class="inp y num" id="${pre}y" value="${faDigit(t.jy)}" inputmode="numeric"><span>/</span>
    <input class="inp m num" id="${pre}m" value="${faDigit(String(t.jm).padStart(2, '0'))}" inputmode="numeric"><span>/</span>
    <input class="inp d num" id="${pre}d" value="${faDigit(String(t.jd).padStart(2, '0'))}" inputmode="numeric">
    <button type="button" class="today" data-today="${pre}">امروز</button></div>`
}
const readDate = pre => ({ jy: +enDigit($('#' + pre + 'y').value), jm: +enDigit($('#' + pre + 'm').value), jd: +enDigit($('#' + pre + 'd').value) })
function wireToday(root = document) {
  root.querySelectorAll('[data-today]').forEach(b => b.onclick = () => {
    const p = b.dataset.today, t = todayJ()
    $('#' + p + 'y').value = faDigit(t.jy); $('#' + p + 'm').value = faDigit(String(t.jm).padStart(2, '0')); $('#' + p + 'd').value = faDigit(String(t.jd).padStart(2, '0'))
  })
}

// ---------- مبلغ ----------
function bindMoney(input, hintEl) {
  const upd = () => {
    const raw = enDigit(input.value).replace(/[^\d]/g, '')
    input.value = raw ? sep(raw) : ''
    if (hintEl) hintEl.textContent = raw ? sep(raw) + ' ' + curFa() : ''
  }
  input.addEventListener('input', upd); upd()
}
const readMoney = input => d2r(+enDigit(input.value).replace(/[^\d]/g, '') || 0)
function wireMoney(root = document) {
  root.querySelectorAll('[data-money]').forEach(i => { if (!i.dataset.bound) { i.dataset.bound = '1'; bindMoney(i, i.dataset.money ? root.querySelector('#' + i.dataset.money) : null) } })
}

// ---------- آپلود سند ----------
const readFileDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
const loadImg = f => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f) })
async function maybeCompress(file, maxKB = 120, maxDim = 1600) {
  if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif') return file
  if (file.size <= maxKB * 1024) return file
  let img; try { img = await loadImg(file) } catch { return file }
  let w = img.naturalWidth, h = img.naturalHeight
  if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s) }
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(img.src)
  let q = .82, blob = null
  for (let i = 0; i < 6; i++) {
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q))
    if (!blob || blob.size <= maxKB * 1024 || q <= .35) break
    q -= .12
  }
  if (!blob || blob.size >= file.size) return file
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}
function docPickerHtml(id) {
  return `<label class="drop" id="${id}Lbl" for="${id}">📎 افزودن سند (عکس فیش یا PDF)
    <input type="file" id="${id}" accept="image/*,application/pdf" hidden></label>`
}
function wireDocPicker(id, store) {
  const inp = $('#' + id), lbl = $('#' + id + 'Lbl'); if (!inp) return
  inp.onchange = guard(async () => {
    const f = inp.files[0]; if (!f) { store.doc = null; lbl.className = 'drop'; lbl.textContent = '📎 افزودن سند'; return }
    const c = await maybeCompress(f)
    store.doc = { name: c.name, dataUrl: await readFileDataUrl(c) }
    lbl.className = 'drop has'; lbl.textContent = '✅ ' + c.name
  })
}

// ==================== تم ====================
const themeKey = 'sakhteman-theme'
const applyTheme = t => t ? document.documentElement.setAttribute('data-theme', t) : document.documentElement.removeAttribute('data-theme')
applyTheme(localStorage.getItem(themeKey))
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme')
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches
  const next = dark ? 'light' : 'dark'; localStorage.setItem(themeKey, next); applyTheme(next)
}

// ==================== وضعیت ====================
let ME = null, META = null, VIEW = 'dashboard', setupMode = false, LAN_URL = '', APP_VER = ''
const isAdmin = () => ME && ME.role === 'admin'
const adminOnly = html => isAdmin() ? html : ''
const unitById = id => (META.units || []).find(u => u.id === +id)
const fundById = id => (META.funds || []).find(f => f.id === +id)
const catById = id => (META.categories || []).find(c => c.id === +id)

async function loadMeta() { META = await api('/api/meta'); MONEY_UNIT = META.displayUnit || 'toman'; $('#brandName').textContent = META.buildingName || 'حسابدار ساختمان' }

// ==================== احراز هویت ====================
async function boot() {
  const st = await api('/api/auth/status')
  $('#verLbl').textContent = st.version || ''
  LAN_URL = st.lanUrl || ''; APP_VER = st.version || ''
  if (st.needsSetup) { setupMode = true; showAuth(true); return }
  if (!st.user) { showAuth(false); return }
  ME = st.user
  $('#auth').classList.add('hidden'); $('#shell').classList.remove('hidden')
  $('#meName').textContent = ME.name; $('#meRole').textContent = ME.roleFa
  await loadMeta()
  if (!isAdmin()) $('#nav').querySelector('[data-view="settings"]').classList.add('hidden')
  render()
}
function showAuth(setup) {
  $('#auth').classList.remove('hidden'); $('#shell').classList.add('hidden')
  $('#authTitle').textContent = setup ? 'ساخت حساب مدیر ساختمان' : 'ورود'
  $('#authSub').textContent = setup ? 'اولین اجرا — حساب مدیر را بسازید' : 'برای ادامه وارد شوید'
  $('#authBtn').textContent = setup ? 'ساخت حساب' : 'ورود'
  $('#authNameWrap').hidden = !setup; $('#authBuildingWrap').hidden = !setup
  $('#authPass').autocomplete = setup ? 'new-password' : 'current-password'
}
$('#authForm').onsubmit = async e => {
  e.preventDefault(); $('#authErr').textContent = ''
  const username = $('#authUser').value.trim(), password = $('#authPass').value
  try {
    if (setupMode) {
      await post('/api/auth/setup', { username, password, displayName: $('#authName').value.trim(), buildingName: $('#authBuilding').value.trim() })
      setupMode = false
    }
    await post('/api/auth/login', { username, password })
    location.reload()
  } catch (err) { $('#authErr').textContent = err.message }
}
$('#logoutBtn').onclick = guard(async () => { await post('/api/auth/logout'); location.reload() })

// ==================== مسیریابی ====================
$('#nav').onclick = e => {
  const b = e.target.closest('.nav-i'); if (!b) return
  VIEW = b.dataset.view
  $('#nav').querySelectorAll('.nav-i').forEach(x => x.classList.toggle('on', x === b))
  render()
}
const VIEWS = {}
function render() { const f = VIEWS[VIEW] || VIEWS.dashboard; $('#view').innerHTML = '<div class="empty">در حال بارگذاری…</div>'; f().catch(e => { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>` }) }
async function refresh() { await loadMeta(); render() }

const head = (title, sub, actions = '') =>
  `<div class="vhead printhide"><div><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div><div class="fbtns">${actions}</div></div>`
const kpi = (lbl, val, d = '', cls = '') =>
  `<div class="kpi ${cls}"><div class="lbl">${esc(lbl)}</div><div class="val num">${val}<span class="r"> ${curFa()}</span></div>${d ? `<div class="d">${d}</div>` : ''}</div>`
const emptyRow = (cols, msg) => `<tr><td colspan="${cols}"><div class="empty">${esc(msg)}</div></td></tr>`
const statusBadge = s => s === 'settled' ? '<span class="badge b-settled">تسویه</span>' : '<span class="badge b-open">باز</span>'

// ==================== داشبورد ====================
VIEWS.dashboard = async () => {
  const d = await api('/api/report/dashboard')
  const missing = d.missingCharges || []
  const notice = missing.length && isAdmin()
    ? `<div class="notice printhide"><span>⚠️ شارژ ${missing.length === 1 ? 'ماه' : missing.length + ' ماه'} صادر نشده است: ${missing.map(m => escFa(m.fa)).join('، ')}</span>
       <button class="btn small primary" id="issueAll">صدور شارژ این ماه‌ها</button></div>` : ''
  $('#view').innerHTML = head('داشبورد', `${esc(META.buildingName)} · ${escFa(d.monthFa)} · ${faDigit(d.unitCount)} واحد فعال`,
    adminOnly(`<button class="btn primary" id="qInvoice">＋ فاکتور</button><button class="btn" id="qPayment">＋ دریافتی</button>`)) + notice +
    `<div class="kpis">
      ${kpi('موجودی کل صندوق‌ها', money(d.fundTotal), d.funds.map(f => `${esc(f.name)}: ${money(f.balance)}`).join(' · '), 'hero')}
      ${kpi('کل بدهی ساکنین', money(d.totalDebt), '', 'bad')}
      ${kpi('کل بستانکاری', money(d.totalCredit), 'علی‌الحساب واحدها', 'good')}
      ${kpi('طلب مدیر از صندوق', money(d.managerDebt), 'پرداخت‌شده از جیب مدیر', d.managerDebt > 0 ? 'warn' : '')}
      ${kpi('دریافتی ' + faDigit(d.monthFa), money(d.monthIn), '', 'good')}
      ${kpi('شارژ صادرشده ' + faDigit(d.monthFa), money(d.monthCharge ?? 0), 'تعهد شارژ ساکنین این ماه')}
      ${kpi('هزینه ' + faDigit(d.monthFa), money(d.monthExpense ?? d.monthOut), 'بدون شارژ ماهانه', 'bad')}
      ${kpi('خالص ماه', signed(d.monthIn - (d.monthExpense ?? d.monthOut)), 'دریافتی منهای هزینه')}
      ${kpi('هزینه‌های پرداخت‌نشده', money(d.unpaidExpenses ?? 0), 'بدهی صندوق به فاکتورها', (d.unpaidExpenses ?? 0) > 0 ? 'warn' : '')}
    </div>
    ${(d.interFund && d.interFund.length) ? `<div class="notice printhide">↔️ بدهی بین صندوق‌ها: ${d.interFund.map(x => `${escFa(x.fromName)} به ${escFa(x.toName)} ${money(x.amount)} ${curFa()}`).join('، ')} — از صفحه‌ی صندوق‌ها تسویه کنید</div>` : ''}
    <div class="grid2">
      <div class="panel"><div class="phead"><b>۵ بدهکار بزرگ</b><button class="link" data-go="reports">گزارش بدهکاران</button></div>
        <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>بدهی</th><th>قدمت</th></tr></thead><tbody>
        ${d.topDebtors.length ? d.topDebtors.map(u => `<tr class="clickable" data-unit="${u.id}"><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
          <td class="num amt-out">${money(u.debt)}</td><td>${u.aging ? `<span class="badge b-open">${u.aging.bucket}</span>` : '—'}</td></tr>`).join('')
        : emptyRow(4, 'هیچ بدهکاری وجود ندارد 🎉')}
        </tbody></table></div></div>
      <div class="panel"><div class="phead"><b>فاکتورهای باز اخیر</b><button class="link" data-go="invoices">همه‌ی فاکتورها</button></div>
        <div class="tablewrap"><table class="tx"><thead><tr><th>عنوان</th><th>تاریخ</th><th>مبلغ</th><th>مانده</th></tr></thead><tbody>
        ${d.openInvoices.length ? d.openInvoices.map(i => `<tr class="clickable" data-inv="${i.id}"><td><b>${esc(i.title)}</b><br><span class="catpill">${esc(i.categoryName)}</span></td>
          <td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td><td class="num amt-out">${money(i.remaining)}</td></tr>`).join('')
        : emptyRow(4, 'فاکتور بازی نیست')}
        </tbody></table></div></div>
    </div>`
  wireCommon()
  if ($('#issueAll')) $('#issueAll').onclick = guard(async () => {
    for (const m of missing) await post('/api/charge/issue', { period: m.period })
    toast('شارژ ماه‌های جامانده صادر شد'); refresh()
  })
  if ($('#qInvoice')) $('#qInvoice').onclick = () => invoiceForm()
  if ($('#qPayment')) $('#qPayment').onclick = () => paymentForm()
}
function wireCommon() {
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    VIEW = b.dataset.go
    $('#nav').querySelectorAll('.nav-i').forEach(x => x.classList.toggle('on', x.dataset.view === VIEW))
    render()
  })
  document.querySelectorAll('[data-unit]').forEach(r => r.onclick = () => showUnitCard(+r.dataset.unit))
  document.querySelectorAll('[data-inv]').forEach(r => r.onclick = () => showInvoice(+r.dataset.inv))
}

// ==================== فاکتورها ====================
let invFilter = { status: '', category_id: '', q: '' }
VIEWS.invoices = async () => {
  const rows = await api('/api/invoices?' + new URLSearchParams(Object.fromEntries(Object.entries(invFilter).filter(([, v]) => v))))
  const totals = rows.reduce((a, i) => ({ amount: a.amount + i.amount, collected: a.collected + i.collected, remaining: a.remaining + i.remaining }), { amount: 0, collected: 0, remaining: 0 })
  $('#view').innerHTML = head('فاکتورها و هزینه‌ها', 'هر فاکتور بین واحدهای مشمول تسهیم می‌شود',
    adminOnly(`<button class="btn primary" id="newInv">＋ ثبت فاکتور</button>`) + `<a class="btn" href="/api/export/invoices">⬇️ CSV</a>`) +
    `<div class="filters printhide">
      <input class="inp" id="fq" placeholder="جستجو در عنوان…" value="${esc(invFilter.q)}">
      <select class="inp" id="fcat"><option value="">همه‌ی دسته‌ها</option>${META.categories.map(c => `<option value="${c.id}" ${invFilter.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="chips">${[['', 'همه'], ['open', 'باز'], ['settled', 'تسویه']].map(([v, t]) => `<button class="chip ${invFilter.status === v ? 'on' : ''}" data-st="${v}">${t}</button>`).join('')}</div>
    </div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>مبلغ</th><th>تسهیم</th><th>وصول‌شده</th><th>مانده</th><th>وضعیت</th>${adminOnly('<th></th>')}</tr></thead>
      <tbody>${rows.length ? rows.map(i => `<tr class="clickable" data-inv="${i.id}">
        <td><b>${esc(i.title)}</b>${i.is_charge ? ' <span class="badge b-charge">شارژ</span>' : ''}${i.paid_by_manager ? ' <span class="badge b-mgr">جیب مدیر</span>' : ''}${(i.payable && i.fundUnpaid > 0) ? ' <span class="badge b-open">از صندوق پرداخت‌نشده</span>' : (i.payable ? ' <span class="badge b-settled">از صندوق پرداخت‌شده</span>' : '')}${i.vendor ? `<br><span class="dim" style="font-size:11px;color:var(--faint)">${esc(i.vendor)}</span>` : ''}</td>
        <td><span class="catpill">${esc(i.categoryName)}</span></td>
        <td class="num">${faDigit(i.j_date)}</td>
        <td class="num">${money(i.amount)}</td>
        <td><span class="catpill">${esc(i.methodFa)}</span></td>
        <td class="num amt-in">${money(i.collected)}</td>
        <td class="num ${i.remaining > 0 ? 'amt-out' : ''}">${money(i.remaining)}</td>
        <td>${statusBadge(i.status)}</td>
        ${adminOnly(`<td><button class="del" data-delinv="${i.id}" title="حذف">🗑</button></td>`)}</tr>`).join('')
      : emptyRow(isAdmin() ? 9 : 8, 'هنوز فاکتوری ثبت نشده است')}</tbody>
      ${rows.length ? `<tfoot><tr><td colspan="3">جمع (${faDigit(rows.length)} فاکتور)</td><td class="num">${money(totals.amount)}</td><td></td>
        <td class="num">${money(totals.collected)}</td><td class="num">${money(totals.remaining)}</td><td colspan="${isAdmin() ? 2 : 1}"></td></tr></tfoot>` : ''}
    </table></div></div>`
  wireCommon()
  $('#fq').oninput = debounce(() => { invFilter.q = $('#fq').value.trim(); render() }, 350)
  $('#fcat').onchange = () => { invFilter.category_id = $('#fcat').value; render() }
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { invFilter.status = b.dataset.st; render() })
  document.querySelectorAll('[data-delinv]').forEach(b => b.onclick = e => {
    e.stopPropagation()
    confirmBox('این فاکتور و همه‌ی سهم‌هایش حذف شود؟ پرداخت‌های تخصیص‌یافته آزاد و به بدهی‌های دیگر منتقل می‌شوند.',
      async () => { await api(`/api/invoices/${b.dataset.delinv}`, { method: 'DELETE' }); toast('فاکتور حذف شد'); refresh() })
  })
  if ($('#newInv')) $('#newInv').onclick = () => invoiceForm()
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

// ---------- فرم فاکتور ----------
function invoiceForm(inv) {
  const store = { doc: null, custom: {} }
  const cats = META.categories, funds = META.funds
  const c0 = inv ? catById(inv.category_id) : (cats.find(c => !c.is_charge_cat) || cats[0])
  const j = inv ? { jy: +inv.j_date.slice(0, 4), jm: +inv.j_date.slice(5, 7), jd: +inv.j_date.slice(8, 10) } : null
  const body = openModal(inv ? 'ویرایش فاکتور' : 'ثبت فاکتور جدید', `
    <div class="form">
      <label class="f">عنوان فاکتور<input class="inp" id="ivTitle" placeholder="مثلاً: تعمیر مشعل موتورخانه" value="${esc(inv ? inv.title : '')}"></label>
      <div class="frow">
        <label class="f">دسته‌ی هزینه<select class="inp" id="ivCat">${cats.map(c => `<option value="${c.id}" ${c0 && c0.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="f">مبلغ کل (${curFa()})<input class="inp num" id="ivAmount" data-money="ivAmountHint" inputmode="numeric" value="${inv ? sep(Math.round(r2d(inv.amount))) : ''}"><span class="hint" id="ivAmountHint"></span></label>
      </div>
      <div class="frow">
        <label class="f">روش تسهیم<select class="inp" id="ivMethod">${META.methods.map(m => `<option value="${m.value}" ${(inv ? inv.method : c0 && c0.default_method) === m.value ? 'selected' : ''}>${esc(m.fa)}</option>`).join('')}</select></label>
        <label class="f">صندوق مسئول (بودجه)<select class="inp" id="ivFund">${funds.map(f => `<option value="${f.id}" ${(inv ? inv.fund_id : c0 && c0.default_fund_id) === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      </div>
      <div class="frow">
        <label class="f">تاریخ${dateBoxHtml('iv', j)}</label>
        <label class="f">نوع هزینه<select class="inp" id="ivKind">${META.expenseKinds.map(k => `<option value="${k.value}" ${(inv ? inv.expense_kind : 'variable') === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="ivVacant" ${(inv ? inv.include_vacant : c0 && c0.include_vacant) ? 'checked' : ''}> واحدهای خالی هم سهم بدهند</label>
      <label class="check"><input type="checkbox" id="ivMgr" ${inv && inv.paid_by_manager ? 'checked' : ''}> مدیر از جیب خودش پرداخت کرده (طلب مدیر)</label>
      <div class="frow">
        <label class="f">پیمانکار / فروشنده<input class="inp" id="ivVendor" value="${esc(inv ? inv.vendor : '')}"></label>
        <label class="f">توضیح<input class="inp" id="ivNote" value="${esc(inv ? inv.note : '')}"></label>
      </div>
      ${docPickerHtml('ivDoc')}
      <div class="panel" style="margin:0;background:var(--panel-2)">
        <div class="phead"><b>پیش‌نمایش تسهیم</b><span class="hint strong" id="ivSum"></span></div>
        <div class="tablewrap" id="ivPreview"><div class="empty">در حال محاسبه…</div></div>
      </div>
    </div>`,
    `<button class="btn primary" id="ivSave">${inv ? 'ذخیره‌ی تغییرات' : 'ثبت فاکتور'}</button><button class="btn" id="ivCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); wireDocPicker('ivDoc', store)
  $('#ivCancel').onclick = closeModal

  const readForm = () => ({
    title: $('#ivTitle').value.trim(), categoryId: +$('#ivCat').value, amount: readMoney($('#ivAmount')),
    method: $('#ivMethod').value, includeVacant: $('#ivVacant').checked, fundId: +$('#ivFund').value,
    expenseKind: $('#ivKind').value, paidByManager: $('#ivMgr').checked,
    vendor: $('#ivVendor').value.trim(), note: $('#ivNote').value.trim(),
    custom: store.custom, ...readDate('iv')
  })
  // انتخاب دسته ⇒ روش و صندوق و شمول واحد خالیِ پیش‌فرضِ همان دسته
  $('#ivCat').onchange = () => {
    const c = catById(+$('#ivCat').value); if (!c) return
    $('#ivMethod').value = c.default_method
    if (c.default_fund_id) $('#ivFund').value = c.default_fund_id
    $('#ivVacant').checked = !!c.include_vacant
    preview()
  }
  const preview = debounce(guard(async () => {
    const f = readForm()
    const r = await post('/api/invoices/preview', { amount: f.amount, method: f.method, includeVacant: f.includeVacant, custom: f.custom })
    const isCustom = f.method === 'custom'
    $('#ivSum').textContent = `${faDigit(r.rows.length)} واحد · جمع سهم‌ها: ${moneyU(r.total)}`
    $('#ivPreview').innerHTML = r.rows.length ? `<table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>متراژ</th><th>نفرات</th><th>سهم (${curFa()})</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><b>${escFa(x.number)}</b>${x.occupied ? '' : ' <span class="badge b-vacant">خالی</span>'}</td><td>${esc(x.resident || '—')}</td>
        <td class="num">${faDigit(x.area || 0)}</td><td class="num">${faDigit(x.occupants || 0)}</td>
        <td class="num">${isCustom ? `<input class="inp num" style="width:130px;padding:6px 8px" data-cu="${x.unit_id}" value="${sep(Math.round(r2d(x.share_amount)))}" inputmode="numeric">` : money(x.share_amount)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">هیچ واحد مشمولی نیست — ابتدا واحدها را وارد کنید</div>'
    if (isCustom) $('#ivPreview').querySelectorAll('[data-cu]').forEach(i => {
      i.oninput = () => {
        const raw = enDigit(i.value).replace(/[^\d]/g, ''); i.value = raw ? sep(raw) : ''
        store.custom[i.dataset.cu] = d2r(+raw || 0)
        const tot = Object.values(store.custom).reduce((s, v) => s + v, 0)
        $('#ivSum').textContent = `جمع سهم‌های دستی: ${moneyU(tot)}`
      }
      if (store.custom[i.dataset.cu] == null) store.custom[i.dataset.cu] = d2r(+enDigit(i.value).replace(/[^\d]/g, '') || 0)
    })
  }), 300)
  ;['#ivAmount', '#ivMethod', '#ivVacant'].forEach(s => { $(s).addEventListener('input', preview); $(s).addEventListener('change', preview) })
  $('#ivMethod').onchange = () => { store.custom = {}; preview() }
  preview()

  $('#ivSave').onclick = guard(async () => {
    const f = readForm(); f.doc = store.doc
    if (!f.title) throw new Error('عنوان فاکتور را وارد کنید')
    const r = inv ? await api(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      : await post('/api/invoices', f)
    closeModal(); toast(`فاکتور ${moneyU(r.amount)} بین ${faDigit(r.shareCount)} واحد تسهیم شد`); refresh()
  })
}

// ---------- جزئیات فاکتور ----------
const showInvoice = guard(async id => {
  const d = await api(`/api/invoice/${id}`)
  const i = d.invoice
  openModal(i.title, `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
      ${kpi('مبلغ کل', money(i.amount))}${kpi('وصول‌شده', money(i.collected), '', 'good')}${kpi('مانده', money(i.remaining), '', i.remaining > 0 ? 'bad' : '')}
    </div>
    <div class="pline"><span>دسته</span><b>${esc(i.categoryName)}</b></div>
    <div class="pline"><span>تاریخ</span><b class="num">${faDigit(i.j_date)}</b></div>
    <div class="pline"><span>روش تسهیم</span><b>${esc(i.methodFa)}</b></div>
    <div class="pline"><span>نوع هزینه</span><b>${esc(i.kindFa)}</b></div>
    <div class="pline"><span>صندوق</span><b>${esc(i.fundName)}</b></div>
    <div class="pline"><span>واحد خالی سهم دارد؟</span><b>${i.include_vacant ? 'بله' : 'خیر'}</b></div>
    <div class="pline"><span>پرداخت از جیب مدیر</span><b>${i.paid_by_manager ? 'بله' : 'خیر'}</b></div>
    ${i.vendor ? `<div class="pline"><span>پیمانکار</span><b>${esc(i.vendor)}</b></div>` : ''}
    ${i.note ? `<div class="pline"><span>توضیح</span><b>${esc(i.note)}</b></div>` : ''}
    ${i.doc_file ? `<div class="pline"><span>سند</span><a class="doclink" href="/uploads/${encodeURI(i.doc_file)}" target="_blank">مشاهده‌ی سند 📎</a></div>` : ''}
    <h4 style="margin:16px 0 8px">ریز سهم واحدها</h4>
    <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
      ${d.shares.map(s => `<tr><td><b>${escFa(s.number)}</b>${s.occupied ? '' : ' <span class="badge b-vacant">خالی</span>'}</td><td>${esc(s.resident_name || '—')}</td>
        <td class="num">${money(s.share_amount)}</td><td class="num amt-in">${money(s.paid)}</td>
        <td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${money(s.remaining)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2">جمع</td><td class="num">${money(i.amount)}</td><td class="num">${money(i.collected)}</td><td class="num">${money(i.remaining)}</td></tr></tfoot></table></div>
    ${d.debtors.length ? `<h4 style="margin:16px 0 8px">بدهکاران این فاکتور (${faDigit(d.debtors.length)})</h4>
      <div class="tablewrap"><table class="tx"><tbody>${d.debtors.map(s => `<tr><td><b>واحد ${escFa(s.number)}</b> ${esc(s.resident_name || '')}</td><td class="num amt-out">${money(s.remaining)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${i.payable ? `<h4 style="margin:18px 0 8px">پرداخت این هزینه از صندوق</h4>
      <div class="pline"><span>پرداخت‌شده از صندوق‌ها</span><b class="num amt-in">${money(i.fundPaid)}</b></div>
      <div class="pline"><span>پرداخت‌نشده (بدهی صندوق به این هزینه)</span><b class="num ${i.fundUnpaid > 0 ? 'amt-out' : 'pos'}">${money(i.fundUnpaid)}</b></div>
      <div class="pline"><span>صندوق مسئول (بودجه)</span><b>${esc(i.fundName)}</b></div>
      ${d.fundPayments.length ? `<div class="tablewrap" style="margin-top:8px"><table class="tx"><thead><tr><th>از صندوق</th><th>تاریخ</th><th>مبلغ</th>${adminOnly('<th></th>')}</tr></thead><tbody>
        ${d.fundPayments.map(ep => `<tr><td>${esc(ep.fund_name || '—')}${ep.fund_id !== i.fund_id ? ' <span class="badge b-mgr">صندوق دیگر</span>' : ''}</td>
          <td class="num">${faDigit(ep.j_date)}</td><td class="num amt-out">${money(ep.amount)}</td>
          ${adminOnly(`<td><button class="del" data-delep="${ep.id}">🗑</button></td>`)}</tr>`).join('')}
        </tbody></table></div>` : '<p class="hint" style="margin:6px 0 0">هنوز از هیچ صندوقی پرداخت نشده است.</p>'}` : ''}`,
    `${adminOnly(`<button class="btn" id="invEdit">✏️ ویرایش</button>`)}${(isAdmin() && i.payable && i.fundUnpaid > 0) ? `<button class="btn primary" id="invPay">💸 پرداخت از صندوق</button>` : ''}<a class="btn" href="/api/export/invoice?id=${i.id}">⬇️ CSV</a><button class="btn" id="invClose">بستن</button>`)
  $('#invClose').onclick = closeModal
  if ($('#invEdit')) $('#invEdit').onclick = () => { closeModal(); invoiceForm(i) }
  if ($('#invPay')) $('#invPay').onclick = () => payExpenseForm(i, d.funds)
  document.querySelectorAll('[data-delep]').forEach(b => b.onclick = () => confirmBox('این پرداخت از صندوق حذف شود؟ پول به صندوق برمی‌گردد.',
    async () => { await api(`/api/expense-payments/${b.dataset.delep}`, { method: 'DELETE' }); toast('پرداخت حذف شد'); closeModal(); refresh(); showInvoice(i.id) }))
})
function payExpenseForm(inv, funds) {
  const responsible = (funds.find(f => f.id === inv.fund_id) || {}).name || '—'
  const body = openModal(`پرداخت هزینه: ${inv.title}`, `<div class="form">
    <div class="notice" style="margin:0">مانده‌ی پرداخت‌نشده‌ی این هزینه: <b>${moneyU(inv.fundUnpaid)}</b></div>
    <div class="frow">
      <label class="f">از کدام صندوق پرداخت شود<select class="inp" id="exFund">${funds.map(f => `<option value="${f.id}" ${f.id === inv.fund_id ? 'selected' : ''}>${esc(f.name)} (موجودی ${money(f.balance)})</option>`).join('')}</select></label>
      <label class="f">مبلغ (${curFa()})<input class="inp num" id="exAmount" data-money="exHint" inputmode="numeric" value="${sep(Math.round(r2d(inv.fundUnpaid)))}"><span class="hint" id="exHint"></span></label>
    </div>
    <label class="f">تاریخ${dateBoxHtml('ex')}</label>
    <label class="f">توضیح<input class="inp" id="exNote" placeholder="مثلاً: پرداخت به سرویس‌کار آسانسور"></label>
    <p class="hint">صندوق مسئول این هزینه «${esc(responsible)}» است. اگر از صندوق دیگری پرداخت کنید، آن صندوق به صندوق پرداخت‌کننده بدهکار می‌شود و در صفحه‌ی صندوق‌ها و گزارش‌ها نمایش داده می‌شود.</p></div>`,
    `<button class="btn primary" id="exSave">ثبت پرداخت</button><button class="btn" id="exCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); $('#exCancel').onclick = closeModal
  $('#exSave').onclick = guard(async () => {
    const r = await post(`/api/invoices/${inv.id}/pay`, { fundId: +$('#exFund').value, amount: readMoney($('#exAmount')), note: $('#exNote').value.trim(), ...readDate('ex') })
    closeModal(); toast(r.crossFund ? 'پرداخت شد — بدهی بین‌صندوقی ثبت شد' : 'پرداخت از صندوق ثبت شد'); refresh()
  })
}

// ==================== دریافتی‌ها ====================
VIEWS.payments = async () => {
  const rows = await api('/api/payments')
  const total = rows.reduce((s, p) => s + p.amount, 0)
  $('#view').innerHTML = head('دریافتی‌ها', 'واریز ساکنین به صندوق‌ها',
    adminOnly(`<button class="btn primary" id="newPay">＋ ثبت دریافتی</button>`) + `<a class="btn" href="/api/export/payments">⬇️ CSV</a>`) +
    `<div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>واحد</th><th>ساکن</th><th>تاریخ</th><th>مبلغ</th><th>صندوق</th><th>روش</th><th>تخصیص‌یافته</th><th>علی‌الحساب</th><th>سند</th>${adminOnly('<th></th>')}</tr></thead>
      <tbody>${rows.length ? rows.map(p => `<tr>
        <td><b>${escFa(p.number)}</b></td><td>${esc(p.resident_name || '—')}</td><td class="num">${faDigit(p.j_date)}</td>
        <td class="num amt-in">${money(p.amount)}</td><td>${esc(p.fund_name || '—')}</td><td>${esc(p.method || '—')}</td>
        <td class="num">${money(p.allocated)}</td><td class="num ${p.leftover > 0 ? 'pos' : ''}">${money(p.leftover)}</td>
        <td>${p.doc_file ? `<a class="doclink" href="/uploads/${encodeURI(p.doc_file)}" target="_blank">📎</a>` : '—'}</td>
        ${adminOnly(`<td class="actcell"><button class="mini-btn" data-editpay="${p.id}">ویرایش</button><button class="del" data-delpay="${p.id}">🗑</button></td>`)}</tr>`).join('')
      : emptyRow(isAdmin() ? 10 : 9, 'هنوز دریافتی ثبت نشده است')}</tbody>
      ${rows.length ? `<tfoot><tr><td colspan="3">جمع (${faDigit(rows.length)} فقره)</td><td class="num">${money(total)}</td><td colspan="${isAdmin() ? 6 : 5}"></td></tr></tfoot>` : ''}
    </table></div></div>`
  document.querySelectorAll('[data-delpay]').forEach(b => b.onclick = () =>
    confirmBox('این دریافتی حذف شود؟ تخصیص‌هایش آزاد می‌شود و بدهی واحد برمی‌گردد.',
      async () => { await api(`/api/payments/${b.dataset.delpay}`, { method: 'DELETE' }); toast('دریافتی حذف شد'); refresh() }))
  document.querySelectorAll('[data-editpay]').forEach(b => b.onclick = () => {
    const p = rows.find(x => x.id === +b.dataset.editpay); if (p) paymentForm(null, p)
  })
  if ($('#newPay')) $('#newPay').onclick = () => paymentForm()
}

function paymentForm(presetUnit, pay) {
  const store = { doc: null }
  const units = META.units.filter(u => u.active || (pay && u.id === pay.unit_id))
  const selUnit = pay ? pay.unit_id : presetUnit
  const payJ = pay ? { jy: +pay.j_date.slice(0, 4), jm: +pay.j_date.slice(5, 7), jd: +pay.j_date.slice(8, 10) } : null
  const body = openModal(pay ? 'ویرایش دریافتی' : 'ثبت دریافتی', `
    <div class="form">
      <div class="frow">
        <label class="f">واحد<select class="inp" id="pyUnit">${units.map(u => `<option value="${u.id}" ${selUnit === u.id ? 'selected' : ''}>واحد ${escFa(u.number)}${u.resident_name ? ' — ' + esc(u.resident_name) : ''}</option>`).join('')}</select></label>
        <label class="f">مبلغ (${curFa()})<input class="inp num" id="pyAmount" data-money="pyHint" inputmode="numeric" value="${pay ? sep(Math.round(r2d(pay.amount))) : ''}"><span class="hint" id="pyHint"></span></label>
      </div>
      <div class="frow">
        <label class="f">تاریخ${dateBoxHtml('py', payJ)}</label>
        <label class="f">صندوق مقصد<select class="inp" id="pyFund">${META.funds.map(f => `<option value="${f.id}" ${pay && pay.fund_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      </div>
      <div class="frow">
        <label class="f">روش پرداخت<select class="inp" id="pyMethod"><option value="">—</option>${META.payMethods.map(m => `<option ${pay && pay.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="f">توضیح<input class="inp" id="pyNote" placeholder="مثلاً: بابت شارژ مرداد" value="${esc(pay ? pay.note : '')}"></label>
      </div>
      ${docPickerHtml('pyDoc')}
      <div class="panel" style="margin:0;background:var(--panel-2)">
        <div class="phead"><b>بدهی‌های باز این واحد</b><span class="hint strong" id="pyCredit"></span></div>
        <p class="hint" style="margin:0 0 8px">${pay ? 'با ذخیرهٔ ویرایش، مبلغ دوباره از قدیمی‌ترین بدهی تسویه می‌شود (FIFO).' : 'اگر هیچ فاکتوری تیک نخورد، مبلغ به‌صورت خودکار از قدیمی‌ترین بدهی تسویه می‌شود (FIFO).'}</p>
        <div id="pyOpen"><div class="empty">در حال بارگذاری…</div></div>
      </div>
    </div>`,
    `<button class="btn primary" id="pySave">${pay ? 'ذخیرهٔ تغییرات' : 'ثبت دریافتی'}</button><button class="btn" id="pyCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); wireDocPicker('pyDoc', store)
  $('#pyCancel').onclick = closeModal
  const loadOpen = guard(async () => {
    const d = await api(`/api/unit/${$('#pyUnit').value}/open`)
    $('#pyCredit').textContent = d.credit > 0 ? `بستانکاری فعلی: ${moneyU(d.credit)}` : ''
    $('#pyOpen').innerHTML = d.rows.length ? `<div class="tablewrap"><table class="tx"><thead><tr><th>${pay ? '' : ''}</th><th>فاکتور</th><th>تاریخ</th><th>مانده</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td>${pay ? '' : `<input type="checkbox" data-inv="${r.invoice_id}" style="width:16px;height:16px;accent-color:var(--accent)">`}</td>
        <td>${esc(r.title)}</td><td class="num">${r.is_opening ? 'انتقالی' : faDigit(r.j_date)}</td><td class="num amt-out">${money(r.remaining)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">این واحد بدهی بازی ندارد — مبلغ به‌عنوان بستانکاری ثبت می‌شود</div>'
  })
  $('#pyUnit').onchange = loadOpen; loadOpen()
  $('#pySave').onclick = guard(async () => {
    const amount = readMoney($('#pyAmount')); if (!(amount > 0)) throw new Error('مبلغ را وارد کنید')
    const payload = {
      unitId: +$('#pyUnit').value, amount, fundId: +$('#pyFund').value,
      method: $('#pyMethod').value, note: $('#pyNote').value.trim(), doc: store.doc, ...readDate('py')
    }
    if (pay) {
      await post(`/api/payments/${pay.id}`, payload, 'PUT')
      closeModal(); toast('دریافتی ویرایش شد'); refresh(); return
    }
    const invoiceIds = [...$('#pyOpen').querySelectorAll('input[type=checkbox]:checked')].map(c => +c.dataset.inv)
    payload.invoiceIds = invoiceIds.length ? invoiceIds : null
    const r = await post('/api/payments', payload)
    closeModal()
    toast(r.credit > 0 ? `ثبت شد — ${moneyU(r.allocated)} تسویه و ${moneyU(r.credit)} بستانکار شد` : `دریافتی ثبت و ${moneyU(r.allocated)} تسویه شد`)
    refresh()
  })
}

// ==================== واحدها ====================
VIEWS.units = async () => {
  const units = META.units
  $('#view').innerHTML = head('واحدها', `${faDigit(units.filter(u => u.active).length)} واحد فعال${META.totalUnits ? ' از ' + faDigit(META.totalUnits) : ''} · ${faDigit(units.filter(u => u.active && !u.occupied).length)} واحد خالی`,
    adminOnly(`<button class="btn primary" id="newUnit">＋ افزودن واحد</button>`) + `<a class="btn" href="/api/export/units">⬇️ CSV</a>`) +
    (units.length ? `<div class="pgrid">${units.map(u => `
      <button class="pcard" data-unit="${u.id}">
        <div class="pctop"><span class="pn">واحد ${escFa(u.number)}</span>
          ${u.active ? (u.occupied ? '' : '<span class="badge b-vacant">خالی</span>') : '<span class="badge b-vacant">بایگانی</span>'}</div>
        <div class="pline"><span>ساکن</span><b>${esc(u.resident_name || '—')}</b></div>
        <div class="pline"><span>متراژ / نفرات</span><b class="num">${faDigit(u.area || 0)} م² · ${faDigit(u.occupants || 0)} نفر</b></div>
        <div class="pline big"><span>${u.debt >= 0 ? 'بدهی' : 'بستانکار'}</span><b class="${u.debt > 0 ? 'neg' : u.debt < 0 ? 'pos' : ''}">${money(Math.abs(u.debt))}</b></div>
        ${u.aging ? `<div class="pfoot">قدمت بدهی: ${u.aging.bucket} روز</div>` : ''}
      </button>`).join('')}</div>` : '<div class="panel"><div class="empty">هنوز واحدی تعریف نشده — با دکمه‌ی «افزودن واحد» شروع کنید</div></div>')
  wireCommon()
  if ($('#newUnit')) $('#newUnit').onclick = () => unitForm()
}

function unitForm(u) {
  const body = openModal(u ? `ویرایش واحد ${faDigit(u.number)}` : 'افزودن واحد', `
    <div class="form">
      <div class="frow">
        <label class="f">شماره / نام واحد<input class="inp" id="unNum" value="${esc(u ? u.number : '')}" placeholder="۱ یا همکف شرقی"></label>
        <label class="f">طبقه<input class="inp num" id="unFloor" inputmode="numeric" value="${u ? u.floor : 0}"></label>
      </div>
      <div class="frow">
        <label class="f">متراژ (متر مربع)<input class="inp num" id="unArea" inputmode="decimal" value="${u ? u.area : ''}"></label>
        <label class="f">تعداد نفرات ساکن<input class="inp num" id="unOcc" inputmode="numeric" value="${u ? u.occupants : ''}"></label>
      </div>
      <div class="frow">
        <label class="f">نام ساکن / مسئول پرداخت<input class="inp" id="unName" value="${esc(u ? u.resident_name : '')}"></label>
        <label class="f">تلفن<input class="inp num" id="unPhone" inputmode="tel" value="${esc(u ? u.phone : '')}"></label>
      </div>
      <label class="f">شارژ اختصاصی این واحد (${curFa()}) — خالی بگذارید تا از مبلغ سراسری استفاده شود
        <input class="inp num" id="unCharge" data-money="unChargeHint" inputmode="numeric" value="${u && u.monthly_charge != null ? sep(Math.round(r2d(u.monthly_charge))) : ''}">
        <span class="hint" id="unChargeHint">مبلغ سراسری فعلی: ${moneyU(META.chargeAmount)}</span></label>
      <label class="check"><input type="checkbox" id="unOccupied" ${!u || u.occupied ? 'checked' : ''}> واحد پر است (ساکن دارد)</label>
      ${u ? `<label class="check"><input type="checkbox" id="unActive" ${u.active ? 'checked' : ''}> واحد فعال است (بردارید تا بایگانی شود)</label>` : ''}
      <label class="f">یادداشت<input class="inp" id="unNote" value="${esc(u ? u.note : '')}"></label>
    </div>`,
    `<button class="btn primary" id="unSave">${u ? 'ذخیره' : 'افزودن'}</button>
     ${u ? `<button class="btn danger" id="unDel">حذف واحد</button>` : ''}<button class="btn" id="unCancel">انصراف</button>`)
  wireMoney(body)
  $('#unCancel').onclick = closeModal
  $('#unSave').onclick = guard(async () => {
    const chargeRaw = enDigit($('#unCharge').value).replace(/[^\d]/g, '')
    const p = {
      number: $('#unNum').value.trim(), floor: +enDigit($('#unFloor').value) || 0,
      area: +enDigit($('#unArea').value) || 0, occupants: +enDigit($('#unOcc').value) || 0,
      residentName: $('#unName').value.trim(), phone: $('#unPhone').value.trim(),
      occupied: $('#unOccupied').checked, note: $('#unNote').value.trim(),
      monthlyCharge: chargeRaw ? d2r(+chargeRaw) : ''
    }
    if (!p.number) throw new Error('شماره یا نام واحد را وارد کنید')
    if (u) { p.active = $('#unActive').checked; await post(`/api/units/${u.id}`, p, 'PATCH'); closeModal(); toast('واحد ذخیره شد'); refresh(); return }
    const activeCount = (META.units || []).filter(x => x.active).length
    const total = META.totalUnits || 0
    const doAdd = async () => {
      const r = await post('/api/units', p)
      closeModal(); toast(r.warning ? '⚠️ ' + r.warning : 'واحد افزوده شد', !!r.warning); refresh()
    }
    // هشدار پیش از ثبت اگر تعداد واحدها از تعداد تعیین‌شده‌ی ساختمان بیشتر شود (جلوگیری از ثبت اشتباهی)
    if (total > 0 && activeCount >= total)
      confirmBox(`تعداد واحد ساختمان ${faDigit(total)} تعیین شده و اکنون ${faDigit(activeCount)} واحد فعال دارید. با افزودن این واحد از این تعداد بیشتر می‌شود. مطمئنید؟`, doAdd)
    else await doAdd()
  })
  if ($('#unDel')) $('#unDel').onclick = () => confirmBox(`واحد ${faDigit(u.number)} حذف شود؟ اگر سابقه‌ی مالی داشته باشد حذف نمی‌شود.`,
    async () => { await api(`/api/units/${u.id}`, { method: 'DELETE' }); closeModal(); toast('واحد حذف شد'); refresh() })
}

// ---------- کارت واحد ----------
const showUnitCard = guard(async id => {
  const d = await api(`/api/unit/${id}`)
  const u = d.unit
  $('#view').innerHTML =
    `<button class="btn small back printhide" id="backBtn">→ بازگشت</button>` +
    head(`کارت واحد ${faDigit(u.number)}`, `${u.resident_name || 'بدون ساکن'} · ${faDigit(u.area || 0)} متر · ${faDigit(u.occupants || 0)} نفر${u.occupied ? '' : ' · خالی'}`,
      adminOnly(`<button class="btn" id="ucEdit">✏️ ویرایش واحد</button><button class="btn primary" id="ucPay">＋ ثبت دریافتی</button>`) +
      `<button class="btn" id="ucStmt">🖨 صورت‌حساب</button><a class="btn" href="/api/export/unit?id=${u.id}">⬇️ CSV</a>`) +
    `<div class="kpis printhide">
      ${kpi(d.debt >= 0 ? 'بدهی کل' : 'بستانکاری', money(Math.abs(d.debt)), '', d.debt > 0 ? 'bad' : d.debt < 0 ? 'good' : '')}
      ${kpi('جمع سهم‌ها', money(d.totalShares))}
      ${kpi('جمع پرداخت‌ها', money(d.totalPaid), '', 'good')}
      ${kpi('شارژ ماهانه', money(u.chargeAmount), u.monthly_charge != null ? 'اختصاصی این واحد' : 'مبلغ سراسری')}
    </div>
    ${u.phone ? `<div class="panel printhide" style="padding:12px 16px">📞 تلفن: <b class="num">${faDigit(u.phone)}</b></div>` : ''}
    <div class="panel printhide"><div class="phead"><b>سهم‌ها و بدهی‌ها</b><span class="hint">${d.aging ? 'قدمت قدیمی‌ترین بدهی: ' + d.aging.bucket + ' روز' : ''}</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>فاکتور</th><th>دسته</th><th>تاریخ</th><th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
      ${d.shares.length ? d.shares.map(s => `<tr class="clickable" data-inv="${s.invoice_id}">
        <td><b>${esc(s.title)}</b>${s.is_opening ? ' <span class="badge b-open">انتقالی</span>' : ''}</td>
        <td><span class="catpill">${esc(s.category || '—')}</span></td><td class="num">${s.is_opening ? '—' : faDigit(s.j_date)}</td>
        <td class="num">${money(s.share_amount)}</td><td class="num amt-in">${money(s.paid)}</td>
        <td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${money(s.remaining)}</td></tr>`).join('') : emptyRow(6, 'سهمی ثبت نشده')}
      </tbody></table></div></div>
    <div class="panel printhide"><div class="phead"><b>پرداخت‌ها</b></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>مبلغ</th><th>صندوق</th><th>روش</th><th>تخصیص‌یافته</th><th>علی‌الحساب</th><th>سند</th></tr></thead><tbody>
      ${d.payments.length ? d.payments.map(p => `<tr><td class="num">${p.is_opening ? 'انتقالی' : faDigit(p.j_date)}</td><td class="num amt-in">${money(p.amount)}</td>
        <td>${esc(p.fund_name || '—')}</td><td>${esc(p.method || '—')}</td><td class="num">${money(p.allocated)}</td>
        <td class="num ${p.leftover > 0 ? 'pos' : ''}">${money(p.leftover)}</td>
        <td>${p.doc_file ? `<a class="doclink" href="/uploads/${encodeURI(p.doc_file)}" target="_blank">📎</a>` : '—'}</td></tr>`).join('') : emptyRow(7, 'پرداختی ثبت نشده')}
      </tbody></table></div></div>
    <div class="printarea" id="stmtArea"></div>`
  wireCommon()
  $('#backBtn').onclick = () => { VIEW = 'units'; render() }
  if ($('#ucEdit')) $('#ucEdit').onclick = () => unitForm(unitById(u.id))
  if ($('#ucPay')) $('#ucPay').onclick = () => paymentForm(u.id)
  $('#ucStmt').onclick = () => { $('#stmtArea').innerHTML = statementHtml(d); print() }
})

function statementHtml(d) {
  const u = d.unit, open = d.shares.filter(s => s.remaining > 0)
  return `<div class="stmt">
    <h2>${esc(d.buildingName || 'ساختمان')}</h2>
    <div class="stsub">صورت‌حساب واحد ${faDigit(u.number)}${u.resident_name ? ' — ' + esc(u.resident_name) : ''} · تاریخ صدور: ${faDigit(d.today)}</div>
    <table><thead><tr><th>شرح</th><th>تاریخ</th><th>سهم (${curFa()})</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
      ${d.shares.map(s => `<tr><td>${esc(s.title)}</td><td>${s.is_opening ? 'انتقالی' : faDigit(s.j_date)}</td>
        <td>${money(s.share_amount)}</td><td>${money(s.paid)}</td><td>${money(s.remaining)}</td></tr>`).join('')}
      <tr><th>جمع</th><th></th><th>${money(d.totalShares)}</th><th>${money(d.totalShares - open.reduce((s, x) => s + x.remaining, 0))}</th><th>${money(open.reduce((s, x) => s + x.remaining, 0))}</th></tr>
    </tbody></table>
    <table><thead><tr><th>پرداخت‌های ثبت‌شده</th><th>تاریخ</th><th>مبلغ (${curFa()})</th></tr></thead><tbody>
      ${d.payments.length ? d.payments.map(p => `<tr><td>${esc(p.note || p.fund_name || 'واریز')}</td><td>${p.is_opening ? 'انتقالی' : faDigit(p.j_date)}</td><td>${money(p.amount)}</td></tr>`).join('')
      : '<tr><td colspan="3">پرداختی ثبت نشده است</td></tr>'}
      <tr><th>جمع پرداخت‌ها</th><th></th><th>${money(d.totalPaid)}</th></tr>
    </tbody></table>
    <div class="total">${d.debt > 0 ? `مانده‌ی بدهی: ${moneyU(d.debt)}` : d.debt < 0 ? `بستانکاری: ${moneyU(-d.debt)}` : 'تسویه‌ی کامل — بدهی ندارید'}</div>
    <div class="stfoot">این صورت‌حساب از نرم‌افزار «حسابدار مدیر ساختمان توی دید» صادر شده است.</div>
  </div>`
}

// ==================== صندوق‌ها ====================
VIEWS.funds = async () => {
  const funds = await api('/api/funds')
  const d = await api('/api/report/dashboard')
  $('#view').innerHTML = head('صندوق‌ها', 'موجودی، گردش، انتقال و تسویه با مدیر',
    adminOnly(`<button class="btn" id="fdTransfer">↔️ انتقال بین صندوق</button><button class="btn primary" id="fdSettle">تسویه با مدیر</button>`)) +
    `<div class="kpis">${kpi('موجودی کل', money(funds.reduce((s, f) => s + f.balance, 0)), '', 'hero')}
      ${kpi('طلب مدیر از صندوق', money(d.managerDebt), d.managerDebt > 0 ? 'باید به مدیر پرداخت شود' : 'تسویه است', d.managerDebt > 0 ? 'warn' : 'good')}</div>
    <div class="pgrid">${funds.map(f => `<button class="pcard" data-fund="${f.id}">
      <div class="pctop"><span class="pn">${esc(f.name)}</span><span class="catpill">${esc(f.kindFa)}</span></div>
      <div class="pline"><span>موجودی اولیه</span><b class="num">${money(f.opening_balance)}</b></div>
      <div class="pline big"><span>موجودی فعلی</span><b class="num ${f.balance < 0 ? 'neg' : 'pos'}">${money(f.balance)}</b></div>
      <div class="pfoot">برای دیدن گردش کلیک کنید</div></button>`).join('')}</div>
    ${(d.interFund && d.interFund.length) ? `<div class="panel" style="margin-top:16px"><div class="phead"><b>بدهی بین صندوق‌ها</b>
        <span class="hint">وقتی صندوقی هزینه‌ی صندوق دیگری را پرداخت می‌کند</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>صندوق بدهکار</th><th></th><th>صندوق بستانکار</th><th>مبلغ</th>${adminOnly('<th></th>')}</tr></thead><tbody>
      ${d.interFund.map(x => `<tr><td><b>${esc(x.fromName)}</b></td><td class="num amt-out">←</td><td><b>${esc(x.toName)}</b></td>
        <td class="num amt-out">${money(x.amount)}</td>
        ${adminOnly(`<td><button class="mini-btn" data-settlefund='${esc(JSON.stringify(x))}'>تسویه با انتقال</button></td>`)}</tr>`).join('')}
      </tbody></table></div>
      <p class="hint" style="margin:8px 0 0">«تسویه با انتقال» پول را از صندوق بدهکار به صندوق بستانکار منتقل می‌کند و بدهی را صفر می‌کند.</p></div>` : ''}`
  document.querySelectorAll('[data-fund]').forEach(b => b.onclick = () => showFund(+b.dataset.fund))
  if ($('#fdTransfer')) $('#fdTransfer').onclick = () => transferForm(funds)
  if ($('#fdSettle')) $('#fdSettle').onclick = () => settleForm(funds, d.managerDebt)
  document.querySelectorAll('[data-settlefund]').forEach(b => b.onclick = () => {
    const x = JSON.parse(b.dataset.settlefund)
    transferForm(funds, { from: x.from, to: x.to, amount: x.amount })
  })
}
const TXN_FA = { in: 'واریز ساکن', out: 'پرداخت فاکتور', transfer_in: 'انتقال ورودی', transfer_out: 'انتقال خروجی', manager_settle: 'تسویه با مدیر' }
const isIn = t => t === 'in' || t === 'transfer_in'
const showFund = guard(async id => {
  const d = await api(`/api/funds/${id}/txns`)
  $('#view').innerHTML = `<button class="btn small back printhide" id="backBtn">→ بازگشت</button>` +
    head(d.fund.name, `${d.fund.kindFa} · موجودی فعلی: ${moneyU(d.fund.balance)}`) +
    `<div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>تاریخ</th><th>نوع</th><th>شرح</th><th>ورودی</th><th>خروجی</th></tr></thead><tbody>
      ${d.rows.length ? d.rows.map(t => `<tr><td class="num">${faDigit(t.j_date)}</td><td><span class="catpill">${esc(TXN_FA[t.type] || t.type)}</span></td>
        <td>${esc(t.note || t.inv_title || (t.unit_number ? 'واحد ' + t.unit_number : '—'))}</td>
        <td class="num amt-in">${isIn(t.type) ? money(t.amount) : ''}</td>
        <td class="num amt-out">${isIn(t.type) ? '' : money(t.amount)}</td></tr>`).join('') : emptyRow(5, 'گردشی ثبت نشده')}
      </tbody><tfoot><tr><td colspan="2">موجودی اولیه ${money(d.fund.opening_balance)}</td><td>موجودی فعلی</td>
        <td colspan="2" class="num">${money(d.fund.balance)}</td></tr></tfoot></table></div></div>`
  $('#backBtn').onclick = () => { VIEW = 'funds'; render() }
})
function transferForm(funds, preset) {
  const body = openModal('انتقال بین صندوق‌ها', `<div class="form">
    <div class="frow">
      <label class="f">از صندوق<select class="inp" id="trFrom">${funds.map(f => `<option value="${f.id}" ${preset && preset.from === f.id ? 'selected' : ''}>${esc(f.name)} (${money(f.balance)})</option>`).join('')}</select></label>
      <label class="f">به صندوق<select class="inp" id="trTo">${funds.map((f, i) => `<option value="${f.id}" ${preset ? (preset.to === f.id ? 'selected' : '') : (i === 1 ? 'selected' : '')}>${esc(f.name)}</option>`).join('')}</select></label>
    </div>
    <label class="f">مبلغ (${curFa()})<input class="inp num" id="trAmount" data-money="trHint" inputmode="numeric" value="${preset && preset.amount ? sep(Math.round(r2d(preset.amount))) : ''}"><span class="hint" id="trHint"></span></label>
    <label class="f">تاریخ${dateBoxHtml('tr')}</label></div>`,
    `<button class="btn primary" id="trSave">انتقال</button><button class="btn" id="trCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); $('#trCancel').onclick = closeModal
  $('#trSave').onclick = guard(async () => {
    await post('/api/funds/transfer', { fromId: +$('#trFrom').value, toId: +$('#trTo').value, amount: readMoney($('#trAmount')), ...readDate('tr') })
    closeModal(); toast('انتقال ثبت شد'); refresh()
  })
}
function settleForm(funds, debt) {
  const body = openModal('تسویه با مدیر', `<div class="form">
    <div class="notice" style="margin:0">طلب فعلی مدیر از صندوق: <b>${moneyU(debt)}</b></div>
    <label class="f">مبلغ تسویه (${curFa()})<input class="inp num" id="stAmount" data-money="stHint" inputmode="numeric" value="${sep(Math.round(r2d(debt)))}"><span class="hint" id="stHint"></span></label>
    <label class="f">از کدام صندوق<select class="inp" id="stFund">${funds.map(f => `<option value="${f.id}">${esc(f.name)} (${money(f.balance)})</option>`).join('')}</select></label>
    <label class="f">تاریخ${dateBoxHtml('st')}</label>
    <label class="f">توضیح<input class="inp" id="stNote" value="تسویه با مدیر"></label></div>`,
    `<button class="btn primary" id="stSave">ثبت تسویه</button><button class="btn" id="stCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); $('#stCancel').onclick = closeModal
  $('#stSave').onclick = guard(async () => {
    await post('/api/manager/settle', { amount: readMoney($('#stAmount')), fundId: +$('#stFund').value, note: $('#stNote').value.trim(), ...readDate('st') })
    closeModal(); toast('تسویه با مدیر ثبت شد'); refresh()
  })
}

// ==================== گزارش‌ها ====================
let repTab = 'manager', repRange = null
VIEWS.reports = async () => {
  const tabs = [['manager', 'عملکرد مدیر مالی'], ['debtors', 'بدهکاران'], ['invoices', 'فاکتوری'], ['fundpay', 'پرداخت صندوق‌ها'], ['unit', 'کارت واحد'], ['balance', 'تراز کل']]
  $('#view').innerHTML = head('گزارش‌ها', 'خروجی قابل ارائه به هیئت مدیره و اهالی') +
    `<div class="filters printhide"><div class="chips">${tabs.map(([v, t]) => `<button class="chip ${repTab === v ? 'on' : ''}" data-rt="${v}">${t}</button>`).join('')}</div></div>
     <div id="repBody"><div class="empty">در حال بارگذاری…</div></div>`
  document.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { repTab = b.dataset.rt; render() })
  await REPORTS[repTab]()
}
const REPORTS = {}
REPORTS.manager = async () => {
  const periods = await api('/api/report/periods')
  if (!repRange) repRange = { from: periods[0].from, to: periods[0].to, label: periods[0].fa }
  const r = await api(`/api/report/manager?from=${repRange.from}&to=${repRange.to}`)
  $('#repBody').innerHTML = `
    <div class="filters printhide">
      <select class="inp" id="repPeriod">${periods.map(p => `<option value="${p.from}|${p.to}|${p.fa}" ${p.from === repRange.from && !repRange.custom ? 'selected' : ''}>${escFa(p.fa)}</option>`).join('')}
        <option value="all" ${repRange.label === 'از ابتدا تا امروز' ? 'selected' : ''}>از ابتدا تا امروز</option>
        <option value="custom" ${repRange.custom ? 'selected' : ''}>بازه‌ی دلخواه…</option></select>
      <a class="btn small" href="/api/export/manager?from=${repRange.from}&to=${repRange.to}">⬇️ CSV</a>
      <button class="btn small" onclick="print()">🖨 چاپ</button>
    </div>
    <div class="filters printhide" id="repCustom" ${repRange.custom ? '' : 'hidden'}>
      <label class="f" style="flex-direction:row;align-items:center;gap:6px">از تاریخ ${dateBoxHtml('rf', repRange.jf)}</label>
      <label class="f" style="flex-direction:row;align-items:center;gap:6px">تا تاریخ ${dateBoxHtml('rt', repRange.jt)}</label>
      <button class="btn small primary" id="repApply">اعمال بازه</button>
    </div>
    <div class="panel"><h3 style="margin-bottom:4px">${esc(r.buildingName)} — گزارش عملکرد مدیر مالی</h3>
      <p class="sub">دوره: ${escFa(repRange.label)}</p></div>
    <div class="kpis">
      ${kpi('جمع دریافتی از ساکنین', money(r.payments.total), faDigit(r.payments.count) + ' فقره', 'good')}
      ${kpi('جمع هزینه‌ها', money(r.expenses.total), faDigit(r.expenses.count) + ' فاکتور', 'bad')}
      ${kpi('خالص دوره', signed(r.payments.total - r.expenses.total))}
      ${kpi('طلب مدیر از صندوق', money(r.managerDebt), '', r.managerDebt > 0 ? 'warn' : '')}
    </div>
    <div class="panel"><div class="phead"><b>دریافتی به تفکیک صندوق</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody>
      ${r.payments.byFund.length ? r.payments.byFund.map(f => `<tr><td>${esc(f.name)}</td><td class="num">${faDigit(f.count)}</td><td class="num amt-in">${money(f.amount)}</td></tr>`).join('') : emptyRow(3, 'دریافتی در این دوره نبوده')}
      </tbody><tfoot><tr><td>جمع</td><td class="num">${faDigit(r.payments.count)}</td><td class="num">${money(r.payments.total)}</td></tr></tfoot></table></div></div>
    <div class="panel"><div class="phead"><b>هزینه‌ها به تفکیک دسته و نوع</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>دسته</th><th>ثابت</th><th>متغیر</th><th>پیش‌بینی‌نشده</th><th>جمع</th></tr></thead><tbody>
      ${r.expenses.byCategory.length ? r.expenses.byCategory.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${money(c.fixed)}</td>
        <td class="num">${money(c.variable)}</td><td class="num">${money(c.unexpected)}</td><td class="num amt-out">${money(c.total)}</td></tr>`).join('') : emptyRow(5, 'هزینه‌ای در این دوره نبوده')}
      </tbody><tfoot><tr><td>جمع کل</td><td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.fixed, 0))}</td>
        <td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.variable, 0))}</td>
        <td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.unexpected, 0))}</td><td class="num">${money(r.expenses.total)}</td></tr></tfoot></table></div></div>
    <div class="panel"><div class="phead"><b>گردش صندوق‌ها</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق</th><th>اول دوره</th><th>ورودی</th><th>خروجی</th><th>آخر دوره</th></tr></thead><tbody>
      ${r.fundFlow.map(f => `<tr><td><b>${esc(f.name)}</b></td><td class="num">${money(f.open)}</td><td class="num amt-in">${money(f.in)}</td>
        <td class="num amt-out">${money(f.out)}</td><td class="num"><b>${money(f.close)}</b></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>مانده‌ی فاکتورهای دوره</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>مبلغ</th><th>وصول‌شده</th><th>مانده</th></tr></thead><tbody>
      ${r.invoices.length ? r.invoices.map(i => `<tr class="clickable" data-inv="${i.id}"><td>${esc(i.title)}</td><td><span class="catpill">${esc(i.category || '—')}</span></td>
        <td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td><td class="num amt-in">${money(i.collected)}</td>
        <td class="num ${i.remaining > 0 ? 'amt-out' : ''}">${money(i.remaining)}</td></tr>`).join('') : emptyRow(6, 'فاکتوری در این دوره نبوده')}
      </tbody></table></div></div>`
  wireCommon(); wireToday($('#repBody'))
  $('#repPeriod').onchange = () => {
    const v = $('#repPeriod').value
    if (v === 'custom') { $('#repCustom').hidden = false; return }
    if (v === 'all') repRange = { from: '1900-01-01', to: '2100-01-01', label: 'از ابتدا تا امروز' }
    else { const [from, to, label] = v.split('|'); repRange = { from, to, label } }
    render()
  }
  if ($('#repApply')) $('#repApply').onclick = guard(async () => {
    const f = readDate('rf'), t = readDate('rt')
    if (!f.jy || !f.jm || !f.jd || !t.jy || !t.jm || !t.jd) throw new Error('هر دو تاریخ را کامل وارد کنید')
    const from = gStr(f.jy, f.jm, f.jd), to = gStr(t.jy, t.jm, t.jd)
    if (from > to) throw new Error('تاریخ شروع نباید بعد از تاریخ پایان باشد')
    repRange = { from, to, label: `${faDigit(f.jy)}/${faDigit(f.jm)}/${faDigit(f.jd)} تا ${faDigit(t.jy)}/${faDigit(t.jm)}/${faDigit(t.jd)}`, custom: true, jf: f, jt: t }
    render()
  })
}
REPORTS.debtors = async () => {
  const r = await api('/api/report/debtors')
  $('#repBody').innerHTML = `
    <div class="filters printhide"><a class="btn small" href="/api/export/debtors">⬇️ CSV</a><button class="btn small" onclick="print()">🖨 چاپ</button></div>
    <div class="kpis">${kpi('جمع کل بدهی', money(r.total), faDigit(r.rows.length) + ' واحد بدهکار', 'hero bad')}
      ${Object.entries(r.buckets).map(([b, v]) => kpi('قدمت ' + b + ' روز', money(v))).join('')}</div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>واحد</th><th>ساکن</th><th>تلفن</th><th>بدهی</th><th>قدمت</th></tr></thead><tbody>
      ${r.rows.length ? r.rows.map(u => `<tr class="clickable" data-unit="${u.id}"><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
        <td class="num">${faDigit(u.phone || '—')}</td><td class="num amt-out">${money(u.debt)}</td>
        <td>${u.aging ? `<span class="badge b-open">${u.aging.bucket}</span> <span class="hint">${u.aging.days > 9000 ? 'انتقالی' : faDigit(u.aging.days) + ' روز'}</span>` : '—'}</td></tr>`).join('')
      : emptyRow(5, 'هیچ واحدی بدهکار نیست 🎉')}
      </tbody><tfoot><tr><td colspan="3">جمع کل</td><td class="num">${money(r.total)}</td><td></td></tr></tfoot></table></div></div>`
  wireCommon()
}
REPORTS.invoices = async () => {
  const rows = await api('/api/invoices')
  const t = rows.reduce((a, i) => ({ a: a.a + i.amount, c: a.c + i.collected, r: a.r + i.remaining }), { a: 0, c: 0, r: 0 })
  $('#repBody').innerHTML = `
    <div class="filters printhide"><a class="btn small" href="/api/export/invoices">⬇️ CSV</a><button class="btn small" onclick="print()">🖨 چاپ</button></div>
    <div class="kpis">${kpi('جمع فاکتورها', money(t.a), faDigit(rows.length) + ' فاکتور')}${kpi('وصول‌شده', money(t.c), '', 'good')}${kpi('مانده', money(t.r), '', 'bad')}
      ${kpi('نرخ وصول', faDigit(t.a ? Math.round(t.c / t.a * 100) : 0) + '٪', '', 'good')}</div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>مبلغ</th><th>روش تسهیم</th><th>وصول‌شده</th><th>مانده</th><th>وضعیت</th></tr></thead><tbody>
      ${rows.length ? rows.map(i => `<tr class="clickable" data-inv="${i.id}"><td><b>${esc(i.title)}</b></td><td><span class="catpill">${esc(i.categoryName)}</span></td>
        <td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td><td><span class="catpill">${esc(i.methodFa)}</span></td>
        <td class="num amt-in">${money(i.collected)}</td><td class="num ${i.remaining > 0 ? 'amt-out' : ''}">${money(i.remaining)}</td>
        <td>${statusBadge(i.status)}</td></tr>`).join('') : emptyRow(8, 'فاکتوری ثبت نشده')}
      </tbody></table></div></div>`
  wireCommon()
}
REPORTS.fundpay = async () => {
  const r = await api('/api/report/fundpay')
  $('#repBody').innerHTML = `
    <div class="filters printhide"><button class="btn small" onclick="print()">🖨 چاپ</button></div>
    <div class="kpis">${kpi('جمع پرداخت از صندوق‌ها', money(r.total), faDigit(r.rows.length) + ' پرداخت', 'good')}
      ${kpi('هزینه‌های پرداخت‌نشده', money(r.unpaidTotal), 'بدهی صندوق به فاکتورها', r.unpaidTotal > 0 ? 'bad' : 'good')}</div>
    ${r.interFund.length ? `<div class="panel"><div class="phead"><b>بدهی بین صندوق‌ها</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق بدهکار</th><th>صندوق بستانکار</th><th>مبلغ</th></tr></thead><tbody>
      ${r.interFund.map(x => `<tr><td><b>${esc(x.fromName)}</b></td><td>${esc(x.toName)}</td><td class="num amt-out">${money(x.amount)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="grid2">
      <div class="panel"><div class="phead"><b>پرداخت به تفکیک صندوق</b></div><div class="tablewrap"><table class="tx">
        <thead><tr><th>صندوق</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody>
        ${r.byFund.length ? r.byFund.map(f => `<tr><td>${esc(f.name)}</td><td class="num">${faDigit(f.count)}</td><td class="num amt-out">${money(f.amount)}</td></tr>`).join('') : emptyRow(3, 'پرداختی نبوده')}
        </tbody></table></div></div>
      <div class="panel"><div class="phead"><b>پرداخت به تفکیک دسته‌ی هزینه</b></div><div class="tablewrap"><table class="tx">
        <thead><tr><th>دسته</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody>
        ${r.byCategory.length ? r.byCategory.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${faDigit(c.count)}</td><td class="num amt-out">${money(c.amount)}</td></tr>`).join('') : emptyRow(3, '—')}
        </tbody></table></div></div>
    </div>
    <div class="panel"><div class="phead"><b>ریز پرداخت‌ها (از کدام صندوق به کدام فاکتور)</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>تاریخ</th><th>صندوق</th><th>فاکتور / هزینه</th><th>دسته</th><th>مبلغ</th></tr></thead><tbody>
      ${r.rows.length ? r.rows.map(x => `<tr><td class="num">${faDigit(x.j_date)}</td><td>${esc(x.fund_name || '—')}</td><td>${esc(x.inv_title)}</td>
        <td><span class="catpill">${esc(x.category || '—')}</span></td><td class="num amt-out">${money(x.amount)}</td></tr>`).join('') : emptyRow(5, 'هنوز پرداختی از صندوق ثبت نشده است')}
      </tbody></table></div></div>`
}
REPORTS.unit = async () => {
  const units = META.units
  $('#repBody').innerHTML = `<div class="filters printhide"><select class="inp" id="ruSel"><option value="">— واحد را انتخاب کنید —</option>
      ${units.map(u => `<option value="${u.id}">واحد ${escFa(u.number)}${u.resident_name ? ' — ' + esc(u.resident_name) : ''}</option>`).join('')}</select></div>
    <div class="panel"><div class="empty">برای دیدن کارت کامل، واحد را انتخاب کنید</div></div>`
  $('#ruSel').onchange = () => { if ($('#ruSel').value) showUnitCard(+$('#ruSel').value) }
}
REPORTS.balance = async () => {
  const b = await api('/api/report/balance')
  $('#repBody').innerHTML = `
    <div class="kpis">${kpi('Σ فاکتورها', money(b.totalInvoices))}${kpi('Σ سهم‌های تسهیم‌شده', money(b.totalShares))}
      ${kpi('Σ دریافتی‌ها', money(b.totalPayments), '', 'good')}${kpi('خالص بدهی ساکنین', signed(b.netDebt))}</div>
    <div class="panel"><h3 style="margin-bottom:10px">بررسی تراز</h3>
      <div class="pline"><span>Σ سهم‌ها برابر Σ فاکتورهاست</span><b class="${b.sharesMatchInvoices ? 'pos' : 'neg'}">${b.sharesMatchInvoices ? '✔ بله' : '✖ خیر'}</b></div>
      <div class="pline"><span>خالص بدهی = Σ سهم‌ها − Σ دریافتی‌ها</span><b class="${b.balanced ? 'pos' : 'neg'}">${b.balanced ? '✔ تراز است' : '✖ تراز نیست'}</b></div>
      <p class="sub" style="margin-top:12px">این صفحه سلامت دفاتر را می‌سنجد: اگر هر دو سطر ✔ باشد، همه‌ی فاکتورها کامل تسهیم شده‌اند و هیچ ریالی گم نشده است.</p></div>`
}

// ==================== تنظیمات ====================
let setTab = 'general'
VIEWS.settings = async () => {
  if (!isAdmin()) { $('#view').innerHTML = head('تنظیمات', '') + '<div class="panel"><div class="empty">شما دسترسی فقط-مشاهده دارید</div></div>'; return }
  const tabs = [['general', 'عمومی'], ['charge', 'شارژ ماهانه'], ['recurring', 'هزینه‌های دوره‌ای'], ['categories', 'دسته‌های هزینه'], ['funds', 'صندوق‌ها'],
  ['openings', 'مانده اولیه'], ['handover', 'تحویل مدیریت'], ['users', 'کاربران'], ['backup', 'پشتیبان و آپدیت']]
  $('#view').innerHTML = head('تنظیمات', 'همه‌ی مقادیر قابل سفارشی‌سازی است') +
    `<div class="filters"><div class="chips">${tabs.map(([v, t]) => `<button class="chip ${setTab === v ? 'on' : ''}" data-set="${v}">${t}</button>`).join('')}</div></div>
     <div id="setBody"><div class="empty">در حال بارگذاری…</div></div>`
  document.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { setTab = b.dataset.set; render() })
  await SETTINGS[setTab]()
}
const SETTINGS = {}
SETTINGS.general = async () => {
  const s = await api('/api/settings')
  $('#setBody').innerHTML = `<div class="panel"><div class="form" style="max-width:520px">
    <label class="f">نام ساختمان (در سربرگ گزارش‌ها و صورت‌حساب)<input class="inp" id="sgName" value="${esc(s.buildingName)}"></label>
    <label class="f">تعداد کل واحد ساختمان<input class="inp num" id="sgTotal" inputmode="numeric" value="${s.totalUnits ? faDigit(s.totalUnits) : ''}">
      <span class="hint">اگر عددی بگذارید، هنگام ثبت واحدِ بیشتر از این تعداد هشدار می‌گیرید. خالی یا ۰ = بدون محدودیت.</span></label>
    <label class="f">واحد نمایش مبالغ<div class="seg">
      <button type="button" class="t ${s.displayUnit === 'toman' ? 'on' : ''}" data-unit="toman">تومان</button>
      <button type="button" class="t ${s.displayUnit === 'rial' ? 'on' : ''}" data-unit="rial">ریال</button></div>
      <span class="hint">مبالغ همیشه به ریال ذخیره می‌شوند؛ این فقط نحوه‌ی نمایش و ورود است.</span></label>
    <div class="fbtns"><button class="btn primary" id="sgSave">ذخیره</button></div></div></div>`
  let unit = s.displayUnit
  document.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => {
    unit = b.dataset.unit; document.querySelectorAll('[data-unit]').forEach(x => x.classList.toggle('on', x === b))
  })
  $('#sgSave').onclick = guard(async () => {
    await post('/api/settings', { buildingName: $('#sgName').value.trim(), displayUnit: unit, totalUnits: +enDigit($('#sgTotal').value) || 0 })
    toast('تنظیمات ذخیره شد'); refresh()
  })
}
SETTINGS.charge = async () => {
  const c = await api('/api/charge/amount'), p = await api('/api/charge/periods')
  const s = await api('/api/settings'), lf = await api('/api/latefee')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>مبلغ شارژ سراسری</b><span class="hint strong">فعلی: ${moneyU(c.current)}</span></div>
      <div class="form" style="max-width:520px">
        <label class="f">مبلغ جدید هر واحد (${curFa()})<input class="inp num" id="chAmount" data-money="chHint" inputmode="numeric"><span class="hint" id="chHint"></span></label>
        <label class="f">از کدام ماه اعمال شود<select class="inp" id="chEff">${monthOptions()}</select></label>
        <p class="hint">شارژهای صادرشده‌ی ماه‌های قبل هرگز تغییر نمی‌کنند. شارژ اختصاصی هر واحد در صفحه‌ی همان واحد تنظیم می‌شود.</p>
        <div class="fbtns"><button class="btn primary" id="chSave">ثبت مبلغ جدید</button></div></div></div>
    <div class="panel"><div class="phead"><b>تاریخچه‌ی مبلغ شارژ</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>مبلغ</th><th>از ماه</th><th></th></tr></thead><tbody>
      ${c.history.map(h => `<tr><td class="num"><b>${moneyU(h.amount)}</b></td><td>${escFa(h.fa)}</td>
        <td><button class="del" data-delch="${h.id}">🗑</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="phead"><b>صدور شارژ ماهانه</b><span class="hint">ماه جاری: ${escFa(p.currentFa)}</span></div>
      ${p.missing.length ? `<p class="sub">این ماه‌ها هنوز شارژ صادر نشده‌اند:</p>
        <div class="tablewrap"><table class="tx"><tbody>${p.missing.map(m => `<tr><td><b>${escFa(m.fa)}</b></td>
          <td style="text-align:left"><button class="mini-btn" data-issue="${m.period}">صدور شارژ این ماه</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">شارژ همه‌ی ماه‌ها صادر شده است ✔</div>'}</div>
    <div class="panel"><div class="phead"><b>ضریب تأخیر در پرداخت</b><span class="hint strong">${s.lateFeePercent > 0 ? 'فعال: ' + faDigit(s.lateFeePercent) + '٪ ماهانه' : 'خاموش'}</span></div>
      <p class="sub">بدهی‌های پرداخت‌نشده‌ی ماه‌های قبل خودکار در بدهی واحد می‌مانند و با شارژ جدید جمع می‌شوند. این ضریب، جریمه‌ی تأخیر را هم به بدهیِ معوقِ قدیمی‌تر از مهلت اضافه می‌کند.</p>
      <div class="form" style="max-width:560px">
        <div class="frow">
          <label class="f">درصد ماهانه‌ی جریمه (٪)<input class="inp num" id="lfPct" inputmode="decimal" value="${faDigit(s.lateFeePercent)}"><span class="hint">۰ = خاموش</span></label>
          <label class="f">مهلت (روز) از تاریخ فاکتور<input class="inp num" id="lfGrace" inputmode="numeric" value="${faDigit(s.lateFeeGraceDays)}"><span class="hint">پیش‌فرض ۳۰ روز</span></label>
        </div>
        <div class="fbtns"><button class="btn" id="lfSave">ذخیره‌ی ضریب</button></div>
      </div>
      <div class="phead" style="margin-top:6px"><b>اعمال جریمه‌ی ${escFa(lf.periodFa)}</b><span class="hint strong">${lf.already ? 'قبلاً اعمال شده' : (lf.percent > 0 ? faDigit(lf.rows.length) + ' واحد · جمع ' + moneyU(lf.total) : '')}</span></div>
      ${(s.lateFeePercent > 0 && lf.rows.length && !lf.already) ? `<div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>بدهی معوق</th><th>جریمه (${faDigit(s.lateFeePercent)}٪)</th></tr></thead><tbody>
        ${lf.rows.map(r => `<tr><td><b>${escFa(r.number)}</b></td><td>${esc(r.resident || '—')}</td><td class="num">${money(r.base)}</td><td class="num amt-out">${money(r.fee)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="3">جمع جریمه</td><td class="num amt-out">${money(lf.total)}</td></tr></tfoot></table></div>
        <div class="fbtns" style="margin-top:10px"><button class="btn primary" id="lfApply">اعمال جریمه‌ی این ماه</button></div>`
      : (s.lateFeePercent <= 0 ? '<div class="empty">برای فعال‌سازی، درصد جریمه را بالاتر از صفر بگذارید و ذخیره کنید</div>'
        : (lf.already ? '<div class="empty">جریمه‌ی این ماه قبلاً اعمال شده است ✔</div>' : '<div class="empty">واحد معوقی برای جریمه وجود ندارد</div>'))}
    </div>`
  wireMoney($('#setBody'))
  $('#chSave').onclick = guard(async () => {
    await post('/api/charge/amount', { amount: readMoney($('#chAmount')), effective: $('#chEff').value })
    toast('مبلغ جدید ثبت شد — شارژهای قبلی دست‌نخورده ماند'); refresh()
  })
  $('#lfSave').onclick = guard(async () => {
    await post('/api/settings', { lateFeePercent: +enDigit($('#lfPct').value) || 0, lateFeeGraceDays: +enDigit($('#lfGrace').value) || 0 })
    toast('ضریب تأخیر ذخیره شد'); refresh()
  })
  if ($('#lfApply')) $('#lfApply').onclick = guard(async () => {
    const r = await post('/api/latefee/apply', {})
    toast(`جریمه اعمال شد: ${moneyU(r.total)} برای ${faDigit(r.units)} واحد`); refresh()
  })
  document.querySelectorAll('[data-issue]').forEach(b => b.onclick = guard(async () => {
    const r = await post('/api/charge/issue', { period: b.dataset.issue })
    toast(`شارژ صادر شد: ${moneyU(r.amount)} بین ${faDigit(r.units)} واحد`); refresh()
  }))
  document.querySelectorAll('[data-delch]').forEach(b => b.onclick = () => confirmBox('این ردیف تاریخچه حذف شود؟',
    async () => { await api(`/api/charge/amount/${b.dataset.delch}`, { method: 'DELETE' }); refresh() }))
}
function monthOptions() {
  const t = META.today, out = []
  let jy = t.jy, jm = t.jm
  const FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
  for (let i = 0; i < 18; i++) {
    out.push(`<option value="${jy}/${String(jm).padStart(2, '0')}" ${i === 0 ? 'selected' : ''}>${FA[jm - 1]} ${faDigit(jy)}</option>`)
    jm++; if (jm > 12) { jm = 1; jy++ }
  }
  return out.join('')
}
SETTINGS.recurring = async () => {
  const rows = await api('/api/recurring')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>هزینه‌های ثابت دوره‌ای</b><button class="btn small primary" id="newRec">＋ هزینهٔ دوره‌ای</button></div>
      <p class="sub">هزینه‌های تکراری ساختمان مثل «سرویس آسانسور» را یک‌بار تعریف کنید تا هر دوره (ماهانه، هفتگی یا فصلی) خودکار به‌عنوان فاکتور صادر و بین واحدها تسهیم شود. مبلغ هر هزینه را می‌توانید هر زمان تغییر دهید؛ فاکتورهای صادرشده‌ی قبلی تغییر نمی‌کنند.</p>
      <div class="tablewrap"><table class="tx"><thead><tr><th>عنوان</th><th>دوره</th><th>دسته</th><th>روش</th><th>مبلغ</th><th>صندوق</th><th>این دوره</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr>
        <td><b>${esc(r.title)}</b>${r.auto ? ' <span class="badge b-charge">خودکار</span>' : ''}${r.active ? '' : ' <span class="badge b-vacant">غیرفعال</span>'}</td>
        <td>${esc(r.periodKindFa)}</td><td><span class="catpill">${esc(r.categoryName)}</span></td>
        <td><span class="catpill">${esc(r.methodFa)}</span></td>
        <td class="num">${r.method === 'per_unit_charge' ? '—' : money(r.amount)}</td>
        <td>${esc(r.fundName)}</td>
        <td>${r.issuedThisPeriod ? '<span class="badge b-settled">صادر شد</span>' : `<button class="mini-btn" data-issuerec="${r.id}">صدور ${escFa(r.curPeriodFa)}</button>`}</td>
        <td class="actcell"><button class="mini-btn" data-editrec="${r.id}">ویرایش</button><button class="del" data-delrec="${r.id}">🗑</button></td></tr>`).join('')
      : emptyRow(8, 'هنوز هزینهٔ دوره‌ای تعریف نشده — با دکمهٔ بالا شروع کنید')}
      </tbody></table></div></div>`
  $('#newRec').onclick = () => recurForm()
  document.querySelectorAll('[data-editrec]').forEach(b => b.onclick = () => recurForm(rows.find(r => r.id === +b.dataset.editrec)))
  document.querySelectorAll('[data-issuerec]').forEach(b => b.onclick = guard(async () => {
    const r = await post(`/api/recurring/${b.dataset.issuerec}/issue`, {})
    toast(`صادر شد: ${moneyU(r.amount)} بین ${faDigit(r.units)} واحد`); refresh()
  }))
  document.querySelectorAll('[data-delrec]').forEach(b => b.onclick = () => confirmBox('این قالب هزینهٔ دوره‌ای حذف شود؟ فاکتورهای صادرشده‌ی قبلی باقی می‌مانند.',
    async () => { await api(`/api/recurring/${b.dataset.delrec}`, { method: 'DELETE' }); toast('حذف شد'); refresh() }))
}
function recurForm(r) {
  const cats = META.categories, funds = META.funds
  const methods = META.methods.filter(m => m.value !== 'custom')
  openModal(r ? 'ویرایش هزینهٔ دوره‌ای' : 'هزینهٔ دوره‌ای جدید', `<div class="form">
    <label class="f">عنوان هزینه<input class="inp" id="rcTitle" value="${esc(r ? r.title : '')}" placeholder="مثلاً: سرویس آسانسور"></label>
    <div class="frow">
      <label class="f">دوره<select class="inp" id="rcKind">${META.periodKinds.map(k => `<option value="${k.value}" ${r && r.period_kind === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select></label>
      <label class="f">مبلغ هر دوره (${curFa()})<input class="inp num" id="rcAmount" data-money="rcHint" inputmode="numeric" value="${r ? sep(Math.round(r2d(r.amount))) : ''}"><span class="hint" id="rcHint"></span></label>
    </div>
    <div class="frow">
      <label class="f">دسته‌ی هزینه<select class="inp" id="rcCat">${cats.map(c => `<option value="${c.id}" ${r && r.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="f">روش تسهیم<select class="inp" id="rcMethod">${methods.map(m => `<option value="${m.value}" ${(r ? r.method : '') === m.value ? 'selected' : ''}>${esc(m.fa)}</option>`).join('')}</select></label>
    </div>
    <div class="frow">
      <label class="f">صندوق پرداخت<select class="inp" id="rcFund">${funds.map(f => `<option value="${f.id}" ${r && r.fund_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="f">نوع هزینه<select class="inp" id="rcKindE">${META.expenseKinds.map(k => `<option value="${k.value}" ${(r ? r.expense_kind : 'fixed') === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" id="rcVacant" ${r && r.include_vacant ? 'checked' : ''}> واحدهای خالی هم سهم بدهند</label>
    <label class="check"><input type="checkbox" id="rcAuto" ${!r || r.auto ? 'checked' : ''}> صدور خودکار در ابتدای هر دوره</label>
    ${r ? `<label class="check"><input type="checkbox" id="rcActive" ${r.active ? 'checked' : ''}> فعال</label>` : ''}
    <p class="hint">روش «شارژ هر واحد» مبلغ را از شارژ تعریف‌شده‌ی هر واحد می‌گیرد و فیلد مبلغ نادیده گرفته می‌شود.</p></div>`,
    `<button class="btn primary" id="rcSave">${r ? 'ذخیره' : 'افزودن'}</button><button class="btn" id="rcCancel">انصراف</button>`)
  wireMoney($('#modalBody'))
  $('#rcCancel').onclick = closeModal
  $('#rcSave').onclick = guard(async () => {
    const p = {
      title: $('#rcTitle').value.trim(), amount: readMoney($('#rcAmount')), periodKind: $('#rcKind').value,
      categoryId: +$('#rcCat').value, method: $('#rcMethod').value, fundId: +$('#rcFund').value,
      expenseKind: $('#rcKindE').value, includeVacant: $('#rcVacant').checked, auto: $('#rcAuto').checked
    }
    if (!p.title) throw new Error('عنوان هزینه را وارد کنید')
    if (r) { p.active = $('#rcActive').checked; await post(`/api/recurring/${r.id}`, p, 'PATCH') } else await post('/api/recurring', p)
    closeModal(); toast('ذخیره شد'); refresh()
  })
}
SETTINGS.categories = async () => {
  const cats = await api('/api/categories')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>دسته‌های هزینه</b><button class="btn small primary" id="newCat">＋ دسته‌ی جدید</button></div>
      <p class="sub">روش تسهیم و صندوقِ پیش‌فرض هر دسته، هنگام ثبت فاکتور خودکار انتخاب می‌شود و همان‌جا قابل تغییر است.</p>
      <div class="tablewrap"><table class="tx"><thead><tr><th>نام دسته</th><th>روش تسهیم پیش‌فرض</th><th>واحد خالی سهم می‌دهد؟</th><th>صندوق</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${cats.map(c => `<tr><td><b>${esc(c.name)}</b>${c.is_charge_cat ? ' <span class="badge b-charge">شارژ ماهانه</span>' : ''}</td>
        <td><span class="catpill">${esc(c.methodFa)}</span></td><td>${c.include_vacant ? '✔ بله' : '— خیر'}</td>
        <td>${esc((fundById(c.default_fund_id) || {}).name || '—')}</td>
        <td>${c.active ? '<span class="badge b-settled">فعال</span>' : '<span class="badge b-vacant">غیرفعال</span>'}</td>
        <td><button class="mini-btn" data-editcat="${c.id}">ویرایش</button>
          ${c.is_charge_cat ? '' : `<button class="del" data-delcat="${c.id}">🗑</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`
  $('#newCat').onclick = () => catForm()
  document.querySelectorAll('[data-editcat]').forEach(b => b.onclick = () => catForm(cats.find(c => c.id === +b.dataset.editcat)))
  document.querySelectorAll('[data-delcat]').forEach(b => b.onclick = () => confirmBox('این دسته حذف شود؟',
    async () => { await api(`/api/categories/${b.dataset.delcat}`, { method: 'DELETE' }); toast('دسته حذف شد'); refresh() }))
}
function catForm(c) {
  openModal(c ? 'ویرایش دسته' : 'دسته‌ی هزینه‌ی جدید', `<div class="form">
    <label class="f">نام دسته<input class="inp" id="ctName" value="${esc(c ? c.name : '')}" placeholder="مثلاً: باغبانی"></label>
    <div class="frow">
      <label class="f">روش تسهیم پیش‌فرض<select class="inp" id="ctMethod">${META.methods.map(m => `<option value="${m.value}" ${c && c.default_method === m.value ? 'selected' : ''}>${esc(m.fa)}</option>`).join('')}</select></label>
      <label class="f">صندوق پیش‌فرض<select class="inp" id="ctFund">${META.funds.map(f => `<option value="${f.id}" ${c && c.default_fund_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" id="ctVacant" ${c && c.include_vacant ? 'checked' : ''}> واحدهای خالی هم از این دسته سهم بدهند</label>
    ${c ? `<label class="check"><input type="checkbox" id="ctActive" ${c.active ? 'checked' : ''}> دسته فعال است</label>` : ''}</div>`,
    `<button class="btn primary" id="ctSave">ذخیره</button><button class="btn" id="ctCancel">انصراف</button>`)
  $('#ctCancel').onclick = closeModal
  $('#ctSave').onclick = guard(async () => {
    const p = { name: $('#ctName').value.trim(), defaultMethod: $('#ctMethod').value, defaultFundId: +$('#ctFund').value, includeVacant: $('#ctVacant').checked }
    if (!p.name) throw new Error('نام دسته را وارد کنید')
    if (c) { p.active = $('#ctActive').checked; await post(`/api/categories/${c.id}`, p, 'PATCH') } else await post('/api/categories', p)
    closeModal(); toast('ذخیره شد'); refresh()
  })
}
SETTINGS.funds = async () => {
  const funds = await api('/api/funds')
  $('#setBody').innerHTML = `<div class="panel"><div class="phead"><b>صندوق‌ها</b><button class="btn small primary" id="newFund">＋ صندوق جدید</button></div>
    <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>نوع</th><th>موجودی اولیه</th><th>موجودی فعلی</th><th></th></tr></thead><tbody>
    ${funds.map(f => `<tr><td><b>${esc(f.name)}</b></td><td><span class="catpill">${esc(f.kindFa)}</span></td>
      <td class="num">${money(f.opening_balance)}</td><td class="num"><b>${money(f.balance)}</b></td>
      <td><button class="mini-btn" data-editfund="${f.id}">ویرایش</button><button class="del" data-delfund="${f.id}">🗑</button></td></tr>`).join('')}
    </tbody></table></div></div>`
  $('#newFund').onclick = () => fundForm()
  document.querySelectorAll('[data-editfund]').forEach(b => b.onclick = () => fundForm(funds.find(f => f.id === +b.dataset.editfund)))
  document.querySelectorAll('[data-delfund]').forEach(b => b.onclick = () => confirmBox('این صندوق حذف شود؟',
    async () => { await api(`/api/funds/${b.dataset.delfund}`, { method: 'DELETE' }); toast('صندوق حذف شد'); refresh() }))
}
function fundForm(f) {
  const body = openModal(f ? 'ویرایش صندوق' : 'صندوق جدید', `<div class="form">
    <label class="f">نام صندوق<input class="inp" id="fnName" value="${esc(f ? f.name : '')}" placeholder="مثلاً: صندوق آسانسور"></label>
    <label class="f">نوع<select class="inp" id="fnKind">${META.fundKinds.map(k => `<option value="${k.value}" ${f && f.kind === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select></label>
    <label class="f">موجودی اولیه (${curFa()})<input class="inp num" id="fnOpen" data-money="fnHint" inputmode="numeric" value="${f ? sep(Math.round(r2d(f.opening_balance))) : ''}"><span class="hint" id="fnHint"></span></label></div>`,
    `<button class="btn primary" id="fnSave">ذخیره</button><button class="btn" id="fnCancel">انصراف</button>`)
  wireMoney(body); $('#fnCancel').onclick = closeModal
  $('#fnSave').onclick = guard(async () => {
    const p = { name: $('#fnName').value.trim(), kind: $('#fnKind').value, openingBalance: readMoney($('#fnOpen')) }
    if (!p.name) throw new Error('نام صندوق را وارد کنید')
    if (f) await post(`/api/funds/${f.id}`, p, 'PATCH'); else await post('/api/funds', p)
    closeModal(); toast('ذخیره شد'); refresh()
  })
}
SETTINGS.openings = async () => {
  const d = await api('/api/openings')
  $('#setBody').innerHTML = `
    <div class="notice">مانده‌ی اولیه یعنی وضعیت مالی «قبل از شروع کار با نرم‌افزار». بدهی اولیه مثل قدیمی‌ترین بدهی رفتار می‌کند و اول از همه تسویه می‌شود.</div>
    <div class="panel"><div class="phead"><b>بدهی/بستانکاری اولیه‌ی واحدها</b><span class="hint">مثبت = بدهکار · منفی = بستانکار</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>مبلغ (${curFa()})</th><th>توضیح</th></tr></thead><tbody>
      ${d.units.map(u => `<tr><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
        <td><input class="inp num" style="width:150px;padding:7px 9px" data-ob="${u.unit_id}" inputmode="numeric" value="${u.amount ? (u.amount < 0 ? '-' : '') + sep(Math.round(Math.abs(r2d(u.amount)))) : ''}"></td>
        <td><input class="inp" style="padding:7px 9px" data-obn="${u.unit_id}" value="${esc(u.note)}"></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>موجودی اولیه‌ی صندوق‌ها</b></div>
      <div class="tablewrap"><table class="tx"><tbody>
      ${d.funds.map(f => `<tr><td><b>${esc(f.name)}</b></td>
        <td><input class="inp num" style="width:180px;padding:7px 9px" data-fo="${f.id}" inputmode="numeric" value="${f.opening_balance ? sep(Math.round(r2d(f.opening_balance))) : ''}"></td></tr>`).join('')}
      <tr><td><b>طلب اولیه‌ی مدیر از صندوق</b></td>
        <td><input class="inp num" style="width:180px;padding:7px 9px" id="obMgr" inputmode="numeric" value="${d.managerOpening ? sep(Math.round(r2d(d.managerOpening))) : ''}"></td></tr>
      </tbody></table></div></div>
    <div class="fbtns"><button class="btn primary" id="obSave">ذخیره‌ی مانده‌های اولیه</button></div>`
  $('#obSave').onclick = guard(async () => {
    const units = [...document.querySelectorAll('[data-ob]')].map(i => {
      const neg = i.value.trim().startsWith('-')
      const raw = enDigit(i.value).replace(/[^\d]/g, '')
      return { unitId: +i.dataset.ob, amount: (neg ? -1 : 1) * d2r(+raw || 0), note: document.querySelector(`[data-obn="${i.dataset.ob}"]`).value.trim() }
    })
    const funds = [...document.querySelectorAll('[data-fo]')].map(i => ({ fundId: +i.dataset.fo, amount: d2r(+enDigit(i.value).replace(/[^\d]/g, '') || 0) }))
    await post('/api/openings', { units, funds, managerOpening: d2r(+enDigit($('#obMgr').value).replace(/[^\d]/g, '') || 0) })
    toast('مانده‌های اولیه ذخیره شد'); refresh()
  })
}
SETTINGS.handover = async () => {
  const d = await api('/api/handovers')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>مدیر مالی فعلی</b></div>
      <div class="form" style="max-width:520px">
        <label class="f">نام مدیر مالی فعلی (در سربرگ گزارش‌ها نمایش داده می‌شود)<input class="inp" id="hoName" value="${esc(d.current)}"></label>
        <div class="fbtns"><button class="btn" id="hoNameSave">ذخیره‌ی نام</button></div>
      </div></div>
    <div class="panel"><div class="phead"><b>تحویل مدیریت به مدیر بعدی</b><span class="hint strong">طلب مدیر فعلی: ${moneyU(d.managerDebt)}</span></div>
      <p class="sub">با ثبت تحویل، از تاریخ انتخابی مدیریت هزینه‌ها به مدیر جدید سپرده می‌شود و در تاریخچه ثبت می‌گردد. اگر مدیر فعلی از صندوق طلب دارد، می‌توانید همین‌جا تسویه‌اش کنید تا حساب برای مدیر بعدی از صفر شروع شود.</p>
      <div class="form" style="max-width:560px">
        <label class="f">نام مدیر جدید<input class="inp" id="hoNew" placeholder="نام و نام خانوادگی مدیر بعدی"></label>
        <label class="f">تاریخ تحویل${dateBoxHtml('ho')}</label>
        <div class="frow">
          <label class="f">تسویه‌ی طلب مدیر فعلی (${curFa()})<input class="inp num" id="hoAmount" data-money="hoHint" inputmode="numeric" value="${d.managerDebt > 0 ? sep(Math.round(r2d(d.managerDebt))) : ''}"><span class="hint" id="hoHint"></span></label>
          <label class="f">از کدام صندوق<select class="inp" id="hoFund">${d.funds.map(f => `<option value="${f.id}">${esc(f.name)} (${money(f.balance)})</option>`).join('')}</select></label>
        </div>
        <label class="f">توضیح<input class="inp" id="hoNote" placeholder="اختیاری"></label>
        <div class="fbtns"><button class="btn primary" id="hoSave">ثبت تحویل مدیریت</button></div>
      </div></div>
    <div class="panel"><div class="phead"><b>تاریخچه‌ی تحویل مدیریت</b></div>
      ${d.rows.length ? `<div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>از مدیر</th><th>به مدیر</th><th>تسویه‌شده</th><th>توضیح</th></tr></thead><tbody>
        ${d.rows.map(h => `<tr><td class="num">${faDigit(h.j_date)}</td><td>${esc(h.outgoing_name || '—')}</td><td><b>${esc(h.incoming_name)}</b></td>
          <td class="num amt-out">${money(h.settled_amount)}</td><td>${esc(h.note || '—')}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">هنوز تحویلی ثبت نشده است</div>'}</div>`
  wireToday($('#setBody')); wireMoney($('#setBody'))
  $('#hoNameSave').onclick = guard(async () => { await post('/api/manager/name', { name: $('#hoName').value.trim() }); toast('نام مدیر ذخیره شد'); refresh() })
  $('#hoSave').onclick = guard(async () => {
    const name = $('#hoNew').value.trim(); if (!name) throw new Error('نام مدیر جدید را وارد کنید')
    const r = await post('/api/handovers', { incomingName: name, settleAmount: readMoney($('#hoAmount')), fundId: +$('#hoFund').value, note: $('#hoNote').value.trim(), ...readDate('ho') })
    toast(`تحویل ثبت شد — طلب باقی‌مانده‌ی مدیر: ${moneyU(r.remainingDebt)}`); refresh()
  })
}
SETTINGS.users = async () => {
  const users = await api('/api/users')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>کاربران</b><button class="btn small primary" id="newUser">＋ کاربر جدید</button></div>
      <p class="sub">رئیس هیئت مدیره و بازرس فقط مشاهده می‌کنند — امکان ثبت، ویرایش یا حذف ندارند (هم در رابط و هم در سرور).</p>
      <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td><b>${esc(u.display_name)}</b></td><td class="num">${esc(u.username)}</td>
        <td><span class="catpill">${esc(u.roleFa)}</span></td>
        <td>${u.active ? '<span class="badge b-settled">فعال</span>' : '<span class="badge b-vacant">معلق</span>'}</td>
        <td><button class="mini-btn" data-tog="${u.id}" data-act="${u.active ? 0 : 1}">${u.active ? 'تعلیق' : 'فعال‌سازی'}</button>
          <button class="mini-btn" data-pw="${u.id}">تغییر رمز</button>
          ${u.id === ME.id ? '' : `<button class="del" data-deluser="${u.id}">🗑</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`
  $('#newUser').onclick = () => userForm()
  document.querySelectorAll('[data-tog]').forEach(b => b.onclick = guard(async () => {
    await post(`/api/users/${b.dataset.tog}`, { active: +b.dataset.act === 1 }, 'PATCH'); refresh()
  }))
  document.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => {
    openModal('تغییر رمز', `<div class="form"><label class="f">رمز جدید<input class="inp" id="pwNew" type="password"></label></div>`,
      `<button class="btn primary" id="pwSave">ذخیره</button><button class="btn" id="pwCancel">انصراف</button>`)
    $('#pwCancel').onclick = closeModal
    $('#pwSave').onclick = guard(async () => {
      const v = $('#pwNew').value; if (v.length < 4) throw new Error('رمز حداقل ۴ کاراکتر')
      await post(`/api/users/${b.dataset.pw}`, { password: v }, 'PATCH'); closeModal(); toast('رمز تغییر کرد')
    })
  })
  document.querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => confirmBox('این کاربر حذف شود؟',
    async () => { await api(`/api/users/${b.dataset.deluser}`, { method: 'DELETE' }); toast('کاربر حذف شد'); refresh() }))
}
function userForm() {
  openModal('کاربر جدید', `<div class="form">
    <label class="f">نام و نام خانوادگی<input class="inp" id="usName"></label>
    <div class="frow">
      <label class="f">نام کاربری<input class="inp" id="usUser"></label>
      <label class="f">رمز عبور<input class="inp" id="usPass" type="password"></label>
    </div>
    <label class="f">نقش<select class="inp" id="usRole">${META.roles.map(r => `<option value="${r.value}">${esc(r.fa)}</option>`).join('')}</select></label></div>`,
    `<button class="btn primary" id="usSave">افزودن</button><button class="btn" id="usCancel">انصراف</button>`)
  $('#usCancel').onclick = closeModal
  $('#usSave').onclick = guard(async () => {
    await post('/api/users', { displayName: $('#usName').value.trim(), username: $('#usUser').value.trim(), password: $('#usPass').value, role: $('#usRole').value })
    closeModal(); toast('کاربر افزوده شد'); refresh()
  })
}
SETTINGS.backup = async () => {
  const s = await api('/api/settings')
  const backups = await api('/api/backups?path=' + encodeURIComponent(s.backupPath || ''))
  $('#setBody').innerHTML = `
    <div class="bkcard"><div class="bkicon">💾</div><div class="bkbody">
      <h3>پشتیبان‌گیری</h3><p>یک فایل zip شامل کل دیتابیس و همه‌ی اسناد. این فایل مستقیماً قابل بازیابی است.</p>
      <div class="bkrow"><input class="inp" id="bkPath" placeholder="مسیر پوشه‌ی بکاپ (خالی = کنار برنامه)" value="${esc(s.backupPath || '')}">
        <button class="btn small" id="bkBrowse">انتخاب پوشه</button></div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="bkAuto" ${s.autoBackup ? 'checked' : ''}> بکاپ خودکار هنگام هر بار بالا آمدن برنامه</label>
      <div class="fbtns"><button class="btn primary" id="bkNow">ساخت بکاپ</button>
        <a class="btn" href="/api/backup/download">⬇️ دانلود بکاپ</a>
        <button class="btn" id="bkSaveSet">ذخیره‌ی تنظیمات</button></div>
      ${backups.length ? `<div style="margin-top:14px"><div class="hint">بکاپ‌های موجود:</div>
        ${backups.slice(0, 6).map(b => `<div class="bkitem"><span>${esc(b.name)}</span><span class="num">${faDigit(b.stamp)}</span></div>`).join('')}</div>` : ''}
    </div></div>
    <div class="bkcard"><div class="bkicon">♻️</div><div class="bkbody">
      <h3>بازیابی از بکاپ</h3><p><b>هشدار:</b> اطلاعات فعلی با محتوای فایل بکاپ جایگزین می‌شود و نشست‌ها بسته می‌شوند.</p>
      <label class="drop" id="rsLbl" for="rsFile">📦 انتخاب فایل بکاپ (zip)<input type="file" id="rsFile" accept=".zip" hidden></label>
      <div class="fbtns" style="margin-top:12px"><button class="btn danger" id="rsGo" disabled>بازیابی</button></div>
    </div></div>
    <div class="bkcard"><div class="bkicon">⬆️</div><div class="bkbody">
      <h3>آپدیت نرم‌افزار</h3><p>بسته‌ی آپدیت فقط کد را عوض می‌کند؛ پوشه‌های <b>data</b> و <b>uploads</b> دست‌نخورده می‌مانند.</p>
      <label class="drop" id="upLbl" for="upFile">📦 انتخاب بسته‌ی آپدیت (zip)<input type="file" id="upFile" accept=".zip" hidden></label>
      <div class="fbtns" style="margin-top:12px"><button class="btn primary" id="upGo" disabled>اعمال آپدیت</button>
        <a class="btn" href="/api/update/package">⬇️ دانلود بسته‌ی نصب فعلی</a></div>
    </div></div>`
  $('#bkSaveSet').onclick = guard(async () => {
    await post('/api/settings', { backupPath: $('#bkPath').value.trim(), autoBackup: $('#bkAuto').checked }); toast('ذخیره شد')
  })
  $('#bkNow').onclick = guard(async () => {
    const r = await post('/api/backup', { path: $('#bkPath').value.trim() })
    toast(`بکاپ ساخته شد: ${r.folder}`)
  })
  $('#bkBrowse').onclick = () => browseDirs(p => { $('#bkPath').value = p })
  const wireZip = (fileId, lblId, btnId, run) => {
    let data = null
    $('#' + fileId).onchange = guard(async e => {
      const f = e.target.files[0]; if (!f) return
      data = await readFileDataUrl(f)
      $('#' + lblId).className = 'drop has'; $('#' + lblId).textContent = '✅ ' + f.name
      $('#' + btnId).disabled = false
    })
    $('#' + btnId).onclick = () => run(() => data)
  }
  wireZip('rsFile', 'rsLbl', 'rsGo', getData => confirmBox('اطلاعات فعلی با فایل بکاپ جایگزین شود؟ این کار برگشت‌پذیر نیست.',
    async () => { const r = await post('/api/backup/restore', { dataUrl: getData() }); toast(`بازیابی شد (${faDigit(r.count)} سند) — دوباره وارد شوید`); setTimeout(() => location.reload(), 1600) }))
  wireZip('upFile', 'upLbl', 'upGo', getData => confirmBox('بسته‌ی آپدیت اعمال شود؟ پس از آن برنامه را دوباره اجرا کنید.',
    async () => { const r = await post('/api/update', { dataUrl: getData() }); toast(`${faDigit(r.count)} فایل به‌روزرسانی شد — برنامه را ببندید و دوباره باز کنید`) }))
}
function browseDirs(onPick) {
  let cur = ''
  const load = guard(async p => {
    const d = await api('/api/fs/dirs?path=' + encodeURIComponent(p || ''))
    cur = d.path
    $('#modalBody').innerHTML = `<div class="fspath">${esc(d.path)}</div>
      <div style="padding:8px 0">${d.parent ? `<div class="fsitem" data-p="${esc(d.parent)}">📁 .. (بالاتر)</div>` : ''}
      ${d.dirs.map(n => `<div class="fsitem" data-p="${esc(d.path + '/' + n)}">📁 ${esc(n)}</div>`).join('') || '<div class="empty">زیرپوشه‌ای نیست</div>'}</div>`
    $('#modalBody').querySelectorAll('[data-p]').forEach(i => i.onclick = () => load(i.dataset.p))
  })
  openModal('انتخاب پوشه', '<div class="empty">…</div>', `<button class="btn primary" id="fsPick">انتخاب همین پوشه</button><button class="btn" id="fsCancel">انصراف</button>`)
  $('#fsCancel').onclick = closeModal
  $('#fsPick').onclick = () => { onPick(cur); closeModal() }
  load('')
}

// ==================== راهنما و موبایل ====================
VIEWS.help = async () => {
  const lan = LAN_URL
  let qr = ''
  try { if (lan) qr = qrSvg(lan, { scale: 6, margin: 2, dark: '#111', light: '#fff' }) } catch { qr = '' }
  const cards = [
    ['🚪', 'واحدها', 'ابتدا واحدهای ساختمان را با شماره، طبقه، متراژ، تعداد نفرات و نام ساکن وارد کنید. هر واحد می‌تواند شارژ اختصاصی داشته باشد. واحد خالی را با برداشتن تیک «واحد پر است» مشخص کنید تا از هزینه‌های خاص معاف شود.'],
    ['🧾', 'فاکتورها و تسهیم', 'هر هزینه‌ی ساختمان را به‌عنوان یک فاکتور ثبت کنید. مبلغ کل بین واحدهای مشمول به یکی از پنج روش (مساوی، متراژ، نفرات، شارژ هر واحد، دستی) تقسیم می‌شود و جمع سهم‌ها همیشه دقیقاً برابر مبلغ فاکتور می‌ماند.'],
    ['💰', 'دریافتی‌ها', 'واریز هر واحد را ثبت کنید. مبلغ خودکار از قدیمی‌ترین بدهی همان واحد تسویه می‌شود (FIFO) یا می‌توانید فاکتور مشخصی را تیک بزنید. مازاد، بستانکاری واحد می‌شود و در فاکتورهای بعدی خودکار مصرف می‌گردد.'],
    ['🏦', 'صندوق‌ها و طلب مدیر', 'هر واریز به یک صندوق می‌رود و هر فاکتور از یک صندوق پرداخت می‌شود. اگر مدیر هزینه‌ای را از جیب خود بدهد، «طلب مدیر» بالا می‌رود و بعداً از صندوق تسویه می‌شود.'],
    ['📅', 'شارژ ماهانه', 'مبلغ شارژ سراسری را در تنظیمات تعیین کنید؛ در ابتدای هر ماه شارژ به‌صورت خودکار برای همه‌ی واحدهای مشمول صادر می‌شود. تغییر مبلغ شارژ، شارژهای صادرشده‌ی قبلی را تغییر نمی‌دهد.'],
    ['📑', 'گزارش‌ها', 'گزارش عملکرد مدیر مالی برای ارائه به هیئت مدیره، گزارش بدهکاران با قدمت بدهی، گزارش فاکتوری، کارت واحد با صورت‌حساب چاپی و تراز کل. همه‌ی جدول‌ها خروجی CSV سازگار با اکسل دارند.'],
    ['⚖️', 'مانده اولیه', 'اگر پیش از شروع کار با نرم‌افزار، واحدها بدهی/بستانکاری یا صندوق‌ها موجودی داشته‌اند، از تنظیمات ← مانده اولیه واردشان کنید تا دفاتر از همان نقطه تراز بماند.'],
    ['💾', 'پشتیبان و آپدیت', 'از تنظیمات ← پشتیبان، یک فایل zip شامل کل دیتابیس و اسناد بسازید که مستقیماً قابل بازیابی است. بسته‌ی آپدیت فقط کد را عوض می‌کند و به داده‌ها و اسناد دست نمی‌زند.']
  ]
  $('#view').innerHTML = head('راهنما و کار با موبایل', 'کار با نرم‌افزار، اتصال از گوشی، و درباره‌ی توی دید') +
    `<div class="helpsec">📱 کار با موبایل — اتصال از گوشی روی همان وای‌فای</div>
     <div class="qrcard">
       <div class="qrwrap big">${qr || '<div class="empty" style="padding:34px 20px">آدرس شبکه پیدا نشد</div>'}</div>
       <div class="qrinfo">
         <h3>گوشی را به همین برنامه وصل کنید</h3>
         <p>سیستمی که برنامه روی آن باز است و گوشی شما باید به یک وای‌فای وصل باشند. کد بالا را با دوربین گوشی اسکن کنید، یا آدرس زیر را در مرورگر گوشی بزنید:</p>
         ${lan ? `<div class="qraddr">آدرس در شبکه: <b class="num" dir="ltr">${esc(lan)}</b></div>`
        : `<div class="qraddr">فعلاً به شبکه‌ی محلی وصل نیستید — به وای‌فای وصل شوید و این صفحه را دوباره باز کنید.</div>`}
         <p class="hint">با نام کاربری و رمز خودتان وارد شوید. رئیس هیئت مدیره و بازرس هم می‌توانند از گوشی، گزارش‌ها را به‌صورت فقط-مشاهده ببینند.</p>
       </div>
     </div>
     <div class="helpsec">📘 راهنمای کار با نرم‌افزار</div>
     <div class="helpgrid">
       ${cards.map(([g, t, p]) => `<div class="helpcard"><h3>${g} ${esc(t)}</h3><p>${esc(p)}</p></div>`).join('')}
     </div>
     <div class="helpcard helpwarn" style="margin-top:14px"><h3>⚠️ نکته‌های مهم</h3>
       <p>• پوشه‌های <b>data</b> و <b>uploads</b> را دستی جابه‌جا یا حذف نکنید؛ همه‌ی اطلاعات و اسناد آنجاست.</p>
       <p>• برای امنیت، هر چند وقت یک‌بار بکاپ بگیرید و فایل بکاپ را جای دیگری هم نگه دارید.</p>
       <p>• رمز مدیر را در جای امن نگه دارید؛ بدون آن ورود به برنامه ممکن نیست.</p></div>
     <div class="helpsec">ℹ️ درباره‌ی توی دید</div>
     <div class="abhero">
       <div class="ablogo">TOYEDID · توی دید</div>
       <h1>حسابداری ساختمان، شفاف و «توی دید» همه</h1>
       <p>این نرم‌افزار برای مدیران ساختمان ساخته شده تا مدیریت مالی ساختمان — شارژ، هزینه‌ها، صندوق‌ها و بدهی واحدها — ساده، دقیق و قابل ارائه به همه‌ی اهالی و هیئت مدیره باشد. همه‌چیز به‌صورت محلی روی سیستم خودتان اجرا می‌شود و اطلاعات جایی بیرون نمی‌رود.</p>
       <a class="abcta" href="https://toyedid.com" target="_blank" rel="noopener">toyedid.com</a>
     </div>
     <div class="abfootnote">نسخه‌ی فعلی: <b class="num">${escFa(APP_VER)}</b> · ساخته‌شده با ❤️ برای مدیران ساختمان — <a href="https://toyedid.com" target="_blank" rel="noopener">توی دید</a></div>`
}

// ==================== شروع ====================
boot().catch(e => { $('#auth').classList.remove('hidden'); $('#authErr').textContent = e.message })
