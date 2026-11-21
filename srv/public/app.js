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
// واژه‌نامهٔ مرکزی (مورد ۲۲ ممیزی)
const TERMS = { debt: 'بدهی', credit: 'پیش‌پرداخت', residentCredit: 'پیش‌پرداخت ساکنین', useCredit: 'استفاده از پیش‌پرداخت', managerClaim: 'طلب مدیر از صندوق', fundReceivable: 'بدهی ساکنین' }
const normFa = t => String(t ?? '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim()
const signed = r => (r < 0 ? '−' : '') + money(Math.abs(r))

// ---------- واتساپ ----------
const IS_DESKTOP = !!(window.hesabdar && window.hesabdar.isDesktop)
// شماره‌ی ایرانی را به قالب بین‌المللی واتساپ تبدیل می‌کند (بهترین حدس)
function waPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('0098')) d = d.slice(2)
  else if (d.startsWith('98')) { /* آماده است */ }
  else if (d.startsWith('0')) d = '98' + d.slice(1)
  else if (d.length === 10 && d.startsWith('9')) d = '98' + d
  return d
}
function debtorWaText(u) {
  const b = (typeof META !== 'undefined' && META && META.buildingName) || 'ساختمان'
  return `سلام ${u.resident_name || 'ساکن گرامی'} عزیز 🌱\n`
    + `صورت‌حساب واحد ${faDigit(u.number)} — ${b}\n`
    + `بدهی فعلی شما: ${moneyU(u.debt)}\n`
    + (u.aging && u.aging.days > 0 && u.aging.days < 9000 ? `قدمت بدهی: ${faDigit(u.aging.days)} روز\n` : '')
    + payInfoText()
    + `لطفاً در اولین فرصت نسبت به تسویه اقدام بفرمایید. سپاس فراوان`
}
// خطِ «کجا واریز کنم» برای پیام‌ها (اگر در تنظیمات واردشده)
function payInfoText() {
  const m = (typeof META !== 'undefined' && META) || {}
  if (!m.payCard && !m.payIban) return ''
  const card = m.payCard ? String(m.payCard).replace(/[^\d۰-۹]/g, '').replace(/(.{4})(?=.)/g, '$1-') : ''
  return (card ? `کارت: ${card}\n` : '') + (m.payIban ? `شبا: ${m.payIban}\n` : '') + (m.payHolder ? `به نام: ${m.payHolder}\n` : '') + (m.payDueDay ? `مهلت پرداخت شارژ: تا ${faDigit(m.payDueDay)}ام هر ماه\n` : '')
}
function followupForm(unitId, after) {
  openModal('ثبت پیگیری', `<div class="form">
    <label class="f">روش<select class="inp" id="fuCh"><option value="call">تماس</option><option value="whatsapp">واتساپ</option><option value="sms">پیامک</option><option value="visit">حضوری</option><option value="note">یادداشت</option></select></label>
    <label class="f">نتیجه / توضیح<input class="inp" id="fuNote" placeholder="مثلاً قول داد آخر ماه بپردازد"></label>
    <label class="f">قولِ پرداخت تا تاریخ (اختیاری) ${dateBoxHtml('fup')}</label>
    <label class="f">مبلغِ قول (${curFa()}، اختیاری)<input class="inp num" id="fuAmt" data-money="fuHint" inputmode="numeric"><span class="hint" id="fuHint"></span></label></div>`,
    `<button class="btn primary" id="fuSave">ثبت</button><button class="btn" id="fuCancel">انصراف</button>`)
  wireToday($('#modalBody')); wireMoney($('#modalBody'))
  $('#fuCancel').onclick = closeModal
  $('#fuSave').onclick = guard(async () => {
    const pr = readDate('fup'), amt = readMoney($('#fuAmt'))
    await post(`/api/units/${unitId}/followups`, { channel: $('#fuCh').value, note: $('#fuNote').value.trim(), promise: pr.jy && pr.jm && pr.jd ? pr : null, promiseAmount: amt })
    closeModal(); toast('پیگیری ثبت شد'); after ? after() : refresh()
  })
}
function openWhatsApp(u) {
  if (!u.phone) return toast('برای این واحد شماره تلفن ثبت نشده است', true)
  const ph = waPhone(u.phone)
  if (isAdmin()) post(`/api/units/${u.id}/followups`, { channel: 'whatsapp', note: 'ارسال پیام بدهی' }).catch(() => { })
  const url = `https://wa.me/${ph}?text=${encodeURIComponent(debtorWaText(u))}`
  window.open(url, '_blank', 'noopener')
}

// رسیدِ پرداخت: PDF (اپ نصبی) یا صفحهٔ چاپ (مرورگر) + ارسال در واتساپ
function openReceipt(id) {
  const rel = '/print/payment/' + id
  if (typeof IS_DESKTOP !== 'undefined' && IS_DESKTOP && window.hesabdar && window.hesabdar.savePdf) {
    toast('در حال ساخت رسید…')
    window.hesabdar.savePdf(rel, 'رسید پرداخت ' + id).then(x => toast(x && x.ok ? 'رسید در پوشهٔ «اسناد صادرشده» ذخیره شد' : 'ساخت رسید ناموفق بود', !(x && x.ok)))
  } else window.open(rel + '?print=1', '_blank')
}
async function waReceipt(id) {
  const v = await api(`/api/report/voucher?dtype=payment&id=${id}`); const p = v.raw
  const u = (META.units || []).find(x => x.id === p.unit_id) || {}
  if (!u.phone) return toast('برای این واحد شمارهٔ تلفن ثبت نشده است', true)
  const t = `سلام ${u.resident_name || 'ساکن گرامی'} 🌱\n${faDigit(v.head.no)} — ${META.buildingName || 'ساختمان'}\nمبلغ ${moneyU(p.amount)} در تاریخ ${faDigit(p.j_date)} دریافت شد.\nبا سپاس از پرداخت شما 🙏`
  window.open(`https://wa.me/${waPhone(u.phone)}?text=${encodeURIComponent(t)}`, '_blank', 'noopener')
}
const rcptBtns = id => `<button class="btn tiny" data-rcpt="${id}" title="رسید PDF">🧾</button><button class="btn tiny" data-rcwa="${id}" title="ارسال رسید در واتساپ">💬</button>`
document.addEventListener('click', e => {
  const r = e.target.closest('[data-rcpt]'); if (r) { e.stopPropagation(); return openReceipt(+r.dataset.rcpt) }
  const w = e.target.closest('[data-rcwa]'); if (w) { e.stopPropagation(); return waReceipt(+w.dataset.rcwa).catch(err => toast(err.message, true)) }
})
function receiptOffer(id, msg) {
  openModal('دریافتی ثبت شد', `<p style="font-size:14px;line-height:2">${esc(msg)}</p><p class="hint">رسیدِ این پرداخت را برای ساکن بفرستید:</p>`,
    `<button class="btn primary" id="roPdf">رسید PDF</button><button class="btn" id="roWa">ارسال در واتساپ</button><button class="btn" id="roClose">بستن</button>`)
  $('#roPdf').onclick = () => openReceipt(id)
  $('#roWa').onclick = guard(() => waReceipt(id))
  $('#roClose').onclick = closeModal
}

const api = (u, o) => fetch(u, o).then(async r => {
  const d = await r.json().catch(() => ({}))
  if (r.status === 401) { location.reload(); throw new Error('نیاز به ورود') }
  if (!r.ok) throw new Error(d.error || 'خطای ارتباط با سرور')
  return d
})
// درخواستِ نوشتنیِ یکسانِ هم‌زمان فقط یک بار فرستاده می‌شود (جلوگیری از سندِ تکراری با دوبار کلیک/Enter)
const inflight = new Map()
const post = (u, body, method = 'POST') => {
  const b = JSON.stringify(body || {}), k = method + ' ' + u + ' ' + b
  if (inflight.has(k)) return inflight.get(k)
  const p = api(u, { method, headers: { 'Content-Type': 'application/json' }, body: b }).finally(() => inflight.delete(k))
  inflight.set(k, p); return p
}

let toastT = null
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '')
  t.setAttribute('role', isErr ? 'alert' : 'status')
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', isErr ? 6500 : 3000)
  // خطا وقتی فرمی باز است، داخلِ خودِ فرم هم نوشته می‌شود تا دیده شود
  const m = $('#modal'), f = $('#modalFoot')
  if (isErr && m && !m.classList.contains('hidden') && f && !f.classList.contains('hidden')) {
    let e = f.querySelector('.ferr'); if (!e) { e = document.createElement('span'); e.className = 'ferr'; f.appendChild(e) }
    e.textContent = msg
  }
}
// اجرای امن + قفلِ دکمه تا پایانِ درخواست (دوبار کلیک = دوبار ثبت نمی‌شود)
const guard = fn => async (...a) => {
  const ev = a[0], btn = ev && ev.currentTarget && ev.currentTarget.tagName === 'BUTTON' ? ev.currentTarget : null
  if (btn) { if (btn.classList.contains('busy')) return; btn.classList.add('busy') }
  try { await fn(...a) } catch (e) { toast(e.message, true) } finally { if (btn) btn.classList.remove('busy') }
}

// ---------- مودال ----------
let modalDirty = false
function openModal(title, bodyHtml, footHtml) {
  modalDirty = false
  $('#modalTitle').textContent = title
  $('#modalBody').innerHTML = bodyHtml
  const f = $('#modalFoot')
  if (footHtml) { f.innerHTML = footHtml; f.classList.remove('hidden') } else { f.innerHTML = ''; f.classList.add('hidden') }
  $('#modal').classList.remove('hidden')
  const mb = $('#modalBody')
  mb.oninput = mb.onchange = e => { if (e.target.matches('input,select,textarea')) modalDirty = true }
  return mb
}
const closeModal = () => { modalDirty = false; $('#modal').classList.add('hidden') }
// بستن با ✕ / کلیک بیرون / Esc: اگر فرم تغییر کرده، اول می‌پرسد
const tryCloseModal = () => {
  if (!modalDirty) return closeModal()
  confirmBox('تغییراتِ این فرم ذخیره نشده است. بسته شود و تغییرات از بین برود؟', async () => closeModal(), 'بله، بسته شود')
}
$('#modalX').onclick = tryCloseModal
$('#modal').onclick = e => { if (e.target.id === 'modal') tryCloseModal() }
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  const c = document.querySelector('.cfm'); if (c) return c.remove()
  if (!$('#modal').classList.contains('hidden')) tryCloseModal()
})

// تأیید در لایهٔ جداگانه (فرمِ زیرش از بین نمی‌رود)
function confirmBox(msg, onYes, yesLabel = 'بله، انجام شود') {
  const d = document.createElement('div'); d.className = 'cfm'
  d.innerHTML = `<div class="cbox" role="alertdialog"><p>${esc(msg).replace(/\n/g, '<br>')}</p><div class="cbtns"><button class="btn danger" data-y>${esc(yesLabel)}</button><button class="btn" data-n>انصراف</button></div></div>`
  document.body.appendChild(d)
  const close = () => d.remove()
  d.querySelector('[data-n]').onclick = close
  d.onclick = e => { if (e.target === d) close() }
  d.querySelector('[data-y]').onclick = guard(async () => { close(); await onYes() })
  d.querySelector('[data-n]').focus()
}

// تأییدِ حذفِ سندِ مالی با ذکرِ علت (در سابقهٔ تغییرات ثبت می‌شود)
function confirmReason(msg, onYes) {
  const d = document.createElement('div'); d.className = 'cfm'
  d.innerHTML = `<div class="cbox" role="alertdialog"><p>${esc(msg)}</p>
    <label class="f">علتِ حذف (الزامی؛ در سابقهٔ تغییرات می‌ماند)<input class="inp" data-r placeholder="مثلاً: ثبت تکراری / مبلغ اشتباه"></label>
    <div class="cbtns" style="margin-top:12px"><button class="btn danger" data-y>حذف شود</button><button class="btn" data-n>انصراف</button></div></div>`
  document.body.appendChild(d)
  const close = () => d.remove(), inp = d.querySelector('[data-r]')
  d.querySelector('[data-n]').onclick = close
  d.onclick = e => { if (e.target === d) close() }
  d.querySelector('[data-y]').onclick = guard(async () => {
    const r = inp.value.trim(); if (r.length < 3) { inp.classList.add('bad'); inp.focus(); throw new Error('علتِ حذف را بنویسید') }
    close(); await onYes(r)
  })
  inp.focus()
}

// ---------- تاریخ ----------
const todayJ = () => { const d = new Date(); return toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
// مُهرِ تاریخِ شمسی برای نامِ فایل (ارقامِ لاتین): 1405-08-30
const jStamp = () => { const t = todayJ(); return `${t.jy}-${String(t.jm).padStart(2, '0')}-${String(t.jd).padStart(2, '0')}` }
// چاپ/ذخیرهٔ PDF از مرورگر با نامِ پیش‌فرضِ مناسب (نامِ گزارش + تاریخ) تا تکراری/گنگ نشود
// چاپِ رسمی از سرور: اپ نصبی → PDF در «اسناد صادرشده»؛ مرورگر → صفحهٔ چاپی
window.printOfficial = function (rel, name) {
  if (IS_DESKTOP && window.hesabdar && window.hesabdar.savePdf) { toast('در حال ساخت PDF…'); window.hesabdar.savePdf(rel, name).then(x => toast(x && x.ok ? 'PDF ذخیره شد' : (x && x.error) || 'ناموفق', !(x && x.ok))) }
  else window.open(rel + (rel.includes('?') ? '&' : '?') + 'print=1', '_blank')
}
window.printAs = function (name) {
  const prev = document.title
  document.title = `${name} — ${jStamp()}`
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore) }
  window.addEventListener('afterprint', restore)
  setTimeout(() => { window.print() }, 40)
}
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
let ME = null, META = null, VIEW = 'dashboard', setupMode = false, LAN_URL = '', APP_VER = '', NEEDS_RC = false
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
  LAN_URL = st.lanUrl || ''; APP_VER = st.version || ''; NEEDS_RC = !!st.needsRecoveryCode
  if (st.needsSetup) { setupMode = true; showAuth(true); return }
  if (!st.user) { showAuth(false); return }
  ME = st.user
  $('#auth').classList.add('hidden'); $('#shell').classList.remove('hidden')
  $('#meName').textContent = ME.name; $('#meRole').textContent = ME.roleFa
  await loadMeta()
  if (!isAdmin()) $('#nav').querySelector('[data-view="settings"]').classList.add('hidden')
  setupQuickFab()
  routeFromHash() || render()
}
// دکمهٔ دسترسی سریعِ شناور (فقط مدیر): فاکتور، پرداخت هزینه، دریافت گروهی/تکی
function setupQuickFab() {
  const wrap = $('#fabWrap'); if (!wrap) return
  if (!isAdmin()) { wrap.classList.add('hidden'); return }
  wrap.classList.remove('hidden')
  const close = () => wrap.classList.remove('open')
  $('#fabMain').onclick = e => { e.stopPropagation(); wrap.classList.toggle('open') }
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close() })
  wrap.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
    close()
    const q = b.dataset.quick
    if (q === 'invoice') invoiceForm()
    else if (q === 'receipt') paymentForm()
    else if (q === 'bulk') bulkPaymentForm()
    else if (q === 'pay') payExpensePicker()
    else if (q === 'charge') quickIssueCharge()
  })
}
// صدورِ شارژ با پیش‌نمایش: ماه‌ها، مبلغِ هر واحد و جمع؛ بعد از صدور امکانِ «برگرداندن»
async function chargeIssueFlow(periods) {
  if (!periods.length) return
  const pv = await api('/api/charge/preview?periods=' + periods.join(','))
  const todo = pv.filter(x => !x.exists)
  if (!todo.length) return toast('شارژِ این ماه‌ها قبلاً صادر شده است', true)
  const total = todo.reduce((a, x) => a + x.amount, 0)
  const rows = todo[todo.length - 1].rows
  const same = todo.every(x => x.amount === todo[0].amount)
  openModal('پیش‌نمایشِ صدور شارژ', `<div class="form">
    <div class="tablewrap"><table class="tx"><thead><tr><th>ماه</th><th>تعداد واحد</th><th>جمع شارژ</th></tr></thead><tbody>
      ${todo.map(x => `<tr><td><b>${escFa(x.fa)}</b></td><td class="num">${faDigit(x.units)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>جمع (${faDigit(todo.length)} ماه)</td><td></td><td class="num">${money(total)}</td></tr></tfoot></table></div>
    <details style="margin-top:8px"><summary class="hint">مبلغِ هر واحد${same ? '' : ' (ماهِ آخر)'}</summary>
      <div class="tablewrap" style="max-height:220px;overflow:auto"><table class="tx"><tbody>${rows.map(r => `<tr><td>واحد ${escFa(r.number)}</td><td>${esc(r.name)}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}</tbody></table></div></details>
    <p class="hint">برای هر ماه یک سندِ بدهی برای همهٔ واحدهای مشمول ساخته می‌شود. پیش‌پرداختِ واحدها خودکار رویش می‌نشیند.</p></div>`,
    `<button class="btn primary" id="ciGo">صدور ${faDigit(todo.length)} ماه</button><button class="btn" id="ciNo">انصراف</button>`)
  $('#ciNo').onclick = closeModal
  $('#ciGo').onclick = guard(async () => {
    const r = await post('/api/charge/issue', { periods: todo.map(x => x.period) })
    openModal('شارژ صادر شد', `<div class="form"><p>شارژِ <b>${faDigit(r.months)} ماه</b> برای <b>${faDigit(r.units)} واحد</b> صادر شد — جمع <b>${moneyU(r.amount)}</b>.</p>
      <p class="hint">اگر اشتباه بود، همین الان می‌توانید برگردانید (تا وقتی دریافتیِ تازه‌ای رویش ننشسته).</p></div>`,
      `<button class="btn" id="ciUndo">برگرداندن صدور</button><button class="btn primary" id="ciOk">باشه</button>`)
    refresh()
    $('#ciOk').onclick = closeModal
    $('#ciUndo').onclick = guard(async () => { await post('/api/charge/undo', { ids: r.ids }); closeModal(); toast('صدور شارژ برگردانده شد'); refresh() })
  })
}
// صدور سریعِ شارژ ماهانه از دکمهٔ دسترسی سریع
async function quickIssueCharge() {
  const p = await api('/api/charge/periods')
  const body = openModal('📅 صدور شارژ ماهانه', `<div class="form">
    <p class="hint">ماه جاری: <b>${escFa(p.currentFa)}</b></p>
    ${p.missing.length ? `<p class="sub">ماه‌هایی که هنوز شارژ صادر نشده‌اند:</p>
      <div class="tablewrap"><table class="tx"><tbody>${p.missing.map(m => `<tr><td><b>${escFa(m.fa)}</b></td>
        <td style="text-align:left"><button class="btn tiny primary" data-qissue="${m.period}">صدور</button></td></tr>`).join('')}</tbody></table></div>
      <div class="fbtns" style="margin-top:8px"><button class="btn primary" id="qiAll">صدور همهٔ ماه‌های عقب‌افتاده</button></div>`
    : '<div class="empty">شارژِ همهٔ ماه‌ها صادر شده است ✔</div>'}
  </div>`, `<button class="btn" id="qiCancel">بستن</button>`)
  $('#qiCancel').onclick = closeModal
  body.querySelectorAll('[data-qissue]').forEach(b => b.onclick = guard(() => chargeIssueFlow([b.dataset.qissue])))
  if ($('#qiAll')) $('#qiAll').onclick = guard(() => chargeIssueFlow(p.missing.map(m => m.period)))
}
// انتخابِ یک فاکتورِ هزینهٔ پرداخت‌نشده از صندوق و رفتن به فرم پرداخت
async function payExpensePicker() {
  const rows = (await api('/api/invoices')).filter(i => i.payable && i.fundUnpaid > 0)
  const body = openModal('💸 پرداخت هزینه از صندوق', rows.length ? `<div class="form">
    <p class="hint">فاکتوری که می‌خواهی از صندوق پرداخت کنی را انتخاب کن:</p>
    <div class="tablewrap" style="max-height:60vh;overflow:auto"><table class="tx">
      <thead><tr><th>شماره</th><th>عنوان</th><th>صندوق</th><th>مانده پرداخت</th><th></th></tr></thead><tbody>
      ${rows.map(i => `<tr><td class="num">${faDigit(i.id)}</td><td><b>${esc(i.title)}</b><br><span class="hint">${esc(i.categoryName)} · ${faDigit(i.j_date)}</span></td>
        <td class="hint">${esc(i.fundName)}</td><td class="num amt-out">${money(i.fundUnpaid)}</td>
        <td><button class="btn tiny primary" data-pay="${i.id}">پرداخت</button></td></tr>`).join('')}
      </tbody></table></div></div>` : '<div class="empty">هیچ هزینهٔ پرداخت‌نشده‌ای از صندوق نیست 🎉</div>',
    `<button class="btn" id="pxCancel">بستن</button>`)
  $('#pxCancel').onclick = closeModal
  body.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
    const i = rows.find(x => x.id === +b.dataset.pay)
    const d = await api('/api/invoice/' + i.id)
    payExpenseForm(d.invoice, d.funds)
  })
}
function showAuth(setup) {
  $('#auth').classList.remove('hidden'); $('#shell').classList.add('hidden')
  { const fw = $('#fabWrap'); if (fw) fw.classList.add('hidden') }
  $('#authTitle').textContent = setup ? 'ساخت حساب مدیر ساختمان' : 'ورود'
  $('#authSub').textContent = setup ? 'اولین اجرا — حساب مدیر را بسازید' : 'برای ادامه وارد شوید'
  $('#authBtn').textContent = setup ? 'ساخت حساب' : 'ورود'
  $('#authNameWrap').hidden = !setup; $('#authBuildingWrap').hidden = !setup
  $('#authPass').autocomplete = setup ? 'new-password' : 'current-password'
  const extra = $('#authExtra'); if (extra) extra.hidden = setup
  if (!setup && extra) {
    $('#forgotBtn').onclick = () => forgotForm()
    const lr = $('#localResetBtn'); lr.hidden = true
    api('/api/auth/local-reset/available').then(d => { if (d.available) { lr.hidden = false; lr.onclick = () => localResetForm() } }).catch(() => { })
  }
}
$('#authForm').onsubmit = async e => {
  e.preventDefault(); $('#authErr').textContent = ''
  const username = $('#authUser').value.trim(), password = $('#authPass').value
  try {
    if (setupMode) {
      const r = await post('/api/auth/setup', { username, password, displayName: $('#authName').value.trim(), buildingName: $('#authBuilding').value.trim() })
      setupMode = false
      await post('/api/auth/login', { username, password })
      showRecoveryCode(r.recoveryCode, { onDone: () => location.reload() })
      return
    }
    await post('/api/auth/login', { username, password })
    location.reload()
  } catch (err) { $('#authErr').textContent = err.message }
}
$('#logoutBtn').onclick = guard(async () => { await post('/api/auth/logout'); location.reload() })

// ---------- بازیابی رمز ----------
function showRecoveryCode(code, opts = {}) {
  openModal('🔑 کد بازیابی شما', `
    <div style="text-align:center">
      <p class="sub">${opts.isNew ? 'کد بازیابیِ جدید — کدِ قبلی دیگر کار نمی‌کند:' : 'این کد را در جای امنی نگه دارید:'}</p>
      <div style="font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:25px;font-weight:800;letter-spacing:2px;
        background:var(--panel-2);border:2px dashed var(--accent);border-radius:12px;padding:18px 10px;margin:12px 0;user-select:all;direction:ltr">${esc(code)}</div>
      <div class="notice warn" style="text-align:right;margin:0">این کد فقط <b>همین یک‌بار</b> نمایش داده می‌شود. اگر رمزتان را فراموش کنید، تنها راهِ ورود همین کد است. اگر گمش کنید، فقط از روی همین کامپیوتر می‌توانید ریست کنید.</div>
      <div class="fbtns" style="justify-content:center;margin-top:12px">
        <button class="btn" id="rcCopy">📋 کپی</button><button class="btn" id="rcPrint">🖨 چاپ</button><button class="btn" id="rcSave">⬇️ ذخیره فایل</button>
      </div>
      <label class="check" style="justify-content:center;margin-top:12px"><input type="checkbox" id="rcAck"> کد را در جای امنی ذخیره کردم</label>
    </div>`,
    `<button class="btn primary" id="rcDone" disabled>ادامه</button>`)
  const bn = (META && META.buildingName) || ($('#authBuilding') && $('#authBuilding').value.trim()) || 'ساختمان'
  const t = todayJ()
  const fileText = `کد بازیابیِ حسابدار ساختمان توی دید\nساختمان: ${bn}\nکد بازیابی: ${code}\nتاریخ: ${t.jy}/${t.jm}/${t.jd}\n\n⚠️ این کد را محرمانه و در جای امن نگه دارید.`
  $('#rcCopy').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('کپی شد')).catch(() => toast('کد را دستی کپی کنید', true)) }
  $('#rcSave').onclick = () => { const b = new Blob([fileText], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'کد-بازیابی-' + bn + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  $('#rcPrint').onclick = () => { const w = window.open('', '_blank'); if (w) { w.document.write('<pre style="font:20px monospace;direction:rtl;padding:30px;white-space:pre-wrap">' + esc(fileText) + '</pre>'); w.document.close(); w.focus(); w.print() } }
  $('#rcAck').onchange = e => { $('#rcDone').disabled = !e.target.checked }
  $('#rcDone').onclick = () => { closeModal(); if (opts.onDone) opts.onDone() }
}
function forgotForm() {
  openModal('بازیابی رمز', `<div class="form">
    <p class="sub">نام کاربری، کد بازیابی و رمز جدید را وارد کنید.</p>
    <label class="f">نام کاربری<input class="inp" id="fgUser"></label>
    <label class="f">کد بازیابی<input class="inp" id="fgCode" placeholder="XXXX-XXXX-XXXX-XXXX" style="font-family:monospace;letter-spacing:1px;direction:ltr;text-align:left"></label>
    <div class="frow"><label class="f">رمز جدید<input class="inp" id="fgPass" type="password"></label>
      <label class="f">تکرار رمز<input class="inp" id="fgPass2" type="password"></label></div>
    <div class="autherr" id="fgErr"></div></div>`,
    `<button class="btn primary" id="fgSave">تغییر رمز</button><button class="btn" id="fgCancel">انصراف</button>`)
  $('#fgCancel').onclick = closeModal
  $('#fgSave').onclick = async () => {
    const p = $('#fgPass').value; $('#fgErr').textContent = ''
    if (p.length < 8) return void ($('#fgErr').textContent = 'رمز باید حداقل ۸ کاراکتر باشد')
    if (p !== $('#fgPass2').value) return void ($('#fgErr').textContent = 'تکرار رمز یکسان نیست')
    try {
      const r = await post('/api/auth/recover', { username: $('#fgUser').value.trim(), code: $('#fgCode').value.trim(), newPassword: p })
      showRecoveryCode(r.newRecoveryCode, { isNew: true, onDone: () => location.reload() })
    } catch (e) { $('#fgErr').textContent = e.message }
  }
}
function localResetForm() {
  openModal('🖥 ریست رمز از این کامپیوتر', `<div class="form">
    <div class="notice warn" style="margin:0">این ریست فقط از روی همین کامپیوتر مجاز است. رمز جدیدِ مدیر را بگذارید.</div>
    <label class="f">نام کاربریِ مدیر<input class="inp" id="lrUser"></label>
    <div class="frow"><label class="f">رمز جدید<input class="inp" id="lrPass" type="password"></label>
      <label class="f">تکرار رمز<input class="inp" id="lrPass2" type="password"></label></div>
    <div class="autherr" id="lrErr"></div></div>`,
    `<button class="btn primary" id="lrSave">ریست رمز</button><button class="btn" id="lrCancel">انصراف</button>`)
  $('#lrCancel').onclick = closeModal
  $('#lrSave').onclick = async () => {
    const p = $('#lrPass').value; $('#lrErr').textContent = ''
    if (p.length < 8) return void ($('#lrErr').textContent = 'رمز باید حداقل ۸ کاراکتر باشد')
    if (p !== $('#lrPass2').value) return void ($('#lrErr').textContent = 'تکرار رمز یکسان نیست')
    try {
      const r = await post('/api/auth/local-reset', { username: $('#lrUser').value.trim(), newPassword: p })
      showRecoveryCode(r.newRecoveryCode, { isNew: true, onDone: () => location.reload() })
    } catch (e) { $('#lrErr').textContent = e.message }
  }
}

// ==================== مسیریابی ====================
$('#nav').onclick = e => {
  const b = e.target.closest('.nav-i'); if (!b) return
  VIEW = b.dataset.view; NAV_STACK = []
  render()
}
const VIEWS = {}
// وضعیتِ ناوبری: DETAIL = کارتِ باز (واحد/صندوق/پروژه)؛ NAV_STACK برای «بازگشت» به جای قبلی
let DETAIL = null, NAV_STACK = [], LAST_VIEW_RENDERED = ''
const DETAIL_FN = { unit: id => showUnitCard(id), fund: id => showFund(id), project: id => showProject(id) }
const syncNav = () => $('#nav').querySelectorAll('.nav-i').forEach(x => x.classList.toggle('on', x.dataset.view === VIEW))
function setHash() {
  const h = DETAIL ? `#/${DETAIL.type}/${DETAIL.id}` : `#/${VIEW}${VIEW === 'reports' ? '/' + repTab : ''}`
  if (location.hash !== h) try { history.pushState(null, '', h) } catch { }
}
// صدا زده می‌شود در ابتدای هر کارتِ جزئیات؛ اگر کارتِ تازه است، جای فعلی در پشته می‌رود
function markDetail(type, id) {
  const same = DETAIL && DETAIL.type === type && DETAIL.id === id
  if (!same) { NAV_STACK.push({ view: VIEW, repTab, detail: DETAIL, y: scrollY }); if (NAV_STACK.length > 30) NAV_STACK.shift() }
  DETAIL = { type, id }; setHash()
  return same
}
async function goBack(fallbackView) {
  const st = NAV_STACK.pop()
  if (!st) { VIEW = fallbackView; DETAIL = null; return render() }
  VIEW = st.view; repTab = st.repTab || repTab; syncNav()
  if (st.detail) { DETAIL = st.detail; await DETAIL_FN[st.detail.type](st.detail.id) } else { DETAIL = null; await render() }
  requestAnimationFrame(() => scrollTo(0, st.y || 0))
}
function render() {
  const f = VIEWS[VIEW] || VIEWS.dashboard
  const key = VIEW + '|' + (VIEW === 'reports' ? repTab : '')
  const same = !DETAIL && LAST_VIEW_RENDERED === key, y = scrollY
  DETAIL = null; LAST_VIEW_RENDERED = key; syncNav(); setHash()
  // همان صفحه دوباره ساخته می‌شود؟ محتوای قبلی تا رسیدنِ داده می‌ماند و اسکرول برمی‌گردد
  if (!same) $('#view').innerHTML = '<div class="empty">در حال بارگذاری…</div>'
  return f().then(() => { if (same) requestAnimationFrame(() => scrollTo(0, y)) }).catch(e => { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>` })
}
// بعد از هر ثبت/ویرایش/حذف: اگر کارتی باز است همان کارت تازه می‌شود (کاربر از کارت بیرون نمی‌افتد)
async function refresh() {
  await loadMeta()
  if (DETAIL) { const y = scrollY; await DETAIL_FN[DETAIL.type](DETAIL.id); requestAnimationFrame(() => scrollTo(0, y)) }
  else render()
}
// آدرسِ hash: باز کردنِ مستقیم و دکمهٔ «عقب» مرورگر
function routeFromHash() {
  const m = /^#\/([a-z]+)(?:\/([\w-]+))?/.exec(location.hash || ''); if (!m) return false
  if (DETAIL_FN[m[1]] && m[2]) { const d = { type: m[1], id: +m[2] }; VIEW = { unit: 'units', fund: 'funds', project: 'projects' }[m[1]]; syncNav(); DETAIL = d; DETAIL_FN[m[1]](+m[2]); return true }
  if (VIEWS[m[1]]) { VIEW = m[1]; if (m[1] === 'reports' && m[2]) repTab = m[2]; DETAIL = null; render(); return true }
  return false
}
window.addEventListener('popstate', () => { if (ME) { NAV_STACK = []; routeFromHash() || render() } })

const head = (title, sub, actions = '') =>
  `<div class="vhead printhide"><div><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div><div class="fbtns">${actions}</div></div>`
const kpi = (lbl, val, d = '', cls = '') =>
  `<div class="kpi ${cls}"><div class="lbl">${esc(lbl)}</div><div class="val num">${val}<span class="r"> ${curFa()}</span></div>${d ? `<div class="d">${d}</div>` : ''}</div>`
const kpiN = (lbl, val, d = '', cls = '') =>
  `<div class="kpi ${cls}"><div class="lbl">${esc(lbl)}</div><div class="val num">${val}</div>${d ? `<div class="d">${esc(d)}</div>` : ''}</div>`
const emptyRow = (cols, msg) => `<tr><td colspan="${cols}"><div class="empty">${esc(msg)}</div></td></tr>`
const statusBadge = s => s === 'settled' ? '<span class="badge b-settled">تسویه</span>' : '<span class="badge b-open">باز</span>'

// ==================== داشبورد ====================
VIEWS.dashboard = async () => {
  const d = await api('/api/report/dashboard')
  const missing = d.missingCharges || []
  const rcBanner = (NEEDS_RC && isAdmin())
    ? `<div class="notice danger printhide"><span>برای حساب شما <b>کد بازیابی</b> تنظیم نشده. اگر رمزتان را فراموش کنید، دسترسی به دفاتر مالی از دست می‌رود.</span>
       <button class="btn small primary" id="getRc">دریافت کد بازیابی</button></div>` : ''
  const bal = v => v < 0 ? `<span class="amt-out">(${money(-v)})</span>` : money(v)
  // ---- نیازمند توجه ----
  const alertAct = a => a.kind === 'charge' ? (isAdmin() ? `<button class="btn tiny primary" id="issueAll">صدور شارژ</button>` : '')
    : a.kind === 'fund' ? `<button class="link" data-fundcard="${a.fund}">گردش صندوق</button>`
      : a.kind === 'ci' ? `<button class="link" data-go="projects">پروژه‌ها</button>`
        : (a.kind === 'overdue' || a.kind === 'promise') ? `<button class="link" data-go="reports:debtors">بدهکاران</button>`
          : a.kind === 'backup' ? (isAdmin() ? `<button class="link" data-go="settings:backup">پشتیبان‌گیری</button>` : '')
          : a.kind === 'health' ? `<button class="link" data-go="reports:balance">مشاهدهٔ ایرادها</button>`
          : a.kind === 'exp' ? (isAdmin() ? `<button class="link" id="dPayExp">پرداخت</button>` : '')
          : a.kind === 'latefee' ? (isAdmin() ? `<button class="link" data-go="settings:charge">بررسی و اعمال</button>` : '') : ''
  const alertsHtml = (d.alerts || []).length ? `<div class="panel dalerts"><div class="phead"><b>نیازمند توجه</b><span class="hint">${faDigit(d.alerts.length)} مورد</span></div>
    ${d.alerts.map(a => `<div class="darow"><span class="ddot ${a.level === 'red' ? 'r' : 'a'}"></span>
      <span class="dtx">${a.kind === 'fund' ? esc(a.text.split(':')[0]) + ': <b class="num amt-out">' + money(a.amount) + '</b>' : esc(a.text)}${a.kind !== 'fund' && a.amount ? ' — <b class="num">' + money(a.amount) + '</b>' : ''}${a.kind === 'charge' ? ' (' + missing.map(m => escFa(m.fa)).join('، ') + ')' : ''}</span>
      <span class="dact">${alertAct(a)}</span></div>`).join('')}</div>` : ''
  // ---- صندوق‌ها ----
  const fundsOv = d.fundsOv || []
  const totalFundDebt = fundsOv.reduce((a, f) => a + (f.unitDebt || 0), 0)
  const fundCards = fundsOv.map(f => `<div class="kpi kclick" data-fundcard="${f.id}"><div class="lbl">${esc(f.name)}</div>
      <div class="val num">${bal(f.balance)}<span class="r"> ${curFa()}</span></div>
      <div class="d">بدهی ساکنین: <b class="num">${money(f.unitDebt || 0)}</b>${f.balance < 0 ? ' · <span class="amt-out">کسری</span>' : ''}</div></div>`).join('')
  // ---- ساکنین ----
  const ch = d.charge
  const chargeKpi = ch ? `<div class="kpi"><div class="lbl">وصولِ شارژِ ${escFa(d.monthFa)}</div>
      <div class="val num">${faDigit(ch.paidUnits)} <span class="r">از ${faDigit(ch.units)} واحد</span></div>
      <div class="dbar"><span style="width:${ch.units ? Math.round(ch.paidUnits / ch.units * 100) : 0}%"></span></div>
      <div class="d">وصول ${money(ch.collected)} از ${money(ch.committed)}</div></div>`
    : kpiN('وصولِ شارژِ ' + d.monthFa, '—', 'شارژ این ماه صادر نشده')
  // ---- آخرین‌ها ----
  const moves = (d.recentMoves || []).map(t => `<tr class="${t.dtype ? 'clickable' : ''}" ${t.dtype ? `data-voucher="${t.dtype}:${t.refid}"` : ''}>
      <td class="num">${faDigit(t.j)}</td><td>${esc(t.title)}<br><span class="hint">${esc(t.fund || '')}</span></td>
      <td class="num ${t.isIn ? 'amt-in' : 'amt-out'}">${t.isIn ? '+' : '−'}${money(t.amount)}</td></tr>`).join('')
  const K = { charge: 'شارژ', bill: 'قبوض', proj: 'پروژه', exp: 'جاری', pay: 'دریافتی', ci: 'پیمانکار' }
  const docs = (d.recentDocs || []).map(r => `<tr class="clickable" data-voucher="${r.dtype}:${r.id}">
      <td class="num">${escFa(r.no)}</td><td><span class="catpill">${K[r.kind] || ''}</span></td><td>${esc(r.title)}</td><td class="num">${money(r.debit)}</td></tr>`).join('')
  const ciRows = (d.ciOpen || []).map(c => `<tr class="clickable" data-voucher="contractor:${c.id}"><td>${esc(c.title || '—')}<br><span class="hint">${esc(c.vendor || '')}</span></td><td class="num amt-out">${money(c.rem)}</td></tr>`).join('')

  $('#view').innerHTML = head('داشبورد', `${META.buildingName || ''} · ${d.monthFa} · ${d.unitCount} واحد فعال`,
    adminOnly(`<button class="btn primary" id="qInvoice">＋ فاکتور</button><button class="btn" id="qPayment">＋ دریافتی</button>`)) + rcBanner + alertsHtml +
    `<div class="dsec">نقدینگی صندوق‌ها</div>
    <div class="kpis dfunds">
      <div class="kpi"><div class="lbl">موجودی کل صندوق‌ها</div><div class="val num">${bal(d.fundTotal)}<span class="r"> ${curFa()}</span></div>
        <div class="d">بدهی ساکنین به صندوق‌ها: <b class="num">${money(totalFundDebt)}</b></div></div>
      ${fundCards}
    </div>
    <div class="dsec">وضعیت ساکنین</div>
    <div class="kpis">
      ${kpi('کل بدهی ساکنین', money(d.totalDebt), '', 'bad')}
      ${chargeKpi}
      ${kpi('بدهیِ معوق (بیش از ۹۰ روز)', money(d.overdue ? d.overdue.total : 0), faDigit(d.overdue ? d.overdue.count : 0) + ' واحد', d.overdue && d.overdue.count ? 'bad' : '')}
      ${d.totalCredit > 0 ? kpi(TERMS.residentCredit, money(d.totalCredit), 'پرداختِ بیش از بدهی') : kpi('شکافِ وصولِ شارژ ماه', money(ch ? Math.max(0, ch.gap) : 0), 'تعهد منهای وصول', ch && ch.gap > 0 ? 'bad' : '')}
    </div>
    <div class="dsec">جریانِ ${escFa(d.monthFa)}</div>
    <div class="kpis">
      ${kpi('دریافتیِ ماه', money(d.monthIn), 'واردشده به صندوق‌ها')}
      ${kpi('هزینهٔ ماه', money(d.monthExpense ?? d.monthOut), 'پرداخت‌شده از صندوق‌ها')}
      ${kpi('خالصِ ماه', signed(d.monthIn - (d.monthExpense ?? d.monthOut)), 'دریافتی منهای هزینه')}
      ${kpi('شارژِ صادرشدهٔ ماه', money(d.monthCharge ?? 0), 'تعهد ساکنین')}
    </div>
    ${d.managerDebt > 0 ? `<div class="notice warn printhide">طلبِ مدیر از صندوق (پرداخت از جیب): <b class="num">${money(d.managerDebt)}</b> ${curFa()} — از صفحهٔ صندوق‌ها تسویه کنید.</div>` : ''}
    ${(d.interFund && d.interFund.length) ? `<div class="notice warn printhide">بدهی بین صندوق‌ها: ${d.interFund.map(x => `${escFa(x.fromName)} به ${escFa(x.toName)} ${money(x.amount)} ${curFa()}`).join('، ')} — از صفحهٔ صندوق‌ها تسویه کنید.</div>` : ''}
    <div class="grid2">
      <div>
        <div class="panel"><div class="phead"><b>بدهکاران اصلی</b><button class="link" data-go="reports:debtors">گزارش بدهکاران</button></div>
          <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>بدهی</th><th>قدمت</th></tr></thead><tbody>
          ${d.topDebtors.length ? d.topDebtors.map(u => `<tr class="clickable" data-unit="${u.id}"><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
            <td class="num amt-out">${money(u.debt)}</td><td class="hint">${u.aging ? (u.aging.days > 9000 ? 'انتقالی' : u.aging.bucket + ' روز') : '—'}</td></tr>`).join('')
          : emptyRow(4, 'هیچ بدهکاری وجود ندارد')}
          </tbody></table></div></div>
        <div class="panel"><div class="phead"><b>پیمانکار — پرداخت‌نشده</b><span class="hint">${d.unpaidCI && d.unpaidCI.count ? 'جمع ' + money(d.unpaidCI.total) : ''}</span></div>
          <div class="tablewrap"><table class="tx"><tbody>${ciRows || emptyRow(2, 'فاکتور پیمانکارِ پرداخت‌نشده‌ای نیست')}</tbody></table></div></div>
      </div>
      <div>
        <div class="panel"><div class="phead"><b>آخرین گردش صندوق‌ها</b><button class="link" data-go="funds">صندوق‌ها</button></div>
          <div class="tablewrap"><table class="tx"><tbody>${moves || emptyRow(3, 'گردشی ثبت نشده')}</tbody></table></div></div>
        <div class="panel"><div class="phead"><b>آخرین اسنادِ دفتر روزنامه</b><button class="link" id="dJournal">دفتر روزنامه</button></div>
          <div class="tablewrap"><table class="tx"><thead><tr><th>سند</th><th>نوع</th><th>شرح</th><th>مبلغ</th></tr></thead><tbody>${docs || emptyRow(4, 'سندی نیست')}</tbody></table></div></div>
      </div>
    </div>
    ${(d.projectSummaries && d.projectSummaries.length) ? `<div class="panel"><div class="phead"><b>پروژه‌های عمرانی</b><button class="link" data-go="projects">همهٔ پروژه‌ها</button></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>پروژه</th><th>برآورد مصوب</th><th>هزینهٔ واقعی</th><th>وصول از ساکنین</th><th>بدهی ساکنین</th><th>مازاد/کسری صندوق</th></tr></thead><tbody>
      ${d.projectSummaries.map(s => `<tr class="clickable" data-proj="${s.id}"><td><b>${esc(s.title)}</b> <span class="hint">${esc(s.statusFa)}</span></td>
        <td class="num">${money(s.budget)}</td><td class="num">${money(s.netCost)}</td><td class="num">${money(s.collected)}</td>
        <td class="num ${s.debt > 0 ? 'amt-out' : ''}">${money(s.debt)}</td>
        <td class="num">${s.fundBalance >= 0 ? `مازاد ${money(s.fundBalance)}` : `<span class="amt-out">کسری ${money(-s.fundBalance)}</span>`}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`
  wireCommon()
  document.querySelectorAll('[data-proj]').forEach(c => c.onclick = () => showProject(+c.dataset.proj))
  document.querySelectorAll('[data-fundcard]').forEach(c => c.onclick = () => { VIEW = 'funds'; $('#nav').querySelectorAll('.nav-i').forEach(x => x.classList.toggle('on', x.dataset.view === 'funds')); showFund(+c.dataset.fundcard) })
  document.querySelectorAll('#view [data-voucher]').forEach(tr => tr.onclick = () => { const [dt, vid] = tr.dataset.voucher.split(':'); showVoucher(dt, +vid) })
  if ($('#dJournal')) $('#dJournal').onclick = () => { VIEW = 'reports'; repTab = 'journal'; $('#nav').querySelectorAll('.nav-i').forEach(x => x.classList.toggle('on', x.dataset.view === 'reports')); render() }
  if ($('#dPayExp')) $('#dPayExp').onclick = () => payExpensePicker()
  if ($('#issueAll')) $('#issueAll').onclick = guard(() => chargeIssueFlow(missing.map(m => m.period)))
  if ($('#qInvoice')) $('#qInvoice').onclick = () => invoiceForm()
  if ($('#qPayment')) $('#qPayment').onclick = () => paymentForm()
  if ($('#getRc')) $('#getRc').onclick = guard(async () => {
    const r = await post('/api/auth/recovery/regenerate', {})
    NEEDS_RC = false
    showRecoveryCode(r.code, { isNew: false, onDone: () => refresh() })
  })
}

function wireCommon() {
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const [v, tab] = b.dataset.go.split(':')
    if (tab && v === 'reports') repTab = tab
    if (tab && v === 'settings') setTab = tab
    VIEW = v; NAV_STACK = []
    render()
  })
  document.querySelectorAll('[data-unit]').forEach(r => r.onclick = () => showUnitCard(+r.dataset.unit))
  document.querySelectorAll('[data-inv]').forEach(r => r.onclick = () => showInvoice(+r.dataset.inv))
}

// ==================== فاکتورها ====================
let invFilter = { status: '', category_id: '', q: '' }
VIEWS.invoices = async () => {
  const rows = await api('/api/invoices?' + new URLSearchParams(Object.fromEntries(Object.entries(invFilter).filter(([k, v]) => v && k !== 'q'))))
  const invQ = i => normFa([i.id, faDigit(i.id), i.title, i.vendor, i.categoryName, i.note].join(' '))
  const sumOf = list => list.reduce((a, i) => ({ amount: a.amount + i.amount, collected: a.collected + (i.payable ? i.fundPaid : i.collected), remaining: a.remaining + (i.payable ? i.fundUnpaid : i.remaining) }), { amount: 0, collected: 0, remaining: 0 })
  const qn = normFa(invFilter.q), shown = qn ? rows.filter(i => invQ(i).includes(qn)) : rows
  const totals = sumOf(shown)
  $('#view').innerHTML = head('فاکتورها و هزینه‌ها', 'هر فاکتور بین واحدهای مشمول تقسیم می‌شود',
    adminOnly(`<button class="btn" id="batchInv">🧾 ثبت گروهی (صندوق‌دار)</button><button class="btn primary" id="newInv">＋ ثبت فاکتور</button>`) + `<a class="btn" href="/api/export/invoices">⬇️ اکسل</a>`) +
    `<div class="filters printhide">
      <input class="inp" id="fq" placeholder="جستجو در عنوان، فروشنده یا شماره سند…" value="${esc(invFilter.q)}">
      <select class="inp" id="fcat"><option value="">همه‌ی دسته‌ها</option>${META.categories.map(c => `<option value="${c.id}" ${invFilter.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="chips">${[['', 'همه'], ['open', 'باز'], ['settled', 'تسویه']].map(([v, t]) => `<button class="chip ${invFilter.status === v ? 'on' : ''}" data-st="${v}">${t}</button>`).join('')}</div>
    </div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>شماره سند</th><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>تقسیم</th><th>مبلغ</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th>${adminOnly('<th></th>')}</tr></thead>
      <tbody id="invBody">${rows.length ? rows.map(i => `<tr class="clickable" data-inv="${i.id}" data-q="${esc(invQ(i))}" ${qn && !invQ(i).includes(qn) ? 'hidden' : ''}>
        <td class="num"><b>${faDigit(i.seqNo || i.id)}</b></td>
        <td><b>${esc(i.title)}</b>${i.is_charge ? ' <span class="badge b-charge">شارژ</span>' : ''}${i.from_fund ? ' <span class="badge b-charge">جاری — از صندوق</span>' : ''}${i.paid_by_manager ? ' <span class="badge b-mgr">جیب مدیر</span>' : ''}${(i.payable && i.fundUnpaid > 0) ? ' <span class="badge b-open">از صندوق پرداخت‌نشده</span>' : (i.payable && i.fundPaid > 0 ? ' <span class="badge b-settled">از صندوق پرداخت‌شده</span>' : '')}${i.vendor ? `<br><span class="dim" style="font-size:11px;color:var(--faint)">${esc(i.vendor)}</span>` : ''}</td>
        <td><span class="catpill">${esc(i.categoryName)}</span></td>
        <td class="num">${faDigit(i.j_date)}</td>
        <td>${i.from_fund ? '<span class="dim">—</span>' : `<span class="catpill">${esc(i.methodFa)}</span>`}</td>
        <td class="num">${money(i.amount)}</td>
        <td class="num amt-in">${money(i.payable ? i.fundPaid : i.collected)}</td>
        <td class="num ${(i.payable ? i.fundUnpaid : i.remaining) > 0 ? 'amt-out' : ''}">${money(i.payable ? i.fundUnpaid : i.remaining)}</td>
        <td>${statusBadge(i.status)}</td>
        ${adminOnly(`<td class="rowact"><button class="btn tiny" data-editinv="${i.id}" title="ویرایش">✏️</button> <button class="del" data-delinv="${i.id}" title="حذف">🗑</button></td>`)}</tr>`).join('')
      : emptyRow(isAdmin() ? 10 : 9, 'هنوز فاکتوری ثبت نشده است')}</tbody>
      ${rows.length ? `<tfoot id="invFoot"></tfoot>` : ''}
    </table></div></div>`
  const drawFoot = (list, t) => { if ($('#invFoot')) $('#invFoot').innerHTML = `<tr><td colspan="4">جمع (${faDigit(list.length)} فاکتور${list.length !== rows.length ? ' از ' + faDigit(rows.length) : ''})</td><td></td><td class="num">${money(t.amount)}</td>
        <td class="num">${money(t.collected)}</td><td class="num">${money(t.remaining)}</td><td colspan="${isAdmin() ? 2 : 1}"></td></tr>` }
  drawFoot(shown, totals)
  wireCommon()
  $('#fq').oninput = () => {
    invFilter.q = $('#fq').value.trim(); const q = normFa(invFilter.q)
    $('#invBody').querySelectorAll('tr[data-q]').forEach(tr => { tr.hidden = !!q && !tr.dataset.q.includes(q) })
    const list = q ? rows.filter(i => invQ(i).includes(q)) : rows; drawFoot(list, sumOf(list))
  }
  $('#fcat').onchange = () => { invFilter.category_id = $('#fcat').value; render() }
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { invFilter.status = b.dataset.st; render() })
  document.querySelectorAll('[data-editinv]').forEach(b => b.onclick = e => {
    e.stopPropagation()
    const inv = rows.find(r => r.id == b.dataset.editinv)
    if (inv) invoiceForm(inv)
  })
  document.querySelectorAll('[data-delinv]').forEach(b => b.onclick = e => {
    e.stopPropagation()
    confirmReason('این فاکتور و همه‌ی سهم‌هایش حذف شود؟ پرداخت‌های تخصیص‌یافته آزاد و به بدهی‌های دیگر منتقل می‌شوند.',
      async r => { await api(`/api/invoices/${b.dataset.delinv}?reason=${encodeURIComponent(r)}`, { method: 'DELETE' }); toast('فاکتور حذف شد'); refresh() })
  })
  if ($('#newInv')) $('#newInv').onclick = () => invoiceForm()
  if ($('#batchInv')) $('#batchInv').onclick = () => batchExpenseForm()
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

// ---------- فرم فاکتور ----------
function invoiceForm(inv) {
  const store = { doc: null, custom: {} }
  const cats = META.categories, funds = META.funds
  const c0 = inv ? catById(inv.category_id) : (cats.find(c => !c.is_charge_cat) || cats[0])
  const j = inv ? { jy: +inv.j_date.slice(0, 4), jm: +inv.j_date.slice(5, 7), jd: +inv.j_date.slice(8, 10) } : null
  const initMode = inv ? (inv.from_fund ? 'charge' : (/عمران/.test(inv.fundName || '') ? 'omrani' : 'bills')) : 'charge'
  const body = openModal(inv ? 'ویرایش فاکتور' : 'ثبت فاکتور جدید', `
    <div class="form">
      <label class="f">عنوان فاکتور<input class="inp" id="ivTitle" placeholder="مثلاً: تعمیر مشعل موتورخانه" value="${esc(inv ? inv.title : '')}"></label>
      <div class="f"><span>این هزینه چیست؟</span><div class="ivtypes">
        <button type="button" class="ivt" data-ivt="charge"><b>خرجِ جاری</b><small>از صندوق شارژ؛ بین واحدها تقسیم نمی‌شود</small></button>
        <button type="button" class="ivt" data-ivt="bills"><b>قبض / هزینهٔ تقسیمی</b><small>بین واحدها تقسیم می‌شود (صندوق قبوض)</small></button>
        <button type="button" class="ivt" data-ivt="omrani"><b>عمرانی</b><small>بین واحدها تقسیم می‌شود (صندوق عمرانی)</small></button>
      </div><span class="hint" id="ivFundLbl"></span></div>
      <label class="f" hidden>نحوهٔ تأمین هزینه<select class="inp" id="ivFromFund">
        <option value="charge" ${initMode === 'charge' ? 'selected' : ''}>از محل شارژ (صندوق شارژ) — بدون تقسیم بین واحدها</option>
        <option value="bills" ${initMode === 'bills' ? 'selected' : ''}>قبوض و متفرقه — تقسیم بین واحدها (صندوق قبوض)</option>
        <option value="omrani" ${initMode === 'omrani' ? 'selected' : ''}>عمرانی — تقسیم بین واحدها (صندوق عمرانی)</option>
      </select></label>
      <div class="frow">
        <label class="f">دسته‌ی هزینه<select class="inp" id="ivCat">${cats.map(c => `<option value="${c.id}" ${c0 && c0.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="f">مبلغ کل (${curFa()})<input class="inp num" id="ivAmount" data-money="ivAmountHint" inputmode="numeric" value="${inv ? sep(Math.round(r2d(inv.amount))) : ''}"><span class="hint" id="ivAmountHint"></span></label>
      </div>
      <div class="frow">
        <label class="f" id="ivMethodWrap">روش تقسیم بین واحدها<select class="inp" id="ivMethod">${META.methods.map(m => `<option value="${m.value}" ${(inv ? inv.method : c0 && c0.default_method) === m.value ? 'selected' : ''}>${esc(m.fa)}</option>`).join('')}</select></label>
        <label class="f">تاریخ${dateBoxHtml('iv', j)}</label>
      </div>
      <div class="f"><span>پرداخت شد؟</span><div class="seg" id="ivPayQ">
        <button type="button" class="t" data-pq="fund">بله، از صندوق</button>
        <button type="button" class="t" data-pq="mgr" id="ivPqMgr">از جیبِ خودم (مدیر)</button>
        <button type="button" class="t" data-pq="later">هنوز نه</button></div></div>
      <details class="ivmore"><summary>تنظیمات بیشتر (صندوق، نوع هزینه، واحدهای خالی)</summary>
      <div class="frow">
        <label class="f">صندوق پرداخت‌کننده<select class="inp" id="ivFund">${funds.map(f => `<option value="${f.id}" ${(inv ? inv.fund_id : c0 && c0.default_fund_id) === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <label class="f">نوع هزینه<select class="inp" id="ivKind">${META.expenseKinds.map(k => `<option value="${k.value}" ${(inv ? inv.expense_kind : 'variable') === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select></label>
      </div>
      <label class="check" id="ivVacantWrap"><input type="checkbox" id="ivVacant" ${(inv ? inv.include_vacant : c0 && c0.include_vacant) ? 'checked' : ''}> واحدهای خالی هم سهم بدهند</label>
      </details>
      <label class="check" id="ivMgrWrap" hidden><input type="checkbox" id="ivMgr" ${inv && inv.paid_by_manager ? 'checked' : ''}> مدیر از جیب خودش پرداخت کرده (طلب مدیر)</label>
      <div class="frow">
        <label class="f">پیمانکار / فروشنده<input class="inp" id="ivVendor" value="${esc(inv ? inv.vendor : '')}"></label>
        <label class="f">توضیح<input class="inp" id="ivNote" value="${esc(inv ? inv.note : '')}"></label>
      </div>
      ${docPickerHtml('ivDoc')}
      <div class="notice info" id="ivFundNote" style="margin:0;display:none">این هزینه <b>از صندوق کسر</b> می‌شود و بین واحدها تقسیم نمی‌شود؛ چون ساکنین قبلاً بابتش «شارژ ماهانه» پرداخت کرده‌اند.</div>
      <label class="f" id="ivPaidNowWrap" style="display:none">${inv ? 'پرداخت‌شده از صندوق (قابل تنظیم)' : 'مبلغ پرداخت‌شده از صندوق'} (${curFa()})<input class="inp num" id="ivPaidNow" data-money="ivPaidNowHint" inputmode="numeric" value="${inv && inv.fundPaid ? sep(Math.round(r2d(inv.fundPaid))) : ''}"><span class="hint" id="ivPaidNowHint">کامل = تسویه · کمتر = بقیه بعداً پرداخت می‌شود</span></label>
      <div class="panel" id="ivSplitPanel" style="margin:0;background:var(--panel-2)">
        <div class="phead"><b>پیش‌نمایش تقسیم بین واحدها</b><span class="hint strong" id="ivSum"></span></div>
        <div class="tablewrap" id="ivPreview"><div class="empty">در حال محاسبه…</div></div>
      </div>
    </div>`,
    `<button class="btn primary" id="ivSave">${inv ? 'ذخیره‌ی تغییرات' : 'ثبت فاکتور'}</button><button class="btn" id="ivCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); wireDocPicker('ivDoc', store)
  $('#ivCancel').onclick = closeModal

  const fromFund = () => $('#ivFromFund').value === 'charge'
  const readForm = () => ({
    title: $('#ivTitle').value.trim(), categoryId: +$('#ivCat').value, amount: readMoney($('#ivAmount')),
    method: $('#ivMethod').value, includeVacant: $('#ivVacant').checked, fundId: +$('#ivFund').value,
    expenseKind: $('#ivKind').value, paidByManager: $('#ivMgr').checked, fromFund: fromFund(),
    paidNow: paidVisible() ? readMoney($('#ivPaidNow')) : undefined,
    vendor: $('#ivVendor').value.trim(), note: $('#ivNote').value.trim(),
    custom: store.custom, ...readDate('iv')
  })
  // صندوقِ پیش‌فرض بر اساس نحوهٔ تأمین: «از محل شارژ» → صندوق شارژ/جاری · «تقسیم بین واحدها» → صندوق عمرانی/تعمیرات
  const by = re => (funds.find(x => re.test(x.name)) || {}).id
  const pickFund = () => { const v = $('#ivFromFund').value
    const byB = b => (funds.find(f => f.bucket === b) || {}).id
    return v === 'charge' ? (byB('charge') || by(/شارژ|جاری/) || (funds[0] || {}).id)
      : v === 'omrani' ? (byB('project') || by(/عمران|تعمیر/) || (funds[1] || funds[0] || {}).id)
      : (byB('omrani') || by(/قبوض|متفرقه/) || (funds[1] || funds[0] || {}).id) }
  const applyDefaultFund = () => { const id = pickFund(); if (id && $('#ivFund')) $('#ivFund').value = id }
  store.paidNowEdited = !!inv // در ویرایش، مقدارِ فعلیِ پرداختِ صندوق حفظ شود و با تغییرِ مبلغ بازنویسی نشود
  const paidVisible = () => { if (inv && !inv.payable) return false; const mgr = !fromFund() && $('#ivMgr') && $('#ivMgr').checked; return !!$('#ivPaidNowWrap') && !mgr }
  const mirrorPaid = () => { if (paidVisible() && !store.paidNowEdited && store.pq !== 'later') $('#ivPaidNow').value = $('#ivAmount').value }
  // پرسشِ «پرداخت شد؟»: fund = از صندوق (پیش‌فرض کامل) · mgr = جیب مدیر · later = هنوز نه
  store.pq = inv ? (inv.paid_by_manager ? 'mgr' : (inv.fundPaid > 0 || !inv.payable ? 'fund' : 'later')) : 'fund'
  const syncPay = () => {
    const ff = fromFund(); if (ff && store.pq === 'mgr') store.pq = 'fund'
    if ($('#ivPqMgr')) $('#ivPqMgr').hidden = ff
    $('#ivMgr').checked = store.pq === 'mgr'
    document.querySelectorAll('[data-pq]').forEach(b => b.classList.toggle('on', b.dataset.pq === store.pq))
    const pw = $('#ivPaidNowWrap'); if (pw) pw.style.display = paidVisible() && store.pq === 'fund' ? '' : 'none'
    if (store.pq === 'later' && $('#ivPaidNow')) { $('#ivPaidNow').value = ''; store.paidNowEdited = true }
    const f = META.funds.find(x => x.id === +$('#ivFund').value)
    if ($('#ivFundLbl')) $('#ivFundLbl').textContent = f ? 'صندوق: ' + f.name + (store.pq === 'mgr' ? ' — بعداً با «تسویه با مدیر» از صندوق پس داده می‌شود' : '') : ''
    document.querySelectorAll('[data-ivt]').forEach(b => b.classList.toggle('on', b.dataset.ivt === $('#ivFromFund').value))
  }
  document.querySelectorAll('[data-pq]').forEach(b => b.onclick = () => {
    store.pq = b.dataset.pq
    if (store.pq === 'fund' && $('#ivPaidNow')) { store.paidNowEdited = !!inv && inv.fundPaid > 0; if (!store.paidNowEdited) $('#ivPaidNow').value = $('#ivAmount').value }
    syncMode()
  })
  document.querySelectorAll('[data-ivt]').forEach(b => b.onclick = () => { $('#ivFromFund').value = b.dataset.ivt; $('#ivFromFund').onchange() })
  $('#ivFund').addEventListener('change', () => syncPay())
  const syncMode = () => {
    const ff = fromFund()
    for (const id of ['ivMethodWrap', 'ivVacantWrap', 'ivMgrWrap', 'ivSplitPanel']) { const el = $('#' + id); if (el) el.style.display = ff ? 'none' : '' }
    const note = $('#ivFundNote'); if (note) note.style.display = ff ? '' : 'none'
    mirrorPaid(); syncPay()
  }
  if ($('#ivPaidNow')) $('#ivPaidNow').addEventListener('input', () => { store.paidNowEdited = true })
  if ($('#ivMgr')) $('#ivMgr').addEventListener('change', syncMode)
  $('#ivFromFund').onchange = () => { applyDefaultFund(); syncMode(); if (!fromFund()) preview() }
  // انتخاب دسته ⇒ روش و صندوق و شمول واحد خالیِ پیش‌فرضِ همان دسته
  $('#ivCat').onchange = () => {
    const c = catById(+$('#ivCat').value); if (!c) return
    $('#ivMethod').value = c.default_method
    applyDefaultFund() // صندوق بر اساس نحوهٔ تأمین تعیین می‌شود، نه دسته
    $('#ivVacant').checked = !!c.include_vacant
    if (!fromFund()) preview()
  }
  const preview = debounce(guard(async () => {
    const f = readForm()
    const r = await post('/api/invoices/preview', { amount: f.amount, method: f.method, includeVacant: f.includeVacant, custom: f.custom })
    const isCustom = f.method === 'custom'
    const isOC = f.method === 'occ_common'
    $('#ivSum').textContent = `${faDigit(r.rows.length)} واحد · جمع سهم‌ها: ${moneyU(r.total)}`
    $('#ivPreview').innerHTML = r.rows.length ? `${isOC ? '<div class="hint" style="margin:0 0 6px">هر واحد = نفرات + <b>۱ سهم مشاعات</b>؛ واحد خالی فقط مشاعات را می‌دهد.</div>' : ''}<table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>نفرات</th>${isOC ? '<th>مشاعات</th><th>وزن</th>' : '<th>متراژ</th>'}<th>سهم (${curFa()})</th></tr></thead><tbody>
      ${r.rows.map(x => { const oc = x.occupied ? (+x.occupants || 0) : 0, cm = +x.common_units || 0, w = oc + cm; return `<tr><td><b>${escFa(x.number)}</b>${x.occupied ? '' : ' <span class="badge b-vacant">خالی</span>'}</td><td>${esc(x.resident || '—')}</td>
        <td class="num">${faDigit(oc)}</td>${isOC ? `<td class="num">${faDigit(cm)}</td><td class="num"><b>${faDigit(w)}</b></td>` : `<td class="num">${faDigit(x.area || 0)}</td>`}
        <td class="num">${isCustom ? `<input class="inp num" style="width:130px;padding:6px 8px" data-cu="${x.unit_id}" value="${sep(Math.round(r2d(x.share_amount)))}" inputmode="numeric">` : money(x.share_amount)}</td></tr>` }).join('')}
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
  ;['#ivAmount', '#ivMethod', '#ivVacant'].forEach(s => { $(s).addEventListener('input', () => { mirrorPaid(); if (!fromFund()) preview() }); $(s).addEventListener('change', () => { if (!fromFund()) preview() }) })
  $('#ivMethod').onchange = () => { store.custom = {}; if (!fromFund()) preview() }
  if (!inv) applyDefaultFund()
  syncMode(); if (!fromFund()) preview()

  $('#ivSave').onclick = guard(async () => {
    const f = readForm(); f.doc = store.doc
    if (!f.title) throw new Error('عنوان فاکتور را وارد کنید')
    const r = inv ? await api(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      : await post('/api/invoices', f)
    closeModal()
    const paidPart = r.fundPaidNow > 0 ? ` · ${moneyU(r.fundPaidNow)} از صندوق پرداخت شد` : ''
    toast(r.fromFund ? `هزینهٔ جاری ${moneyU(r.amount)} ثبت شد${paidPart}` : `فاکتور ${moneyU(r.amount)} بین ${faDigit(r.shareCount)} واحد تقسیم شد${paidPart}`)
    refresh()
  })
}

// ---------- فرم صندوق‌دار: ثبت گروهی هزینه‌های ماهانه ----------
function batchExpenseForm() {
  const cats = (META.categories || []).filter(c => !c.is_charge_cat)
  if (!cats.length) { toast('اول یک دستهٔ هزینه بسازید', true); return }
  const docs = {}; let rid = 0
  const newRow = () => { const i = ++rid; return `<tr data-ber="${i}">
    <td><input class="inp" id="beT${i}" placeholder="مثلاً نظافت آبان"></td>
    <td><select class="inp" id="beC${i}">${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></td>
    <td><input class="inp num beA" data-money="" inputmode="numeric" id="beA${i}" style="max-width:130px"></td>
    <td><input class="inp num" id="beN${i}" placeholder="سند" style="max-width:80px"></td>
    <td class="rowact"><button type="button" class="btn tiny" data-bedoc="${i}" title="پیوست سند">📎</button><button type="button" class="btn tiny" data-bedel="${i}">🗑</button></td></tr>` }
  openModal('🧾 ثبت گروهی هزینه‌ها (صندوق‌دار)', `<div class="form">
    <label class="f">تاریخ تحویل / ماه${dateBoxHtml('beDate')}</label>
    <div class="tablewrap"><table class="tx"><thead><tr><th>عنوان هزینه</th><th>دسته</th><th>مبلغ (${curFa()})</th><th>شماره سند</th><th></th></tr></thead><tbody id="beRows">${newRow()}${newRow()}${newRow()}</tbody></table></div>
    <div style="padding:8px 0"><button type="button" class="btn small" id="beAdd">＋ ردیف</button><span class="hint strong" id="beSum" style="margin-inline-start:10px"></span></div>
    <p class="hint">هر ردیف یک فاکتور هزینه می‌شود و بر اساس روشِ پیش‌فرضِ دسته بین واحدها تقسیم می‌شود. شمارهٔ سند را روی سند فیزیکی هم بنویسید. 📎 برای پیوست عکس/اسکن سند.</p>
  </div>`, `<button class="btn primary" id="beSave">ثبت همه</button><button class="btn" id="beCancel">انصراف</button>`)
  wireToday($('#modalBody')); wireMoney($('#modalBody'))
  const updateSum = () => { let s = 0; document.querySelectorAll('#beRows tr').forEach(tr => { const a = tr.querySelector('.beA'); if (a) s += readMoney(a) }); $('#beSum').textContent = s ? 'جمع: ' + moneyU(s) : '' }
  const wireRows = () => {
    document.querySelectorAll('[data-bedel]').forEach(b => b.onclick = () => { if (document.querySelectorAll('#beRows tr').length > 1) { const tr = document.querySelector(`tr[data-ber="${b.dataset.bedel}"]`); delete docs[b.dataset.bedel]; tr.remove(); updateSum() } })
    document.querySelectorAll('[data-bedoc]').forEach(b => b.onclick = () => { const i = b.dataset.bedoc; const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.onchange = guard(async () => { const f = inp.files[0]; if (!f) return; const c = await maybeCompress(f); docs[i] = { name: c.name, dataUrl: await readFileDataUrl(c) }; b.textContent = '✅' }); inp.click() })
    document.querySelectorAll('.beA').forEach(a => { if (!a.dataset.sum) { a.dataset.sum = '1'; a.addEventListener('input', updateSum) } })
  }
  $('#beCancel').onclick = closeModal
  $('#beAdd').onclick = () => { $('#beRows').insertAdjacentHTML('beforeend', newRow()); wireMoney($('#modalBody')); wireRows() }
  wireRows()
  $('#beSave').onclick = guard(async () => {
    const dt = readDate('beDate'); const rows = []
    document.querySelectorAll('#beRows tr').forEach(tr => {
      const i = tr.dataset.ber, title = $('#beT' + i).value.trim(), amount = readMoney($('#beA' + i))
      if (title && amount > 0) rows.push({ title, categoryId: +$('#beC' + i).value, amount, docNo: $('#beN' + i).value.trim(), jy: dt.jy, jm: dt.jm, jd: dt.jd, doc: docs[i] || null })
    })
    if (!rows.length) throw new Error('حداقل یک ردیف با عنوان و مبلغ وارد کنید')
    const r = await post('/api/invoices/batch', { rows })
    closeModal(); toast(`${faDigit(r.count)} هزینه ثبت شد${r.fail ? ` (${faDigit(r.fail)} ناموفق)` : ''}`); refresh()
  })
}

// ---------- جزئیات فاکتور ----------
const showInvoice = guard(async id => {
  const d = await api(`/api/invoice/${id}`)
  const i = d.invoice
  openModal(i.title, `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
      ${kpi('مبلغ کل', money(i.amount))}${i.from_fund
        ? kpi('پرداخت‌شده از صندوق', money(i.fundPaid)) + kpi('بدهی صندوق به فاکتور', money(i.fundUnpaid), '', i.fundUnpaid > 0 ? 'bad' : '')
        : kpi('وصول‌شده', money(i.collected)) + kpi('مانده', money(i.remaining), '', i.remaining > 0 ? 'bad' : '')}
    </div>
    ${i.from_fund ? `<div class="notice info" style="margin:0 0 12px">هزینهٔ جاری: از صندوق «${esc(i.fundName)}» پرداخت می‌شود و بین واحدها تقسیم نمی‌شود (از محل شارژِ ماهانه).</div>` : ''}
    <div class="pline"><span>شمارهٔ سند (سیستمی)</span><b class="num">${faDigit(i.id)}</b></div>
    <div class="pline"><span>دسته</span><b>${esc(i.categoryName)}</b></div>
    <div class="pline"><span>تاریخ</span><b class="num">${faDigit(i.j_date)}</b></div>
    ${i.from_fund ? '' : `<div class="pline"><span>روش تقسیم</span><b>${esc(i.methodFa)}</b></div>`}
    <div class="pline"><span>نوع هزینه</span><b>${esc(i.kindFa)}</b></div>
    <div class="pline"><span>صندوق</span><b>${esc(i.fundName)}</b></div>
    ${i.from_fund ? '' : `<div class="pline"><span>واحد خالی سهم دارد؟</span><b>${i.include_vacant ? 'بله' : 'خیر'}</b></div>`}
    ${i.from_fund ? '' : `<div class="pline"><span>پرداخت از جیب مدیر</span><b>${i.paid_by_manager ? 'بله' : 'خیر'}</b></div>`}
    ${i.vendor ? `<div class="pline"><span>پیمانکار</span><b>${esc(i.vendor)}</b></div>` : ''}
    ${i.note ? `<div class="pline"><span>توضیح</span><b>${esc(i.note)}</b></div>` : ''}
    ${i.doc_no ? `<div class="pline"><span>شماره سند</span><b class="num">${escFa(i.doc_no)}</b></div>` : ''}
    ${i.doc_file ? `<div class="pline"><span>سند</span><a class="doclink" href="/uploads/${encodeURI(i.doc_file)}" target="_blank">مشاهده‌ی سند 📎</a></div>` : ''}
    ${i.from_fund ? '' : `<h4 style="margin:16px 0 8px">ریز سهم واحدها${i.method === 'occ_common' ? ' — تفکیک نفرات و مشاعات' : ''}
      ${i.method === 'occ_common' ? `<a class="btn tiny" id="invBreakdownPdf" style="float:left">${IS_DESKTOP ? '📄 صورت‌ریز PDF' : '🖨 صورت‌ریز'}</a>` : ''}</h4>
    <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th>${i.method === 'occ_common' ? '<th>نفرات</th><th>مشاعات</th><th>سهم نفرات</th><th>سهم مشاعات</th>' : ''}<th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
      ${d.shares.map(s => { const oc = s.occupied ? (+s.occupants || 0) : 0, cm = +s.common_units || 0, w = oc + cm; const occShare = w > 0 ? Math.round(s.share_amount * oc / w) : 0; const comShare = s.share_amount - occShare; return `<tr><td><b>${escFa(s.number)}</b>${s.occupied ? '' : ' <span class="badge b-vacant">خالی</span>'}</td><td>${esc(s.resident_name || '—')}</td>
        ${i.method === 'occ_common' ? `<td class="num">${faDigit(oc)}</td><td class="num">${faDigit(cm)}</td><td class="num">${money(occShare)}</td><td class="num">${money(comShare)}</td>` : ''}
        <td class="num">${money(s.share_amount)}</td><td class="num amt-in">${money(s.paid)}</td>
        <td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${money(s.remaining)}</td></tr>` }).join('')}
      </tbody><tfoot><tr><td colspan="${i.method === 'occ_common' ? 6 : 2}">جمع</td><td class="num">${money(i.amount)}</td><td class="num">${money(i.collected)}</td><td class="num">${money(i.remaining)}</td></tr></tfoot></table></div>
    ${d.debtors.length ? `<h4 style="margin:16px 0 8px">بدهکاران این فاکتور (${faDigit(d.debtors.length)})</h4>
      <div class="tablewrap"><table class="tx"><tbody>${d.debtors.map(s => `<tr><td><b>واحد ${escFa(s.number)}</b> ${esc(s.resident_name || '')}</td><td class="num amt-out">${money(s.remaining)}</td></tr>`).join('')}</tbody></table></div>` : ''}`}
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
  if ($('#invBreakdownPdf')) $('#invBreakdownPdf').onclick = () => {
    const rel = '/print/invoice/' + i.id
    if (IS_DESKTOP && window.hesabdar.savePdf) { toast('در حال ساخت صورت‌ریز…'); window.hesabdar.savePdf(rel, `صورت‌ریز ${i.title}`).then(x => toast(x && x.ok ? 'PDF ذخیره شد' : 'ناموفق', !(x && x.ok))) }
    else window.open(rel, '_blank')
  }
  document.querySelectorAll('[data-delep]').forEach(b => b.onclick = () => confirmReason('این پرداخت از صندوق حذف شود؟ پول به صندوق برمی‌گردد.',
    async r => { await api(`/api/expense-payments/${b.dataset.delep}?reason=${encodeURIComponent(r)}`, { method: 'DELETE' }); toast('پرداخت حذف شد'); closeModal(); refresh(); showInvoice(i.id) }))
})
function payExpenseForm(inv, funds) {
  const responsible = (funds.find(f => f.id === inv.fund_id) || {}).name || '—'
  const body = openModal(`پرداخت هزینه: ${inv.title}`, `<div class="form">
    <div class="notice info" style="margin:0">مانده‌ی پرداخت‌نشده‌ی این هزینه: <b>${moneyU(inv.fundUnpaid)}</b></div>
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
    adminOnly(`<button class="btn primary" id="newPay">＋ ثبت دریافتی</button><button class="btn" id="bulkPay">👥 دریافت گروهی</button>`) + `<a class="btn" href="/api/export/payments">⬇️ CSV</a>`) +
    `<div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>شماره رسید</th><th>واحد</th><th>ساکن</th><th>تاریخ</th><th>مبلغ</th><th>صندوق</th><th>روش</th><th>تخصیص‌یافته</th><th>پیش‌پرداخت</th><th>سند</th><th>رسید</th>${adminOnly('<th></th>')}</tr></thead>
      <tbody>${rows.length ? rows.map(p => `<tr class="clickable" data-voucher="payment:${p.id}">
        <td class="num"><b>${faDigit(p.seqNo || p.id)}</b></td><td><b>${escFa(p.number)}</b></td><td>${esc(p.resident_name || '—')}</td><td class="num">${faDigit(p.j_date)}</td>
        <td class="num amt-in">${money(p.amount)}</td><td>${esc(p.fund_name || '—')}</td><td>${esc(p.method || '—')}</td>
        <td class="num">${money(p.allocated)}</td><td class="num ${p.leftover > 0 ? 'pos' : ''}">${money(p.leftover)}</td>
        <td>${p.doc_file ? `<a class="doclink" href="/uploads/${encodeURI(p.doc_file)}" target="_blank">📎</a>` : '—'}</td>
        <td class="rowact">${p.is_opening ? '' : rcptBtns(p.id)}</td>
        ${adminOnly(`<td class="actcell"><button class="mini-btn" data-editpay="${p.id}">ویرایش</button><button class="del" data-delpay="${p.id}">🗑</button></td>`)}</tr>`).join('')
      : emptyRow(isAdmin() ? 12 : 11, 'هنوز دریافتی ثبت نشده است')}</tbody>
      ${rows.length ? `<tfoot><tr><td colspan="4">جمع (${faDigit(rows.length)} فقره)</td><td class="num">${money(total)}</td><td colspan="${isAdmin() ? 7 : 6}"></td></tr></tfoot>` : ''}
    </table></div></div>`
  document.querySelectorAll('[data-delpay]').forEach(b => b.onclick = () =>
    confirmReason('این دریافتی حذف شود؟ تخصیص‌هایش آزاد می‌شود و بدهی واحد برمی‌گردد.',
      async r => { await api(`/api/payments/${b.dataset.delpay}?reason=${encodeURIComponent(r)}`, { method: 'DELETE' }); toast('دریافتی حذف شد'); refresh() }))
  document.querySelectorAll('[data-editpay]').forEach(b => b.onclick = () => {
    const p = rows.find(x => x.id === +b.dataset.editpay); if (p) paymentForm(null, p)
  })
  if ($('#newPay')) $('#newPay').onclick = () => paymentForm()
  if ($('#bulkPay')) $('#bulkPay').onclick = () => bulkPaymentForm()
}

// دریافت گروهی: یک مبلغ، تیکِ واحدهایی که دادن، بابت یک فاکتور مشخص یا بدهی کلی
function bulkPaymentForm() {
  const bpRow = (uid, num, resident, ref, prefill, checked) =>
    `<tr data-bp="${uid}">
      <td><input type="checkbox" class="bpChk" ${checked ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)"></td>
      <td><b>${escFa(num)}</b>${resident ? ` <span class="hint">${esc(resident)}</span>` : ''}</td>
      <td class="num ${ref > 0 ? 'amt-out' : ''}">${ref > 0 ? money(ref) : '—'}</td>
      <td><input class="inp num bpAmt" data-money="" inputmode="numeric" value="${prefill > 0 ? sep(Math.round(r2d(prefill))) : ''}"></td></tr>`
  const fundCat = fid => { const f = META.funds.find(x => x.id === fid) || {}; return f.bucket || (/شارژ|جاری/.test(f.name) ? 'charge' : /قبوض|متفرقه/.test(f.name) ? 'omrani' : 'project') }
  const catField = { charge: 'charge', omrani: 'omrani', project: 'projectDue' }
  let ledger = {} // unitId -> {charge, omrani, projectDue}
  const body = openModal('👥 دریافت گروهی', `<div class="form">
    <div class="frow">
      <label class="f">صندوق مقصد<select class="inp" id="bpFund">${META.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
      <label class="f">تاریخ${dateBoxHtml('bp')}</label>
    </div>
    <div class="frow">
      <label class="f">بابت<select class="inp" id="bpInvoice"><option value="0">بدهیِ همان صندوقِ مقصد (خودکار)</option></select></label>
      <label class="f">روش پرداخت<select class="inp" id="bpMethod"><option value="">—</option>${META.payMethods.map(m => `<option>${esc(m)}</option>`).join('')}</select></label>
    </div>
    <div class="frow" style="align-items:end">
      <label class="f">مبلغ پیش‌فرض هر واحد (${curFa()})<input class="inp num" id="bpDefault" data-money="bpDefHint" inputmode="numeric"><span class="hint" id="bpDefHint"></span></label>
      <button type="button" class="btn" id="bpApplyAll">اعمال به تیک‌خورده‌ها</button>
    </div>
    <div class="panel" style="margin:0;background:var(--panel-2)">
      <div class="phead"><label class="check" style="margin:0"><input type="checkbox" id="bpAll"> انتخاب همه</label><span class="hint strong" id="bpSum"></span></div>
      <div class="tablewrap" id="bpList"><div class="empty">در حال بارگذاری…</div></div>
    </div></div>`,
    `<button class="btn primary" id="bpSave">ثبت دریافتی‌ها</button><button class="btn" id="bpCancel">انصراف</button>`)
  wireToday(body); wireMoney(body)
  $('#bpCancel').onclick = closeModal

  const updateSum = () => {
    let n = 0, t = 0
    body.querySelectorAll('tr[data-bp]').forEach(tr => {
      if (tr.querySelector('.bpChk').checked) { const a = readMoney(tr.querySelector('.bpAmt')); if (a > 0) { n++; t += a } }
    })
    $('#bpSum').textContent = n ? `${faDigit(n)} واحد · جمع ${moneyU(t)}` : ''
  }
  const bindRows = () => {
    body.querySelectorAll('tr[data-bp]').forEach(tr => {
      const chk = tr.querySelector('.bpChk'), amt = tr.querySelector('.bpAmt')
      chk.onchange = () => { if (chk.checked && !readMoney(amt)) { const def = readMoney($('#bpDefault')); if (def > 0) { amt.value = sep(Math.round(r2d(def))) } } updateSum() }
      amt.addEventListener('input', updateSum)
    })
  }
  let allInvoices = []
  const catLabel = { charge: 'شارژ', omrani: 'قبوض و متفرقه', project: 'عمرانی' }
  // بدهیِ همان صندوقِ مقصد برای هر واحد (از گزارش تفکیکی)
  const bucketDebt = uid => {
    const L = ledger[uid]; if (!L) return 0
    const cat = fundCat(+$('#bpFund').value)
    return Math.max(0, L[catField[cat]] || 0)
  }
  const renderList = guard(async () => {
    const invId = +$('#bpInvoice').value
    let rowsHtml, col
    if (invId) {
      col = 'سهم مانده'
      const d = await api('/api/invoice/' + invId)
      const debtors = d.shares.filter(s => s.remaining > 0)
      rowsHtml = debtors.length ? debtors.map(s => bpRow(s.unit_id, s.number, s.resident_name, s.remaining, s.remaining, true)).join('')
        : `<tr><td colspan="4"><div class="empty">همه‌ی واحدهای این فاکتور تسویه‌اند</div></td></tr>`
    } else {
      const cat = fundCat(+$('#bpFund').value)
      col = `بدهی به صندوقِ ${catLabel[cat] || ''}`
      rowsHtml = META.units.filter(u => u.active).map(u => { const d = bucketDebt(u.id); return bpRow(u.id, u.number, u.resident_name, d, 0, false) }).join('')
    }
    $('#bpList').innerHTML = `<table class="tx"><thead><tr><th></th><th>واحد</th><th>${col}</th><th>مبلغ دریافتی</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
    wireMoney($('#bpList')); bindRows(); $('#bpAll').checked = false; updateSum()
  })

  // گزینه‌های «بابت» را بر اساس صندوقِ مقصد بساز؛ برای صندوق شارژ غیرفعال (فقط خودکار)
  const refreshBabat = () => {
    const fid = +$('#bpFund').value, cat = fundCat(fid), sel = $('#bpInvoice')
    const wrap = sel.closest('label.f')
    sel.innerHTML = `<option value="0">بدهیِ همان صندوقِ مقصد (خودکار، از قدیمی‌ترین)</option>`
    if (cat === 'charge') {
      // شارژ فقط از خود صندوق پرداخت می‌شود و بابتِ تک‌فاکتور معنا ندارد
      sel.value = '0'; sel.disabled = true
      if (wrap) wrap.style.opacity = '.5'
    } else {
      sel.disabled = false
      if (wrap) wrap.style.opacity = ''
      allInvoices.filter(i => i.fund_id === fid && i.remaining > 0 && i.shareCount > 0 && !i.from_fund).forEach(i => {
        const o = document.createElement('option'); o.value = i.id
        o.textContent = `${i.title} — ${faDigit(i.j_date)} (مانده ${money(i.remaining)})`; sel.appendChild(o)
      })
    }
  }
  ;(async () => {
    const [rep, invs] = await Promise.all([api('/api/report/unit-ledger'), api('/api/invoices')])
    ;(rep.units || rep.rows || rep || []).forEach(u => { ledger[u.unitId || u.id] = u })
    allInvoices = invs
    refreshBabat(); renderList()
  })()
  $('#bpFund').onchange = () => { refreshBabat(); renderList() }
  $('#bpInvoice').onchange = renderList
  $('#bpAll').onchange = () => { const on = $('#bpAll').checked; body.querySelectorAll('.bpChk').forEach(c => { c.checked = on; c.dispatchEvent(new Event('change')) }) }
  $('#bpApplyAll').onclick = () => {
    const def = readMoney($('#bpDefault')); if (!(def > 0)) return toast('اول مبلغ پیش‌فرض را وارد کنید', true)
    body.querySelectorAll('tr[data-bp]').forEach(tr => { if (tr.querySelector('.bpChk').checked) tr.querySelector('.bpAmt').value = sep(Math.round(r2d(def))) })
    updateSum()
  }
  renderList()
  $('#bpSave').onclick = guard(async () => {
    const items = []
    body.querySelectorAll('tr[data-bp]').forEach(tr => {
      if (tr.querySelector('.bpChk').checked) { const a = readMoney(tr.querySelector('.bpAmt')); if (a > 0) items.push({ unitId: +tr.dataset.bp, amount: a }) }
    })
    if (!items.length) throw new Error('هیچ واحدی با مبلغ معتبر انتخاب نشد')
    const r = await post('/api/payments/bulk', {
      fundId: +$('#bpFund').value, invoiceId: +$('#bpInvoice').value || null,
      method: $('#bpMethod').value, items, ...readDate('bp')
    })
    closeModal(); toast(`${faDigit(r.count)} دریافتی ثبت شد — جمع ${moneyU(r.total)}`); refresh()
  })
}

function paymentForm(presetUnit, pay, after, presetProject, creditMode) {
  const store = { doc: null }
  const forProject = +presetProject || 0
  const units = META.units.filter(u => u.active || (pay && u.id === pay.unit_id))
  const selUnit = pay ? pay.unit_id : presetUnit
  const payJ = pay ? { jy: +pay.j_date.slice(0, 4), jm: +pay.j_date.slice(5, 7), jd: +pay.j_date.slice(8, 10) } : null
  const body = openModal(pay ? 'ویرایش دریافتی' : creditMode ? 'استفاده از پیش‌پرداخت' : 'ثبت دریافتی', `
    <div class="form">
      <div class="frow">
        <label class="f">واحد<select class="inp" id="pyUnit">${units.map(u => `<option value="${u.id}" ${selUnit === u.id ? 'selected' : ''}>واحد ${escFa(u.number)}${u.resident_name ? ' — ' + esc(u.resident_name) : ''}</option>`).join('')}</select></label>
        <label class="f">مبلغ (${curFa()})<input class="inp num" id="pyAmount" data-money="pyHint" inputmode="numeric" value="${pay ? sep(Math.round(r2d(pay.amount))) : ''}"><span class="hint" id="pyHint"></span></label>
      </div>
      ${!pay && (creditMode || forProject) ? `<div class="frow"><label class="f" ${creditMode ? 'hidden' : ''}>منبع پرداخت<select class="inp" id="pySource">
        <option value="cash" ${creditMode ? '' : 'selected'}>واریز نقدی (به صندوق)</option>
        <option value="credit" ${creditMode ? 'selected' : ''}>استفاده از پیش‌پرداختِ واحد</option></select></label>
        <label class="f" id="pyCreditWrap" style="display:none">پیش‌پرداختِ موجودِ واحد<input class="inp" id="pyCreditAvail" disabled></label></div>` : ''}
      ${creditMode ? '<p class="hint" style="margin:0">پولی که این واحد قبلاً بیشتر از بدهی‌اش داده، روی بدهی‌های تیک‌خورده می‌نشیند. پولی وارد صندوق نمی‌شود.</p>' : ''}
      <div class="frow">
        <label class="f">تاریخ${dateBoxHtml('py', payJ)}</label>
        <label class="f" id="pyFundWrap">صندوق مقصد<select class="inp" id="pyFund">${META.funds.map(f => `<option value="${f.id}" ${pay && pay.fund_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      </div>
      <div class="frow" id="pyMethodRow">
        <label class="f">روش پرداخت<select class="inp" id="pyMethod"><option value="">—</option>${META.payMethods.map(m => `<option ${pay && pay.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="f">توضیح<input class="inp" id="pyNote" placeholder="مثلاً: بابت شارژ مرداد" value="${esc(pay ? pay.note : '')}"></label>
      </div>
      <div id="pyDocWrap">${docPickerHtml('pyDoc')}</div>
      <div class="panel" style="margin:0;background:var(--panel-2)">
        <div class="phead"><b>بدهی‌های باز این واحد</b><span class="hint strong" id="pyCredit"></span></div>
        <p class="hint" style="margin:0 0 8px">${pay ? 'اگر مبلغ، واحد یا صندوق را عوض کنید، مبلغ دوباره از قدیمی‌ترین بدهی کم می‌شود.' : 'اگر هیچ فاکتوری تیک نخورد، مبلغ اول از قدیمی‌ترین بدهی کم می‌شود.'}</p>
        <div id="pyOpen"><div class="empty">در حال بارگذاری…</div></div>
      </div>
    </div>`,
    `<button class="btn primary" id="pySave">${pay ? 'ذخیرهٔ تغییرات' : 'ثبت دریافتی'}</button><button class="btn" id="pyCancel">انصراف</button>`)
  wireToday(body); wireMoney(body); wireDocPicker('pyDoc', store)
  $('#pyCancel').onclick = closeModal
  const srcEl = () => $('#pySource'), isCredit = () => srcEl() && srcEl().value === 'credit'
  store.credit = 0
  const syncSource = () => {
    const c = isCredit()
    if ($('#pyFundWrap')) $('#pyFundWrap').style.display = c ? 'none' : ''
    if ($('#pyMethodRow')) $('#pyMethodRow').style.display = c ? 'none' : ''
    if ($('#pyDocWrap')) $('#pyDocWrap').style.display = c ? 'none' : ''
    if ($('#pyCreditWrap')) $('#pyCreditWrap').style.display = c ? '' : 'none'
    if ($('#pyCreditAvail')) $('#pyCreditAvail').value = moneyU(store.credit)
    $('#pySave').textContent = c ? 'کسر از پیش‌پرداخت' : 'ثبت دریافتی'
  }
  const loadOpen = guard(async () => {
    const d = await api(`/api/unit/${$('#pyUnit').value}/open`)
    store.credit = d.credit || 0
    $('#pyCredit').textContent = d.credit > 0 ? `پیش‌پرداختِ فعلیِ واحد: ${moneyU(d.credit)}` : ''
    if (forProject && !isCredit()) $('#pyOpen').innerHTML = '<div class="empty">این پرداخت بابت شارژِ پروژه ثبت می‌شود؛ اگر بیشتر از سهم نهایی باشد، به‌صورت پیش‌پرداختِ پروژه برای واحد می‌ماند.</div>'
    else $('#pyOpen').innerHTML = d.rows.length ? `<div class="tablewrap"><table class="tx"><thead><tr><th></th><th>فاکتور</th><th>تاریخ</th><th>مانده</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td>${pay ? '' : `<input type="checkbox" data-inv="${r.invoice_id}" style="width:16px;height:16px;accent-color:var(--accent)">`}</td>
        <td>${esc(r.title)}</td><td class="num">${r.is_opening ? 'انتقالی' : faDigit(r.j_date)}</td><td class="num amt-out">${money(r.remaining)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">این واحد بدهی بازی ندارد — مبلغ به‌عنوان پیش‌پرداخت ثبت می‌شود</div>'
    syncSource()
  })
  if (srcEl()) srcEl().onchange = () => { syncSource(); loadOpen() }
  $('#pyUnit').onchange = loadOpen; loadOpen()
  $('#pySave').onclick = guard(async () => {
    if (!pay && isCredit()) {
      if (!(store.credit > 0)) throw new Error('این واحد پیش‌پرداختی ندارد')
      const amt = readMoney($('#pyAmount'))
      const invoiceIds = [...$('#pyOpen').querySelectorAll('input[type=checkbox]:checked')].map(c => +c.dataset.inv)
      const payload = { unitId: +$('#pyUnit').value, ...readDate('py'), note: $('#pyNote').value.trim() }
      if (amt > 0) payload.amount = amt
      if (forProject) payload.projectId = forProject
      else if (invoiceIds.length) payload.invoiceIds = invoiceIds
      const r = await post('/api/pay-from-credit', payload)
      closeModal(); toast(`از پیش‌پرداخت کسر شد — ${moneyU(r.used)} تسویه${r.creditLeft > 0 ? ` · ${moneyU(r.creditLeft)} پیش‌پرداختِ باقی‌مانده` : ''}`)
      after ? after() : refresh(); return
    }
    const amount = readMoney($('#pyAmount')); if (!(amount > 0)) throw new Error('مبلغ را وارد کنید')
    const payload = {
      unitId: +$('#pyUnit').value, amount, fundId: +$('#pyFund').value,
      method: $('#pyMethod').value, note: $('#pyNote').value.trim(), doc: store.doc, ...readDate('py')
    }
    if (pay) {
      await post(`/api/payments/${pay.id}`, payload, 'PUT')
      closeModal(); toast('دریافتی ویرایش شد'); after ? after() : refresh(); return
    }
    if (forProject) payload.projectId = forProject
    const invoiceIds = [...$('#pyOpen').querySelectorAll('input[type=checkbox]:checked')].map(c => +c.dataset.inv)
    payload.invoiceIds = invoiceIds.length ? invoiceIds : null
    const r = await post('/api/payments', payload)
    closeModal()
    const msg = forProject ? (r.credit > 0 ? `پرداختِ پروژه ثبت شد — ${moneyU(r.allocated)} بابت سهم و ${moneyU(r.credit)} پیش‌پرداختِ پروژه` : `پرداختِ پروژه ثبت شد`)
      : (r.credit > 0 ? `ثبت شد — ${moneyU(r.allocated)} تسویه و ${moneyU(r.credit)} پیش‌پرداخت شد` : `دریافتی ثبت و ${moneyU(r.allocated)} تسویه شد`)
    after ? after() : refresh()
    receiptOffer(r.id, msg)
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
        <div class="pline big"><span>${u.debt >= 0 ? TERMS.debt : TERMS.credit}</span><b class="${u.debt > 0 ? 'neg' : u.debt < 0 ? 'pos' : ''}">${money(Math.abs(u.debt))}</b></div>
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
      <label class="f">نفرات مشاعات — برای تقسیم هزینه‌های مشاعات (خالی = همان نفرات ساکن)
        <input class="inp num" id="unCommon" inputmode="numeric" value="${u && u.common_units ? faDigit(u.common_units) : ''}" placeholder="مثلاً واحد ۱‌نفره برای مشاعات ۲"></label>
      <div class="frow">
        <label class="f">نام ساکن / مستاجر<input class="inp" id="unName" value="${esc(u ? u.resident_name : '')}"></label>
        <label class="f">نام مالک<input class="inp" id="unOwner" value="${esc(u ? (u.owner_name || '') : '')}"></label>
      </div>
      <label class="f">تلفن<input class="inp num" id="unPhone" inputmode="tel" value="${esc(u ? u.phone : '')}"></label>
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
      commonUnits: +enDigit($('#unCommon').value) || 0,
      residentName: $('#unName').value.trim(), ownerName: $('#unOwner').value.trim(), phone: $('#unPhone').value.trim(),
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
  if (!markDetail('unit', id)) scrollTo(0, 0)
  const u = d.unit
  // دفتر معین واحد: سهم‌ها (بدهکار) + پرداخت‌ها (بستانکار) به‌ترتیب تاریخ، با ماندهٔ دونده
  const moeinEntries = []
  d.shares.forEach(s => moeinEntries.push({ g: s.g_date || '', j: s.is_opening ? '—' : s.j_date, no: s.seqNo || s.invoice_id, title: s.title, cat: s.category || '—', isOpen: s.is_opening, inv: s.invoice_id, debit: s.share_amount, credit: 0, k: 0 }))
  d.payments.forEach(p => moeinEntries.push({ g: p.g_date || '', j: p.is_opening ? '—' : p.j_date, no: p.seqNo || p.id, pid: p.id, title: 'دریافتی' + (p.fund_name ? ' — ' + p.fund_name : '') + (p.note ? ' · ' + p.note : ''), cat: 'دریافتی', inv: 0, debit: 0, credit: p.amount, k: 1 }))
  moeinEntries.sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : a.k - b.k))
  let _bal = 0
  const moeinRows = moeinEntries.map(e => {
    _bal += e.debit - e.credit
    const balTxt = _bal > 0 ? money(_bal) : _bal < 0 ? '(' + money(-_bal) + ')' : '۰'
    const balCls = _bal > 0 ? 'amt-out' : _bal < 0 ? 'pos' : ''
    return `<tr class="${e.inv || e.pid ? 'clickable' : ''}" ${e.inv ? `data-inv="${e.inv}"` : e.pid ? `data-voucher="payment:${e.pid}"` : ''}>
      <td class="num">${e.j === '—' ? 'انتقالی' : faDigit(e.j)}</td>
      <td class="num">${e.k ? 'رسید ' : 'سند '}${faDigit(e.no)}</td>
      <td><b>${esc(e.title)}</b>${e.isOpen ? ' <span class="badge b-open">انتقالی</span>' : ''}</td>
      <td><span class="catpill">${esc(e.cat)}</span></td>
      <td class="num ${e.debit ? '' : 'muted'}">${e.debit ? money(e.debit) : '—'}</td>
      <td class="num ${e.credit ? '' : 'muted'}">${e.credit ? money(e.credit) : '—'}</td>
      <td class="num ${balCls}">${balTxt}</td>
      <td class="printhide rowact">${e.inv ? docActs('invoice', e.inv) : e.pid ? docActs('payment', e.pid) : ''}</td></tr>`
  }).join('')
  const mTotD = moeinEntries.reduce((a, e) => a + e.debit, 0), mTotC = moeinEntries.reduce((a, e) => a + e.credit, 0)
  const mFinal = mTotD - mTotC
  $('#view').innerHTML =
    `<button class="btn small back printhide" id="backBtn">→ بازگشت</button>` +
    head(`کارت واحد ${faDigit(u.number)}`, `${u.resident_name || 'بدون ساکن'} · ${faDigit(u.area || 0)} متر · ${faDigit(u.occupants || 0)} نفر${u.occupied ? '' : ' · خالی'}`,
      adminOnly(`<button class="btn" id="ucEdit">✏️ ویرایش واحد</button>${d.payments.some(p => p.leftover > 0) && d.shares.some(x => x.remaining > 0) ? '<button class="btn" id="ucCredit">استفاده از پیش‌پرداخت</button>' : ''}<button class="btn primary" id="ucPay">＋ ثبت دریافتی</button>`) +
      `<button class="btn" id="ucStmt">🖨 صورت‌حساب</button><button class="btn" id="ucPdf">📄 PDF</button><a class="btn" href="/api/export/unit?id=${u.id}">⬇️ CSV</a>`) +
    `<div class="kpis printhide">
      ${kpi(d.debt >= 0 ? 'بدهی کل' : TERMS.credit, money(Math.abs(d.debt)), '', d.debt > 0 ? 'bad' : d.debt < 0 ? 'good' : '')}
      ${kpi('جمع سهم‌ها', money(d.totalShares))}
      ${kpi('جمع پرداخت‌ها', money(d.totalPaid))}
      ${kpi('شارژ ماهانه', money(u.chargeAmount), u.monthly_charge != null ? 'اختصاصی این واحد' : 'مبلغ سراسری')}
    </div>
    ${u.phone ? `<div class="panel printhide" style="padding:12px 16px">📞 تلفن: <b class="num">${faDigit(u.phone)}</b></div>` : ''}
    <div class="panel printhide"><div class="phead"><b>سهم‌ها و بدهی‌ها</b>
      <span class="chips" style="margin:0"><button class="chip on" data-ucview="inv">نمای فاکتوری</button><button class="chip" data-ucview="moein">دفتر معین</button></span></div>
      <div id="ucInvView">
        <div class="hint" style="padding:2px 4px 6px">هر فاکتور: سهمِ این واحد، چقدر پرداخت شده و چقدر مانده${d.aging ? ' · قدمت قدیمی‌ترین بدهی: ' + d.aging.bucket + ' روز' : ''}</div>
        <div class="tablewrap"><table class="tx"><thead><tr><th>فاکتور</th><th>دسته</th><th>تاریخ</th><th>سهم</th><th>پرداخت‌شده</th><th>مانده</th><th class="printhide">عملیات</th></tr></thead><tbody>
        ${d.shares.length ? d.shares.map(s => `<tr class="clickable" data-inv="${s.invoice_id}">
          <td><b>${esc(s.title)}</b>${s.is_opening ? ' <span class="badge b-open">انتقالی</span>' : ''}</td>
          <td><span class="catpill">${esc(s.category || '—')}</span></td><td class="num">${s.is_opening ? '—' : faDigit(s.j_date)}</td>
          <td class="num">${money(s.share_amount)}</td><td class="num amt-in">${money(s.paid)}</td>
          <td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${money(s.remaining)}</td>
          <td class="printhide rowact">${docActs('invoice', s.invoice_id)}</td></tr>`).join('') : emptyRow(7, 'سهمی ثبت نشده')}
        </tbody><tfoot><tr><td colspan="3">جمع</td>
          <td class="num">${money(d.shares.reduce((a, s) => a + s.share_amount, 0))}</td>
          <td class="num amt-in">${money(d.shares.reduce((a, s) => a + s.paid, 0))}</td>
          <td class="num amt-out">${money(d.shares.reduce((a, s) => a + Math.max(0, s.remaining), 0))}</td><td class="printhide"></td></tr></tfoot></table></div>
      </div>
      <div id="ucMoeinView" class="hidden">
        <div class="hint" style="padding:2px 4px 6px">بدهکار (سهم/شارژ) · بستانکار (دریافتی) · ماندهٔ دونده؛ ماندهٔ بستانکار داخل پرانتز</div>
        <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>شماره سند</th><th>شرح</th><th>دسته</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th><th class="printhide">عملیات</th></tr></thead><tbody>
        ${moeinRows || emptyRow(8, 'تراکنشی ثبت نشده')}
        </tbody><tfoot><tr><td colspan="4">جمع</td>
          <td class="num">${money(mTotD)}</td>
          <td class="num">${money(mTotC)}</td>
          <td class="num ${mFinal > 0 ? 'amt-out' : mFinal < 0 ? 'amt-in' : ''}">${mFinal > 0 ? money(mFinal) : mFinal < 0 ? '(' + money(-mFinal) + ')' : '۰'}</td><td class="printhide"></td></tr></tfoot></table></div>
      </div></div>
    <div class="panel printhide"><div class="phead"><b>پرداخت‌ها</b></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>مبلغ</th><th>صندوق</th><th>روش</th><th>تخصیص‌یافته</th><th>پیش‌پرداخت</th><th>سند</th><th class="printhide">عملیات</th></tr></thead><tbody>
      ${d.payments.length ? d.payments.map(p => `<tr class="${p.is_opening ? '' : 'clickable'}" ${p.is_opening ? '' : `data-voucher="payment:${p.id}"`}><td class="num">${p.is_opening ? 'انتقالی' : faDigit(p.j_date)}</td><td class="num amt-in">${money(p.amount)}</td>
        <td>${esc(p.fund_name || '—')}</td><td>${esc(p.method || '—')}</td><td class="num">${money(p.allocated)}</td>
        <td class="num ${p.leftover > 0 ? 'pos' : ''}">${money(p.leftover)}</td>
        <td>${p.doc_file ? `<a class="doclink" href="/uploads/${encodeURI(p.doc_file)}" target="_blank">📎</a>` : '—'}</td>
        <td class="printhide rowact">${p.is_opening ? '' : rcptBtns(p.id) + docActs('payment', p.id)}</td></tr>`).join('') : emptyRow(8, 'پرداختی ثبت نشده')}
      </tbody></table></div></div>
    ${d.creditUses && d.creditUses.length ? `<div class="panel printhide"><div class="phead"><b>استفاده از پیش‌پرداخت</b><span class="hint">کسر از پیش‌پرداختِ واحد بابت بدهی‌های دیگر (بدون ورود نقدینگی)</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>مبلغ</th><th>بابت</th><th>توضیح</th></tr></thead><tbody>
      ${d.creditUses.map(c => `<tr><td class="num">${faDigit(c.j_date)}</td><td class="num amt-in">${money(c.amount)}</td><td>${esc(c.title || '—')}</td><td>${esc(c.note || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="panel printhide"><div class="phead"><b>پیگیری‌ها</b>${adminOnly('<button class="btn small" id="ucFu">＋ ثبت پیگیری</button>')}</div><div id="ucFuBox" class="hint">در حال بارگذاری…</div></div>
    <div class="printarea" id="stmtArea"></div>`
  wireCommon()
  $('#backBtn').onclick = () => goBack('units')
  if ($('#ucFu')) $('#ucFu').onclick = () => followupForm(u.id)
  api(`/api/units/${u.id}/followups`).then(fl => { const box = $('#ucFuBox'); if (!box) return
    box.outerHTML = fl.length ? `<div class="tablewrap" id="ucFuBox"><table class="tx"><thead><tr><th>تاریخ</th><th>روش</th><th>توضیح</th><th>قول پرداخت</th><th>بدهی در آن روز</th><th>ثبت‌کننده</th>${adminOnly('<th></th>')}</tr></thead><tbody>${fl.map(f => `<tr><td class="num">${faDigit(f.j_date)}</td><td>${esc(f.channelFa)}</td><td>${esc(f.note || '—')}</td><td>${f.promise_j ? faDigit(f.promise_j) + (f.promise_amount ? ' · ' + money(f.promise_amount) : '') : '—'}</td><td class="num">${money(f.debt_at)}</td><td>${esc(f.by_name || '—')}</td>${adminOnly(`<td><button class="del" data-fudel="${f.id}">🗑</button></td>`)}</tr>`).join('')}</tbody></table></div>` : '<div id="ucFuBox" class="empty">هنوز پیگیری‌ای ثبت نشده</div>'
    document.querySelectorAll('[data-fudel]').forEach(b => b.onclick = () => confirmBox('این ردیف پیگیری حذف شود؟', async () => { await api('/api/followups/' + b.dataset.fudel, { method: 'DELETE' }); refresh() }))
  }).catch(() => { })
  if ($('#ucEdit')) $('#ucEdit').onclick = () => unitForm(unitById(u.id))
  if ($('#ucPay')) $('#ucPay').onclick = () => paymentForm(u.id)
  if ($('#ucCredit')) $('#ucCredit').onclick = () => paymentForm(u.id, null, null, 0, true)
  $('#ucStmt').onclick = () => printOfficial(`/print/unit/${u.id}`, `صورت‌حساب واحد ${u.number}`)
  $('#ucPdf').onclick = () => saveUnitPdf(u)
  document.querySelectorAll('[data-ucview]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-ucview]').forEach(x => x.classList.toggle('on', x === b))
    const inv = b.dataset.ucview === 'inv'
    $('#ucInvView').classList.toggle('hidden', !inv)
    $('#ucMoeinView').classList.toggle('hidden', inv)
  })
  document.querySelectorAll('#ucMoeinView [data-voucher]').forEach(tr => tr.onclick = () => { const [dt, vid] = tr.dataset.voucher.split(':'); showVoucher(dt, +vid) })
})

// خروجی PDF صورت‌حساب واحد: در اپ نصبی مستقیم فایل ذخیره می‌شود؛ در مرورگر صفحه‌ی چاپی باز می‌شود.
const saveUnitPdf = guard(async u => {
  const rel = `/print/unit/${u.id}`
  const fname = `صورت‌حساب واحد ${faDigit(u.number)}${u.resident_name ? ' - ' + u.resident_name : ''}`
  if (window.hesabdar && window.hesabdar.savePdf) {
    toast('در حال ساخت PDF…')
    const r = await window.hesabdar.savePdf(rel, fname)
    if (r && r.ok) toast('PDF در پوشه‌ی «اسناد صادرشده» ذخیره شد')
    else toast((r && r.error) || 'ساخت PDF ناموفق بود', true)
  } else {
    window.open(rel, '_blank')   // مرورگر: کاربر با Ctrl+P خروجی PDF می‌گیرد
  }
})


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
const TXN_FA = { in: 'واریز ساکن', out: 'پرداخت فاکتور', transfer_in: 'انتقال ورودی', transfer_out: 'انتقال خروجی', manager_settle: 'تسویه با مدیر', adjust_in: 'سند تعدیل (افزایش)', adjust_out: 'سند تعدیل (کاهش)' }
const isIn = t => t === 'in' || t === 'transfer_in' || t === 'adjust_in'
const showFund = guard(async id => {
  const d = await api(`/api/funds/${id}/txns`)
  if (!markDetail('fund', id)) scrollTo(0, 0)
  // دفتر معین صندوق: ورودی=بدهکار · خروجی=بستانکار · ماندهٔ دونده (موجودی)
  const asc = [...d.rows].reverse()   // از قدیمی به جدید برای ماندهٔ دونده
  const opening = d.fund.opening_balance || 0
  const docNoOf = t => t.ref_no ? faDigit(t.ref_no) : t.ref_payment_id ? 'رسید ' + faDigit(t.ref_payment_id)
    : t.ref_invoice_id ? 'سند ' + faDigit(t.ref_invoice_id)
      : t.ref_cinvoice_id ? 'پیمانکار ' + faDigit(t.ref_cinvoice_id)
        : /transfer/.test(t.type) ? 'انتقال' : t.type === 'manager_settle' ? 'تسویه مدیر' : '—'
  const balCell = v => v > 0 ? money(v) : v < 0 ? '(' + money(-v) + ')' : '۰'
  let bal = opening
  const rows = asc.map(t => {
    const inAmt = isIn(t.type) ? t.amount : 0, outAmt = isIn(t.type) ? 0 : t.amount
    bal += inAmt - outAmt
    const va = t.ref_payment_id ? `payment:${t.ref_payment_id}` : t.ref_invoice_id ? `invoice:${t.ref_invoice_id}` : t.ref_cinvoice_id ? `contractor:${t.ref_cinvoice_id}` : ''
    return `<tr class="${va ? 'clickable' : ''}" ${va ? `data-voucher="${va}"` : ''}><td class="num">${faDigit(t.j_date)}</td><td class="num">${docNoOf(t)}</td>
      <td><b>${esc(TXN_FA[t.type] || t.type)}</b>${(t.note || t.inv_title || t.unit_number) ? `<br><span class="hint">${esc(t.note || t.inv_title || ('واحد ' + t.unit_number))}</span>` : ''}</td>
      <td class="num ${inAmt ? '' : 'muted'}">${inAmt ? money(inAmt) : '—'}</td>
      <td class="num ${outAmt ? '' : 'muted'}">${outAmt ? money(outAmt) : '—'}</td>
      <td class="num ${bal < 0 ? 'amt-out' : ''}">${balCell(bal)}</td>
      <td class="printhide rowact">${va ? docActs(va.split(':')[0], +va.split(':')[1]) : ''}</td></tr>`
  }).join('')
  const totIn = asc.reduce((a, t) => a + (isIn(t.type) ? t.amount : 0), 0)
  const totOut = asc.reduce((a, t) => a + (isIn(t.type) ? 0 : t.amount), 0)
  // نمای ساده: ورودی/خروجی به‌ترتیب جدید به قدیم، بدون ماندهٔ دونده
  const simpleRows = d.rows.length ? d.rows.map(t => `<tr><td class="num">${faDigit(t.j_date)}</td><td><span class="catpill">${esc(TXN_FA[t.type] || t.type)}</span></td>
      <td>${esc(t.note || t.inv_title || (t.unit_number ? 'واحد ' + t.unit_number : '—'))}</td>
      <td class="num ${isIn(t.type) ? '' : 'muted'}">${isIn(t.type) ? money(t.amount) : '—'}</td>
      <td class="num ${isIn(t.type) ? 'muted' : 'amt-out'}">${isIn(t.type) ? '—' : money(t.amount)}</td></tr>`).join('') : emptyRow(5, 'گردشی ثبت نشده')
  $('#view').innerHTML = `<button class="btn small back printhide" id="backBtn">→ بازگشت</button>` +
    head(d.fund.name, `${d.fund.kindFa} · موجودی فعلی: ${moneyU(d.fund.balance)}`,
      `<button class="btn small" onclick="printAs('دفتر صندوق ${esc(d.fund.name)}')">🖨 چاپ</button>`) +
    `<div class="panel"><div class="phead"><b>گردش صندوق</b>
      <span class="chips" style="margin:0"><button class="chip on" data-fview="simple">نمای ساده</button><button class="chip" data-fview="moein">دفتر معین</button></span></div>
      <div id="fSimpleView">
        <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>نوع</th><th>شرح</th><th>ورودی</th><th>خروجی</th></tr></thead><tbody>
        ${simpleRows}
        </tbody><tfoot><tr><td colspan="2">موجودی اولیه ${money(opening)}</td><td>موجودی فعلی</td><td colspan="2" class="num ${d.fund.balance < 0 ? 'amt-out' : ''}">${balCell(d.fund.balance)}</td></tr></tfoot></table></div>
      </div>
      <div id="fMoeinView" class="hidden">
        <div class="hint" style="padding:2px 4px 6px">ورودی = بدهکار · خروجی = بستانکار · ماندهٔ دونده (موجودی)؛ کسری داخل پرانتز</div>
        <div class="tablewrap"><table class="tx">
        <thead><tr><th>تاریخ</th><th>شماره سند</th><th>شرح</th><th>بدهکار (ورودی)</th><th>بستانکار (خروجی)</th><th>مانده (موجودی)</th><th class="printhide">عملیات</th></tr></thead><tbody>
        <tr><td class="num">—</td><td class="num">—</td><td><b>موجودی اولیهٔ دوره</b></td><td class="num muted">—</td><td class="num muted">—</td><td class="num ${opening < 0 ? 'amt-out' : ''}">${balCell(opening)}</td><td class="printhide"></td></tr>
        ${rows || emptyRow(7, 'گردشی ثبت نشده')}
        </tbody><tfoot><tr><td colspan="3">جمع</td><td class="num amt-in">${money(totIn)}</td><td class="num amt-out">${money(totOut)}</td>
          <td class="num ${d.fund.balance < 0 ? 'amt-out' : ''}">${balCell(d.fund.balance)}</td><td class="printhide"></td></tr></tfoot></table></div>
      </div></div>`
  $('#backBtn').onclick = () => goBack('funds')
  document.querySelectorAll('[data-fview]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-fview]').forEach(x => x.classList.toggle('on', x === b))
    const simple = b.dataset.fview === 'simple'
    $('#fSimpleView').classList.toggle('hidden', !simple)
    $('#fMoeinView').classList.toggle('hidden', simple)
  })
  document.querySelectorAll('#fMoeinView [data-voucher]').forEach(tr => tr.onclick = () => { const [dt, vid] = tr.dataset.voucher.split(':'); showVoucher(dt, +vid) })
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
    <div class="notice info" style="margin:0">طلب فعلی مدیر از صندوق: <b>${moneyU(debt)}</b></div>
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
// گزارش‌ها در سه گروه: برای ساکنین · برای هیئت‌مدیره · دفاتر حسابداری (پیشرفته، پیش‌فرض بسته)
const REP_GROUPS = [
  ['برای ساکنین', [['debtors', 'بدهکاران'], ['unit', 'صورت‌حساب واحد'], ['ledger', 'بدهی تفکیکی واحدها']]],
  ['برای هیئت‌مدیره', [['manager', 'عملکرد مدیر مالی'], ['income', 'درآمد و هزینه'], ['budget', 'بودجه در برابر واقعی'], ['expenses', 'هزینه‌کرد و شفاف‌سازی'], ['fund', 'گزارش صندوق‌ها'], ['invoices', 'فاکتورها'], ['projects', 'پروژه‌ها'], ['vendors', 'پیمانکاران']]],
  ['دفاتر حسابداری', [['journal', 'دفتر روزنامه'], ['gl', 'دفتر کل'], ['fundpay', 'پرداخت‌های صندوق'], ['balance', 'کنترل سلامت دفاتر'], ['audit', 'سابقهٔ تغییرات']], true]
]
VIEWS.reports = async () => {
  let adv = false; try { adv = localStorage.getItem('repAdv') === '1' } catch { }
  const inAdv = REP_GROUPS[2][1].some(([v]) => v === repTab)
  const showAdv = adv || inAdv
  $('#view').innerHTML = head('گزارش‌ها', 'خروجی قابل ارائه به ساکنین، هیئت‌مدیره و حسابرس') +
    `<div class="filters printhide rgroups">${REP_GROUPS.map(([g, tabs, isAdv]) => (isAdv && !showAdv)
      ? `<div class="rgroup"><span class="rglbl">${g}</span><button class="chip" id="repAdvOpen">نمایش ▾</button></div>`
      : `<div class="rgroup"><span class="rglbl">${g}</span><div class="chips">${tabs.map(([v, t]) => `<button class="chip ${repTab === v ? 'on' : ''}" data-rt="${v}">${t}</button>`).join('')}</div>${isAdv && !inAdv ? '<button class="link" id="repAdvClose">بستن</button>' : ''}</div>`).join('')}</div>
     <div id="repBody"><div class="empty">در حال بارگذاری…</div></div>`
  document.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { repTab = b.dataset.rt; render() })
  if ($('#repAdvOpen')) $('#repAdvOpen').onclick = () => { try { localStorage.setItem('repAdv', '1') } catch { } render() }
  if ($('#repAdvClose')) $('#repAdvClose').onclick = () => { try { localStorage.setItem('repAdv', '0') } catch { } render() }
  await REPORTS[repTab]()
}
const REPORTS = {}
let expMode = 'period', expPeriod = null, expProjectId = 0, expIds = []
REPORTS.expenses = async () => {
  const periods = await api('/api/report/periods')
  const projects = await api('/api/projects')
  if (!expPeriod) expPeriod = { from: periods[0].from, to: periods[0].to, fa: periods[0].fa }
  let q
  if (expMode === 'project' && expProjectId) q = `mode=project&projectId=${expProjectId}`
  else if (expMode === 'invoices' && expIds.length) q = `mode=invoices&ids=${expIds.join(',')}`
  else { expMode = expMode === 'invoices' && !expIds.length ? 'invoices' : expMode; q = `mode=period&from=${expPeriod.from}&to=${expPeriod.to}` }
  const r = (expMode === 'project' && !expProjectId) ? null
    : (expMode === 'invoices' && !expIds.length) ? null
      : await api('/api/report/expenses?' + q)
  const chip = (m, t) => `<button class="chip ${expMode === m ? 'on' : ''}" data-em="${m}">${t}</button>`
  const filterRow = expMode === 'period'
    ? `<select class="inp" id="exPeriod" style="max-width:220px">${periods.map(p => `<option value="${p.from}|${p.to}|${p.fa}" ${p.from === expPeriod.from ? 'selected' : ''}>${escFa(p.fa)}</option>`).join('')}</select>`
    : expMode === 'project'
      ? `<select class="inp" id="exProject" style="max-width:280px"><option value="0">— پروژه را انتخاب کنید —</option>${projects.map(p => `<option value="${p.id}" ${expProjectId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select>`
      : `<button class="btn small" id="exPickInv">انتخاب فاکتورها${expIds.length ? ` (${faDigit(expIds.length)})` : ''}</button>`
  const pdfQ = r ? q : ''
  $('#repBody').innerHTML = `
    <div class="filters printhide"><div class="chips">${chip('period', 'بازه‌ی تاریخ')}${chip('project', 'بر اساس پروژه')}${chip('invoices', 'انتخاب فاکتورها')}</div></div>
    <div class="filters printhide" style="gap:10px; align-items:center">${filterRow}
      ${r ? `<button class="btn small" id="exPdf">${IS_DESKTOP ? '📄 خروجی PDF' : '🖨 چاپ/PDF'}</button>` : ''}</div>
    ${!r ? `<div class="empty">${expMode === 'project' ? 'یک پروژه را انتخاب کنید' : 'چند فاکتور را انتخاب کنید'}</div>` : `
    <div class="panel"><h3 style="margin:0 0 4px">${esc(META.buildingName)} — گزارش هزینه‌کرد</h3><p class="sub">${esc(r.scopeLabel)}</p></div>
    <div class="kpis">
      ${kpi('جمع هزینه‌ها', money(r.totals.amount))}
      ${kpi('وصول از ساکنین', money(r.totals.collected))}
      ${kpi('مانده بدهی ساکنین', money(r.unitDebt), '', r.unitDebt > 0 ? 'bad' : '')}
      ${r.unitCredit ? kpi(TERMS.residentCredit, money(r.unitCredit)) : ''}
      ${r.contractor ? kpi('پرداخت به پیمانکار', money(r.contractor.paid)) : ''}
      ${r.contractor ? kpi('طلب باقی‌ماندهٔ پیمانکار', money(r.contractor.outstanding), '', r.contractor.outstanding > 0 ? 'warn' : 'good') : ''}
    </div>
    ${r.project ? `<div class="notice info printhide">مسیر مالی پروژه: برآورد اولیه <b>${money(r.project.budget)}</b> ← مبلغ نهایی <b>${money(r.project.finalAmount)}</b>${r.project.deviation ? ` · انحراف <b class="${r.project.deviation > 0 ? 'amt-out' : 'amt-in'}">${signed(r.project.deviation)}</b>` : ''} ${curFa()}</div>` : ''}
    <div class="panel"><div class="phead"><b>ریز فاکتورها — بابت چه چیزی</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>شرح</th><th>دسته</th><th>تاریخ</th><th>تقسیم</th><th>مبلغ کل</th><th>وصول‌شده</th><th>مانده</th></tr></thead><tbody>
      ${r.invoices.length ? r.invoices.map(i => `<tr class="clickable" data-inv="${i.id}"><td><b>${esc(i.title)}</b></td><td>${esc(i.category)}</td>
        <td class="num">${i.j_date ? faDigit(i.j_date) : '—'}</td><td><span class="catpill">${esc(i.methodFa)}</span></td>
        <td class="num">${money(i.amount)}</td><td class="num amt-in">${money(i.collected)}</td><td class="num ${i.remaining > 0 ? 'amt-out' : ''}">${money(i.remaining)}</td></tr>`).join('') : emptyRow(7, 'فاکتوری در این محدوده نیست')}
      </tbody><tfoot><tr><td colspan="4">جمع</td><td class="num">${money(r.totals.amount)}</td><td class="num">${money(r.totals.collected)}</td><td class="num">${money(r.totals.remaining)}</td></tr></tfoot></table></div></div>
    <div class="panel"><div class="phead"><b>تفکیک هر واحد</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>واحد</th><th>ساکن</th><th>سهم</th><th>پرداختی</th><th>وضعیت</th></tr></thead><tbody>
      ${r.units.length ? r.units.map(u => `<tr class="clickable" data-unit="${u.unit_id}"><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
        <td class="num">${money(u.share)}</td><td class="num amt-in">${money(u.paid)}</td>
        <td>${u.balance > 0 ? `<span class="badge b-no">بدهکار ${money(u.balance)}</span>` : u.balance < 0 ? `<span class="badge b-done">پیش‌پرداخت ${money(-u.balance)}</span>` : `<span class="badge b-ok">تسویه</span>`}</td></tr>`).join('') : emptyRow(5, 'سهمی ثبت نشده')}
      </tbody></table></div></div>`}`
  wireCommon()
  document.querySelectorAll('[data-em]').forEach(b => b.onclick = () => { expMode = b.dataset.em; render() })
  if ($('#exPeriod')) $('#exPeriod').onchange = () => { const [from, to, fa] = $('#exPeriod').value.split('|'); expPeriod = { from, to, fa }; render() }
  if ($('#exProject')) $('#exProject').onchange = () => { expProjectId = +$('#exProject').value; render() }
  if ($('#exPickInv')) $('#exPickInv').onclick = () => pickInvoicesForReport()
  if ($('#exPdf')) $('#exPdf').onclick = () => {
    const rel = '/print/expenses?' + pdfQ
    if (IS_DESKTOP && window.hesabdar.savePdf) { toast('در حال ساخت PDF…'); window.hesabdar.savePdf(rel, `گزارش هزینه‌کرد ${META.buildingName || ''}`.trim()).then(x => toast(x && x.ok ? 'PDF ذخیره شد' : 'ناموفق', !(x && x.ok))) }
    else window.open(rel, '_blank')
  }
}
async function pickInvoicesForReport() {
  const rows = await api('/api/invoices')
  openModal('انتخاب فاکتورها', `<div class="form"><div class="tablewrap" style="max-height:340px;overflow:auto"><table class="tx">
    <thead><tr><th></th><th>عنوان</th><th>تاریخ</th><th>مبلغ</th></tr></thead><tbody>
    ${rows.map(i => `<tr><td><input type="checkbox" class="exChk" value="${i.id}" ${expIds.includes(i.id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)"></td>
      <td>${esc(i.title)}</td><td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td></tr>`).join('')}
    </tbody></table></div></div>`, `<button class="btn primary" id="exApply">اعمال</button><button class="btn" id="exCancelP">انصراف</button>`)
  $('#exCancelP').onclick = closeModal
  $('#exApply').onclick = () => { expIds = [...document.querySelectorAll('.exChk:checked')].map(c => +c.value); closeModal(); render() }
}
// انتخاب‌گرِ مشترکِ دوره برای گزارش‌ها: ماه‌ها + سال جاری + از ابتدا + بازهٔ دلخواه (همه روی repRange)
function rangePickerHtml(periods, extra = '') {
  return `<div class="filters printhide">
      <select class="inp" id="repPeriod">${periods.map(p => `<option value="${p.from}|${p.to}|${p.fa}" ${p.from === repRange.from && p.to === repRange.to && !repRange.custom ? 'selected' : ''}>${escFa(p.fa)}</option>`).join('')}
        <option value="all" ${repRange.label === 'از ابتدا تا امروز' ? 'selected' : ''}>از ابتدا تا امروز</option>
        <option value="custom" ${repRange.custom ? 'selected' : ''}>بازه‌ی دلخواه…</option></select>
      ${extra}
    </div>
    <div class="filters printhide" id="repCustom" ${repRange.custom ? '' : 'hidden'}>
      <label class="f" style="flex-direction:row;align-items:center;gap:6px">از تاریخ ${dateBoxHtml('rf', repRange.jf)}</label>
      <label class="f" style="flex-direction:row;align-items:center;gap:6px">تا تاریخ ${dateBoxHtml('rt', repRange.jt)}</label>
      <button class="btn small primary" id="repApply">اعمال بازه</button>
    </div>`
}
function wireRangePicker() {
  if ($('#repPeriod')) $('#repPeriod').onchange = () => {
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
// صورتِ درآمد و هزینه (نقدی، ماه‌به‌ماه)
REPORTS.income = async () => {
  const periods = await api('/api/report/periods'), fy = await api('/api/report/fiscal-years')
  if (!repRange) repRange = { from: periods[0].from, to: periods[0].to, label: periods[0].fa }
  const r = await api(`/api/report/income?from=${repRange.from}&to=${repRange.to}`)
  const yi = fy.years.findIndex(y => y.from === repRange.from && y.to === repRange.to), prevY = yi >= 0 ? fy.years[yi + 1] : null
  const pr = prevY ? await api(`/api/report/income?from=${prevY.from}&to=${prevY.to}`) : null
  const prevOf = l => pr ? ((pr.lines.find(x => x.side === l.side && x.group === l.group && x.label === l.label) || {}).total || 0) : 0
  const months = r.periods.filter(p => p.income || p.expense)
  const showM = (months.length > 1 && months.length <= 12) || yi >= 0
  if (yi >= 0) months.splice(0, months.length, ...r.periods)
  const cols = showM ? months : []
  const block = side => {
    const ls = r.lines.filter(l => l.side === side)
    const groups = [...new Set(ls.map(l => l.group))]
    const tot = side === 'in' ? r.income : r.expense
    return `<tr class="grp"><td colspan="${cols.length + 2 + (pr ? 1 : 0)}"><b>${side === 'in' ? 'درآمدها (پول واردشده)' : 'هزینه‌ها (پول پرداخت‌شده)'}</b></td></tr>
      ${ls.length ? groups.map(g => `<tr class="sub"><td colspan="${cols.length + 2}">${esc(g)}</td></tr>` + ls.filter(l => l.group === g).map(l =>
        `<tr><td style="padding-inline-start:22px">${esc(l.label)}</td>${cols.map(p => `<td class="num">${l.byMonth[p.key] ? money(l.byMonth[p.key]) : '—'}</td>`).join('')}<td class="num">${money(l.total)}</td>${pr ? `<td class="num dim">${money(prevOf(l))}</td>` : ''}</tr>`).join('')).join('')
        : `<tr><td colspan="${cols.length + 2}" class="dim">موردی نبوده</td></tr>`}
      <tr class="tot"><td>جمع ${side === 'in' ? 'درآمدها' : 'هزینه‌ها'}</td>${cols.map(p => `<td class="num">${money(side === 'in' ? p.income : p.expense)}</td>`).join('')}<td class="num">${money(tot)}</td>${pr ? `<td class="num">${money(side === 'in' ? pr.income : pr.expense)}</td>` : ''}</tr>`
  }
  $('#repBody').innerHTML = rangePickerHtml(periods, `<div class="chips">${fy.years.slice(0, 4).map(y => `<button class="chip ${y.from === repRange.from && y.to === repRange.to ? 'on' : ''}" data-fy="${y.from}|${y.to}|${y.label}">${escFa(y.label)}</button>`).join('')}</div><button class="btn small" onclick="printOfficial('/print/report/income?from=' + repRange.from + '&to=' + repRange.to, 'صورت درآمد و هزینه')">🖨 چاپ رسمی</button><a class="btn small" href="/api/export/income?from=${repRange.from}&to=${repRange.to}">⬇️ اکسل</a>`) + `
    <div class="panel"><h3 style="margin-bottom:4px">${esc(r.buildingName)} — صورت درآمد و هزینه</h3>
      <p class="sub">دوره: ${escFa(repRange.label)} · مبنا: ${esc(r.basis)}</p></div>
    <div class="kpis">
      ${kpi('درآمد دوره', money(r.income), 'پول واردشده به صندوق‌ها')}
      ${kpi('هزینهٔ دوره', money(r.expense), 'پول پرداخت‌شده از صندوق‌ها')}
      ${kpi('خالص دوره', signed(r.net), r.net < 0 ? 'کسری: بیش از درآمد خرج شده' : 'مازاد', r.net < 0 ? 'bad' : '')}
      ${kpi('موجودی صندوق‌ها', money(r.closeCash), 'اول دوره: ' + money(r.openCash))}
    </div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>شرح</th>${cols.map(p => `<th>${escFa(p.fa)}</th>`).join('')}<th>جمع دوره</th>${pr ? `<th>${escFa(prevY.label)}</th>` : ''}</tr></thead><tbody>
      ${block('in')}${block('out')}
      <tr class="tot"><td>خالص (درآمد منهای هزینه)</td>${cols.map(p => `<td class="num ${p.net < 0 ? 'amt-out' : ''}">${signed(p.net)}</td>`).join('')}<td class="num ${r.net < 0 ? 'amt-out' : ''}"><b>${signed(r.net)}</b></td>${pr ? `<td class="num">${signed(pr.net)}</td>` : ''}</tr>
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>تطبیق با موجودی صندوق‌ها</b></div><div class="tablewrap"><table class="tx"><tbody>
      <tr><td>موجودی اول دوره</td><td class="num">${money(r.openCash)}</td></tr>
      <tr><td>+ خالص درآمد و هزینه</td><td class="num">${signed(r.net)}</td></tr>
      ${r.nonOp.transferIn || r.nonOp.transferOut ? `<tr><td>انتقال بین صندوق‌ها (ورودی − خروجی؛ در جمع کل صفر است)</td><td class="num">${signed(r.nonOp.transferIn - r.nonOp.transferOut)}</td></tr>` : ''}
      ${r.nonOp.adjustIn || r.nonOp.adjustOut ? `<tr><td>اسناد تعدیل صندوق</td><td class="num">${signed(r.nonOp.adjustIn - r.nonOp.adjustOut)}</td></tr>` : ''}
      <tr class="tot"><td>موجودی آخر دوره</td><td class="num">${money(r.closeCash)}</td></tr>
      </tbody></table></div>
      <p class="hint" style="margin:8px 0 0">${r.check === 0 ? 'جمع‌ها با موجودی واقعی صندوق‌ها می‌خواند.' : '<b class="amt-out">اختلاف ' + money(Math.abs(r.check)) + ' با موجودی صندوق‌ها — «کنترل سلامت دفاتر» را ببینید.</b>'}
      ${r.managerDebt > 0 ? ` · مدیر ${money(r.managerDebt)} از جیب خودش هزینه کرده که هنوز از صندوق پس نگرفته؛ این مبلغ وقتی تسویه شود در «تسویه با مدیر» می‌آید.` : ''}</p></div>
    <p class="hint">شارژ صادرشده یا فاکتور ثبت‌شده تا وقتی پولش جابه‌جا نشده اینجا نمی‌آید؛ تعهدها را در «بدهی تفکیکی واحدها» و «فاکتورها» ببینید.</p>`
  wireCommon(); wireToday($('#repBody')); wireRangePicker()
  document.querySelectorAll('[data-fy]').forEach(b => b.onclick = () => { const [from, to, label] = b.dataset.fy.split('|'); repRange = { from, to, label }; render() })
}
REPORTS.budget = async () => {
  const periods = await api('/api/report/periods'), fy = await api('/api/report/fiscal-years')
  if (!repRange) repRange = { from: periods[0].from, to: periods[0].to, label: periods[0].fa }
  const r = await api(`/api/report/budget?from=${repRange.from}&to=${repRange.to}`)
  const sg = r.suggested
  $('#repBody').innerHTML = rangePickerHtml(periods, `<div class="chips">${fy.years.slice(0, 3).map(y => `<button class="chip ${y.from === repRange.from && y.to === repRange.to ? 'on' : ''}" data-fy="${y.from}|${y.to}|${y.label}">${escFa(y.label)}</button>`).join('')}</div><button class="btn small" onclick="printAs('بودجه در برابر واقعی')">🖨 چاپ</button>`) + `
    <div class="panel"><h3 style="margin-bottom:4px">${esc(META.buildingName)} — بودجه در برابر واقعی</h3><p class="sub">دوره: ${escFa(repRange.label)} (${faDigit(r.months)} ماه) · واقعی = هزینهٔ پرداخت‌شده از صندوق‌ها</p></div>
    <div class="kpis">
      ${kpi('بودجهٔ دوره', money(r.total.budget))}
      ${kpi('هزینهٔ واقعی', money(r.total.actual))}
      ${kpi('انحراف', signed(r.total.diff), r.total.diff > 0 ? 'بیش از بودجه' : 'کمتر از بودجه', r.total.diff > 0 ? 'bad' : '')}
      ${kpi('شارژ پیشنهادی هر واحد', sg.perUnit ? money(sg.perUnit) : '—', sg.perUnit ? 'فعلی: ' + money(sg.current) + ' · ' + faDigit(sg.units) + ' واحد' : 'برای دسته‌ها بودجه تعیین کنید')}
    </div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>دسته</th><th>بودجهٔ ماهانه</th><th>بودجهٔ دوره</th><th>واقعی</th><th>انحراف</th><th>درصد مصرف</th></tr></thead><tbody>
      ${r.rows.length ? r.rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.monthly ? money(x.monthly) : '—'}</td><td class="num">${x.budget ? money(x.budget) : '—'}</td><td class="num">${money(x.actual)}</td>
        <td class="num ${x.budget && x.diff > 0 ? 'amt-out' : ''}">${x.budget ? signed(x.diff) : 'بدون بودجه'}</td><td class="num">${x.pct != null ? faDigit(x.pct) + '٪' : '—'}</td></tr>`).join('') : emptyRow(6, 'برای این دوره بودجه یا هزینه‌ای نیست')}
      </tbody><tfoot><tr><td>جمع</td><td></td><td class="num">${money(r.total.budget)}</td><td class="num">${money(r.total.actual)}</td><td class="num">${signed(r.total.diff)}</td><td></td></tr></tfoot></table></div>
      <p class="hint" style="margin:8px 0 0">بودجهٔ هر دسته از تنظیمات ← دسته‌های هزینه تعیین می‌شود. پرداخت به پیمانکارِ پروژه‌ها و تسویه با مدیر (${money(r.otherOutflow)}) جزو این جدول نیست. شارژ پیشنهادی = جمع بودجهٔ ماهانهٔ دسته‌هایی که از صندوق شارژ پرداخت می‌شوند ÷ تعداد واحدها.</p></div>`
  wireCommon(); wireToday($('#repBody')); wireRangePicker()
  document.querySelectorAll('[data-fy]').forEach(b => b.onclick = () => { const [from, to, label] = b.dataset.fy.split('|'); repRange = { from, to, label }; render() })
}
REPORTS.manager = async () => {
  const periods = await api('/api/report/periods')
  if (!repRange) repRange = { from: periods[0].from, to: periods[0].to, label: periods[0].fa }
  const r = await api(`/api/report/manager?from=${repRange.from}&to=${repRange.to}`)
  $('#repBody').innerHTML = `
    ${rangePickerHtml(periods, `<a class="btn small" href="/api/export/manager?from=${repRange.from}&to=${repRange.to}">⬇️ CSV</a>
      <button class="btn small" onclick="printAs('گزارش عملکرد مدیر مالی')">🖨 چاپ</button>
      <button class="btn small" id="repSummary">📄 خلاصه‌ی هیئت‌مدیره${IS_DESKTOP ? ' (PDF)' : ''}</button>
      <label class="chkline"><input type="checkbox" id="repNames"> نمایش نام بدهکاران</label>`)}
    <div class="panel"><h3 style="margin-bottom:4px">${esc(r.buildingName)} — گزارش عملکرد مدیر مالی</h3>
      <p class="sub">دوره: ${escFa(repRange.label)}</p></div>
    <div class="kpis">
      ${kpi('درآمد دوره', money(r.cash.income), 'نقدی · ' + faDigit(r.payments.count) + ' دریافتی')}
      ${kpi('هزینهٔ پرداخت‌شده', money(r.cash.expense), 'نقدی')}
      ${kpi('خالص دوره', signed(r.cash.net), 'تعریف «صورت درآمد و هزینه»', r.cash.net < 0 ? 'bad' : '')}
      ${kpi('طلب مدیر از صندوق', money(r.managerDebt), '', r.managerDebt > 0 ? 'warn' : '')}
    </div>
    <div class="panel"><div class="phead"><b>دریافتی به تفکیک صندوق</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق</th><th>تعداد</th><th>مبلغ</th></tr></thead><tbody>
      ${r.payments.byFund.length ? r.payments.byFund.map(f => `<tr><td>${esc(f.name)}</td><td class="num">${faDigit(f.count)}</td><td class="num amt-in">${money(f.amount)}</td></tr>`).join('') : emptyRow(3, 'دریافتی در این دوره نبوده')}
      </tbody><tfoot><tr><td>جمع</td><td class="num">${faDigit(r.payments.count)}</td><td class="num">${money(r.payments.total)}</td></tr></tfoot></table></div></div>
    <div class="panel"><div class="phead"><b>فاکتورهای هزینهٔ ثبت‌شده در دوره (تعهدی)</b><span class="hint">بر اساس تاریخ فاکتور، چه پرداخت شده باشد چه نه</span></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>دسته</th><th>ثابت</th><th>متغیر</th><th>پیش‌بینی‌نشده</th><th>جمع</th></tr></thead><tbody>
      ${r.expenses.byCategory.length ? r.expenses.byCategory.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${money(c.fixed)}</td>
        <td class="num">${money(c.variable)}</td><td class="num">${money(c.unexpected)}</td><td class="num amt-out">${money(c.total)}</td></tr>`).join('') : emptyRow(5, 'هزینه‌ای در این دوره نبوده')}
      </tbody><tfoot><tr><td>جمع کل</td><td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.fixed, 0))}</td>
        <td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.variable, 0))}</td>
        <td class="num">${money(r.expenses.byCategory.reduce((s, c) => s + c.unexpected, 0))}</td><td class="num">${money(r.expenses.total)}</td></tr></tfoot></table></div></div>
    <div class="panel"><div class="phead"><b>گردش صندوق‌ها</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق</th><th>اول دوره</th><th>ورودی</th><th>خروجی</th><th>انتقال (±)</th><th>آخر دوره</th></tr></thead><tbody>
      ${r.fundFlow.map(f => `<tr><td><b>${esc(f.name)}</b></td><td class="num">${money(f.open)}</td><td class="num">${money(f.in)}</td>
        <td class="num">${money(f.out)}</td><td class="num">${f.transfer ? signed(f.transfer) : '—'}</td><td class="num ${f.close < 0 ? 'amt-out' : ''}"><b>${money(f.close)}</b></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>مانده‌ی فاکتورهای دوره</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>مبلغ</th><th>وصول‌شده</th><th>مانده</th></tr></thead><tbody>
      ${r.invoices.length ? r.invoices.map(i => `<tr class="clickable" data-inv="${i.id}"><td>${esc(i.title)}</td><td><span class="catpill">${esc(i.category || '—')}</span></td>
        <td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td><td class="num amt-in">${money(i.collected)}</td>
        <td class="num ${i.remaining > 0 ? 'amt-out' : ''}">${money(i.remaining)}</td></tr>`).join('') : emptyRow(6, 'فاکتوری در این دوره نبوده')}
      </tbody></table></div></div>
    <div class="panel printhide" id="boardBook"></div>`
  wireCommon(); wireToday($('#repBody'))
  LAST_MANAGER = r
  $('#repSummary').onclick = () => openSummary($('#repNames') && $('#repNames').checked)
  renderBoardBook()
  wireRangePicker()
}

// خلاصه‌ی ماهانه‌ی هیئت‌مدیره (ماه جاری): اپ نصبی → PDF، مرورگر → صفحه‌ی چاپی
let LAST_MANAGER = null
const openSummary = guard(async showNames => {
  const rel = '/print/summary' + (showNames ? '?names=1' : '')
  if (IS_DESKTOP && window.hesabdar.savePdf) {
    toast('در حال ساخت خلاصه…')
    const r = await window.hesabdar.savePdf(rel, `خلاصه ماهانه هیئت‌مدیره ${META.buildingName || ''}`.trim())
    toast(r && r.ok ? 'خلاصه در پوشه‌ی «اسناد صادرشده» ذخیره شد' : (r && r.error) || 'ناموفق', !(r && r.ok))
  } else window.open(rel, '_blank')
})

// متن واتساپ خلاصه برای اعضای هیئت‌مدیره
function boardWaText(c) {
  const r = LAST_MANAGER, b = (META && META.buildingName) || 'ساختمان'
  if (!r) return `سلام ${c.name || ''}`
  const net = r.cash.net
  const fundTotal = r.fundFlow.reduce((s, f) => s + f.close, 0)
  return `📊 خلاصه‌ی مالی ${b}\n`
    + `دوره: ${repRange.label}\n`
    + `— درآمد (پول واردشده): ${moneyU(r.cash.income)}\n`
    + `— هزینه (پول پرداخت‌شده): ${moneyU(r.cash.expense)}\n`
    + `— خالص دوره: ${signed(net)} ${curFa()}\n`
    + `— موجودی صندوق‌ها: ${moneyU(fundTotal)}\n`
    + `— طلب مدیر از صندوق: ${moneyU(r.managerDebt)}\n`
    + `گزارش کامل به‌صورت فایل PDF پیوست می‌شود. 🙏`
}
function boardWa(c) {
  window.open(`https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(boardWaText(c))}`, '_blank', 'noopener')
}
let LAST_CONTACTS = []
async function renderBoardBook() {
  const box = $('#boardBook'); if (!box) return
  LAST_CONTACTS = await api('/api/report-contacts')
  box.innerHTML = `<div class="phead"><b>📇 دفترچه‌ی هیئت‌مدیره</b><span class="hint">ارسال خلاصه به اعضا از طریق واتساپ</span></div>
    ${adminOnly(`<div class="filters" style="padding:0 0 10px">
      <input class="inp" id="bcName" placeholder="نام" style="max-width:160px">
      <input class="inp" id="bcPhone" placeholder="موبایل (۰۹…)" style="max-width:150px">
      <input class="inp" id="bcRole" placeholder="سمت (اختیاری)" style="max-width:150px">
      <button class="btn small primary" id="bcAdd">＋ افزودن</button></div>`)}
    <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>سمت</th><th>موبایل</th><th>اقدام</th></tr></thead><tbody>
    ${LAST_CONTACTS.length ? LAST_CONTACTS.map((c, i) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.role || '—')}</td>
      <td class="num">${faDigit(c.phone || '—')}</td>
      <td class="rowact"><button class="btn tiny" data-bcwa="${i}" title="ارسال خلاصه در واتساپ">💬</button>
        ${adminOnly(`<button class="btn tiny" data-bcdel="${c.id}" title="حذف">🗑</button>`)}</td></tr>`).join('')
    : emptyRow(4, 'هنوز مخاطبی ثبت نشده')}
    </tbody></table></div>
    <div class="hint" style="margin-top:8px">💡 اول با «📄 خلاصه‌ی هیئت‌مدیره» فایل PDF را بسازید، سپس پیام واتساپ را بفرستید و فایل را دستی پیوست کنید.</div>`
  if ($('#bcAdd')) $('#bcAdd').onclick = guard(async () => {
    const name = $('#bcName').value.trim(); if (!name) return toast('نام لازم است', true)
    await post('/api/report-contacts', { name, phone: $('#bcPhone').value.trim(), role: $('#bcRole').value.trim() })
    toast('مخاطب افزوده شد'); renderBoardBook()
  })
  box.querySelectorAll('[data-bcwa]').forEach(b => b.onclick = () => boardWa(LAST_CONTACTS[+b.dataset.bcwa]))
  box.querySelectorAll('[data-bcdel]').forEach(b => b.onclick = () => confirmBox('این مخاطب از دفترچهٔ هیئت‌مدیره حذف شود؟',
    async () => { await api('/api/report-contacts/' + b.dataset.bcdel, { method: 'DELETE' }); toast('حذف شد'); renderBoardBook() }))
}

let LAST_DEBTORS = []
let debtorsAsOf = null
REPORTS.debtors = async () => {
  const r = await api('/api/report/debtors' + (debtorsAsOf ? '?asOf=' + debtorsAsOf.g : ''))
  LAST_DEBTORS = r.rows
  const batchBtn = IS_DESKTOP && r.rows.length
    ? `<button class="btn small" id="dbBatchPdf">📄 صورت‌حساب همه (PDF)</button>` : ''
  $('#repBody').innerHTML = `
    <div class="filters printhide"><label class="f" style="flex-direction:row;align-items:center;gap:6px">مانده تا تاریخ ${dateBoxHtml('dbAs', debtorsAsOf && debtorsAsOf.j)}</label><button class="btn small" id="dbAsGo">اعمال</button>${debtorsAsOf ? '<button class="btn small" id="dbAsClear">امروز</button>' : ''}</div>
    ${debtorsAsOf ? `<div class="notice info">بدهی‌ها تا پایانِ روزِ <b>${faDigit(r.asOfJ)}</b> — پیگیری و قول پرداخت فقط در نمای امروز نمایش داده می‌شود.</div>` : ''}
    <div class="filters printhide"><a class="btn small" href="/api/export/debtors${debtorsAsOf ? '?asOf=' + debtorsAsOf.g : ''}">⬇️ اکسل</a>${batchBtn}<button class="btn small" onclick="printOfficial('/print/report/debtors', 'گزارش بدهکاران')">🖨 چاپ رسمی</button></div>
    <div class="kpis">${kpi('جمع کل بدهی', money(r.total), faDigit(r.rows.length) + ' واحد بدهکار', 'hero bad')}
      ${Object.entries(r.buckets).map(([b, v]) => kpi('قدمت ' + b + ' روز', money(v))).join('')}</div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>واحد</th><th>ساکن</th><th>تلفن</th><th>بدهی</th>${Object.keys(r.buckets).map(b => `<th>${b} روز</th>`).join('')}<th>آخرین پیگیری</th><th>قول پرداخت</th><th class="printhide">اقدام</th></tr></thead><tbody>
      ${r.rows.length ? r.rows.map((u, i) => `<tr class="clickable" data-unit="${u.id}"><td><b>${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
        <td class="num">${faDigit(u.phone || '—')}</td><td class="num amt-out">${money(u.debt)}</td>
        ${Object.keys(r.buckets).map(b => `<td class="num ${b === '+۹۰' && u.ages && u.ages[b] ? 'amt-out' : ''}">${u.ages && u.ages[b] ? money(u.ages[b]) : '—'}</td>`).join('')}
        <td>${u.lastFollow ? `<span class="num">${faDigit(u.lastFollow.j)}</span> <span class="hint">${esc(u.lastFollow.channelFa)}${u.followCount > 1 ? ' · ' + faDigit(u.followCount) + ' بار' : ''}</span>` : '<span class="dim">—</span>'}</td>
        <td>${u.promise ? (u.promise.kept ? `<span class="badge b-settled">عمل شد</span>` : `<span class="badge ${u.promise.due ? 'b-no' : 'b-open'}">${u.promise.due ? 'سررسید گذشته' : 'تا'} ${faDigit(u.promise.j)}</span>${u.promise.amount ? ' <span class="hint">' + money(u.promise.amount) + '</span>' : ''}`) : '<span class="dim">—</span>'}</td>
        <td class="printhide rowact">${isAdmin() ? `<button class="btn tiny" data-fu="${u.id}" title="ثبت پیگیری">📝</button>` : ''}<button class="btn tiny" data-wa="${i}" title="پیام واتساپ">💬</button><button class="btn tiny" data-pdf="${i}" title="صورت‌حساب PDF">📄</button></td></tr>`).join('')
      : emptyRow(11, 'هیچ واحدی بدهکار نیست')}
      </tbody><tfoot><tr><td colspan="3">جمع کل</td><td class="num">${money(r.total)}</td>${Object.values(r.buckets).map(v => `<td class="num">${money(v)}</td>`).join('')}<td colspan="2"></td><td class="printhide"></td></tr></tfoot></table></div>
      <div class="hint printhide" style="margin-top:8px">💡 واتساپ فقط متن پیام را آماده می‌کند؛ فایل PDF به‌صورت خودکار پیوست نمی‌شود. اگر می‌خواهید صورت‌حساب را بفرستید، اول با «📄» فایل را بسازید و در واتساپ دستی پیوست کنید.</div>
    </div>`
  wireCommon()
  if ($('#dbBatchPdf')) $('#dbBatchPdf').onclick = () => saveDebtorsBatchPdf(LAST_DEBTORS)
  wireToday($('#repBody'))
  $('#dbAsGo').onclick = guard(async () => { const t = readDate('dbAs'); if (!t.jy || !t.jm || !t.jd) throw new Error('تاریخ را کامل وارد کنید'); debtorsAsOf = { g: gStr(t.jy, t.jm, t.jd), j: t }; render() })
  if ($('#dbAsClear')) $('#dbAsClear').onclick = () => { debtorsAsOf = null; render() }
  document.querySelectorAll('[data-wa]').forEach(b => b.onclick = e => { e.stopPropagation(); openWhatsApp(LAST_DEBTORS[+b.dataset.wa]); setTimeout(render, 600) })
  document.querySelectorAll('[data-fu]').forEach(b => b.onclick = e => { e.stopPropagation(); followupForm(+b.dataset.fu) })
  document.querySelectorAll('[data-pdf]').forEach(b => b.onclick = e => { e.stopPropagation(); saveUnitPdf(LAST_DEBTORS[+b.dataset.pdf]) })
}

// ساخت گروهی صورت‌حساب همه‌ی بدهکاران (فقط اپ نصبی)
const saveDebtorsBatchPdf = guard(async rows => {
  if (!IS_DESKTOP || !window.hesabdar.savePdfBatch) return toast('این قابلیت فقط در اپ نصبی فعال است', true)
  if (!rows.length) return toast('بدهکاری وجود ندارد')
  toast(`در حال ساخت ${faDigit(rows.length)} صورت‌حساب…`)
  const items = rows.map(u => ({
    path: `/print/unit/${u.id}`,
    filename: `صورت‌حساب واحد ${faDigit(u.number)}${u.resident_name ? ' - ' + u.resident_name : ''}`
  }))
  const r = await window.hesabdar.savePdfBatch(items)
  const okN = (r.results || []).filter(x => x.ok).length
  const badN = (r.results || []).length - okN
  toast(`${faDigit(okN)} صورت‌حساب در پوشه‌ی «اسناد صادرشده» ذخیره شد${badN ? ` (${faDigit(badN)} ناموفق)` : ''}`, badN > 0)
})
REPORTS.ledger = async () => {
  const r = await api('/api/report/unit-ledger')
  const bal = v => v > 0 ? `<span class="amt-out">بدهکار ${money(v)}</span>` : v < 0 ? `<span class="amt-in">پیش‌پرداخت ${money(-v)}</span>` : '۰'
  const ownerBal = v => v > 0 ? `<span class="amt-out">بدهی مالکین ${money(v)}</span>` : v < 0 ? `<span class="amt-in">طلبِ مالکین ${money(-v)}</span>` : '۰'
  $('#repBody').innerHTML = `
    <div class="filters printhide"><button class="btn small" onclick="printAs('بدهی تفکیکی واحدها')">🖨 چاپ</button><a class="btn small" href="/api/export/ledger">⬇️ اکسل</a></div>
    <p class="hint">بدهیِ هر واحد در سه سبدِ جدا: <b>شارژ ماهانه (جاری)</b> · <b>فیش‌ها و هزینه‌های صندوق عمرانی</b> · <b>پروژه‌ها (بدهی یا طلب)</b>.</p>
    <div class="kpis">
      ${kpi('جمع کل (خالص)', ownerBal(r.total.net), 'شارژ + قبوض + ماندهٔ پروژه', 'hero bad')}
      ${kpi('جمع بدهی شارژ', money(r.total.charge), 'جاری', 'bad')}
      ${kpi('جمع بدهی قبوض و متفرقه', money(r.total.omrani), 'آب/برق/گاز و هزینه‌های جزئی', 'bad')}
      ${kpi('تعهدِ پروژه‌ها', bal(r.total.projectDue), 'باقی‌ماندهٔ مصوبه', '')}
      ${kpi('ماندهٔ پروژه‌ها', bal(r.total.projectBal), 'طلب/بدهی به صندوق', '')}
    </div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead>
        <tr><th rowspan="2">واحد</th><th rowspan="2">ساکن</th><th rowspan="2">بدهی شارژ (جاری)</th><th rowspan="2">بدهی قبوض و متفرقه</th><th colspan="2" style="text-align:center;border-bottom:2px solid var(--accent)">صندوق عمرانی (پروژه‌ها)</th><th rowspan="2">جمع خالص</th></tr>
        <tr><th>تعهد (باقی‌ماندهٔ مصوبه)</th><th>طلب/بدهی به صندوق</th></tr>
      </thead><tbody>
      ${r.rows.length ? r.rows.map(u => `<tr class="clickable" data-unit="${u.id}"><td><b>واحد ${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
        <td class="num ${u.charge > 0 ? 'amt-out' : ''}">${u.charge > 0 ? money(u.charge) : '۰'}</td>
        <td class="num ${u.omrani > 0 ? 'amt-out' : ''}">${u.omrani > 0 ? money(u.omrani) : '۰'}</td>
        <td class="num">${bal(u.projectDue)}</td>
        <td class="num">${bal(u.projectBal)}</td>
        <td class="num ${u.net > 0 ? 'amt-out' : u.net < 0 ? 'amt-in' : ''}">${u.net > 0 ? money(u.net) : u.net < 0 ? 'پیش‌پرداخت ' + money(-u.net) : '۰'}</td></tr>`).join('')
      : emptyRow(7, 'واحدی ثبت نشده')}
      </tbody><tfoot><tr><td colspan="2">جمع کل</td><td class="num amt-out">${money(r.total.charge)}</td><td class="num amt-out">${money(r.total.omrani)}</td><td class="num">${bal(r.total.projectDue)}</td><td class="num">${bal(r.total.projectBal)}</td><td class="num">${ownerBal(r.total.net)}</td></tr></tfoot>
    </table></div></div>`
  wireCommon()
}
REPORTS.fund = async () => {
  const funds = META.funds
  const txnKind = t => ({ in: 'دریافت', out: 'پرداخت', transfer_in: 'انتقال ورودی', transfer_out: 'انتقال خروجی', manager_settle: 'تسویه با مدیر' }[t.type] || t.type)
  const catFa = c => ({ charge: 'شارژ (جاری)', omrani: 'قبوض و متفرقه', project: 'پروژه‌ها (عمرانی)' }[c] || '')
  const draw = async id => {
    const box = $('#rfBox'); if (!id) { box.innerHTML = '<div class="panel"><div class="empty">یک صندوق را انتخاب کنید</div></div>'; return }
    box.innerHTML = '<div class="empty">در حال بارگذاری…</div>'
    const d = await api('/api/report/fund?fundId=' + id)
    box.innerHTML = `
      <div class="kpis">
        ${kpi('موجودی فعلی', money(d.fund.balance), d.fund.kindFa, d.fund.balance < 0 ? 'bad' : '')}
        ${kpi('دریافتی', money(d.fund.received), 'از ساکنین ' + money(d.fund.residents) + (d.fund.otherIn ? ' · سایر ' + money(d.fund.otherIn) : ''))}
        ${kpi('مخارج', money(d.fund.spent), 'پرداخت هزینه ' + money(d.fund.expenses) + (d.fund.managerSettle ? ' · تسویه با مدیر ' + money(d.fund.managerSettle) : ''))}
        ${d.fund.transferIn || d.fund.transferOut ? kpi('انتقال بین صندوق‌ها', signed(d.fund.transferNet), 'ورودی ' + money(d.fund.transferIn) + ' · خروجی ' + money(d.fund.transferOut)) : ''}
        ${kpi('بدهی واحدها به این صندوق', money(d.totalUnitDebt), d.basis ? 'مبنا: ' + d.basis : catFa(d.category), d.totalUnitDebt > 0 ? 'bad' : '')}
      </div>
      <div class="grid2">
        <div class="panel"><div class="phead"><b>ریز ورودی و خروجی</b></div>
          <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>نوع</th><th>بابت</th><th>مبلغ</th></tr></thead><tbody>
          ${d.txns.length ? d.txns.map(t => { const isIn = /in/.test(t.type); return `<tr><td class="num">${faDigit(t.j_date)}</td><td>${txnKind(t)}</td>
            <td>${esc(t.note || t.inv_title || (t.unit_number ? 'واحد ' + t.unit_number : '') || t.peer_name || '—')}</td>
            <td class="num ${isIn ? 'amt-in' : 'amt-out'}">${isIn ? '+' : '−'}${money(t.amount)}</td></tr>` }).join('') : emptyRow(4, 'تراکنشی ثبت نشده')}
          </tbody></table></div></div>
        <div class="panel"><div class="phead"><b>بدهی هر واحد به این صندوق</b><span class="hint">${catFa(d.category)}</span></div>
          <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>بدهی/طلب</th></tr></thead><tbody>
          ${d.unitDebts.length ? d.unitDebts.map(u => `<tr class="clickable" data-unit="${u.id}"><td><b>واحد ${escFa(u.number)}</b></td><td>${esc(u.resident_name || '—')}</td>
            <td class="num">${u.debt > 0 ? `<span class="amt-out">بدهکار ${money(u.debt)}</span>` : u.debt < 0 ? `<span class="amt-in">پیش‌پرداخت ${money(-u.debt)}</span>` : 'تسویه'}</td></tr>`).join('') : emptyRow(3, 'واحدی به این صندوق بدهکار نیست')}
          </tbody></table></div></div>
      </div>`
    wireCommon()
  }
  const ov = await api('/api/report/funds-overview')
  const t = ov.total
  $('#repBody').innerHTML = `
    <div class="filters printhide">
      <button class="btn small" onclick="printOfficial('/print/report/funds', 'گزارش کامل صندوق‌ها')">🖨 چاپ رسمی</button><a class="btn small" href="/api/export/funds">⬇️ اکسل</a></div>
    <p class="hint">گزارشِ کاملِ همهٔ صندوق‌ها از ابتدا تا امروز (${faDigit(jStamp())}): موجودیِ اولیه + دریافتی − مخارج ± انتقال بین صندوق‌ها = موجودیِ فعلی؛ و بدهیِ واحدها به هر صندوق. انتقال‌ها جزو دریافتی و مخارج نیستند.</p>
    <div class="kpis">
      ${kpi('موجودی کل صندوق‌ها', money(t.balance), 'مجموعِ ماندهٔ همه', t.balance < 0 ? 'bad' : '')}
      ${kpi('جمع دریافتی', money(t.received), 'از ابتدا · بدون انتقال‌ها')}
      ${kpi('جمع مخارج', money(t.spent), 'از ابتدا · بدون انتقال‌ها')}
      ${kpi('جمع بدهیِ واحدها', money(t.unitDebt), 'به همهٔ صندوق‌ها', t.unitDebt > 0 ? 'bad' : '')}
    </div>
    <div class="panel"><div class="phead"><b>همهٔ صندوق‌ها — یک نگاه</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>صندوق</th><th>موجودی اولیه</th><th>دریافتی</th><th>مخارج</th><th>انتقال (±)</th><th>موجودی فعلی</th><th>بدهکارِ واحدها</th></tr></thead><tbody>
      ${ov.funds.map(f => `<tr class="clickable" data-fund="${f.id}"><td><b>${esc(f.name)}</b></td>
        <td class="num">${money(f.opening)}</td><td class="num">${money(f.received)}</td>
        <td class="num">${money(f.spent)}</td><td class="num">${f.transferNet ? signed(f.transferNet) : '—'}${f.adjust ? `<br><span class="hint">تعدیل ${signed(f.adjust)}</span>` : ''}</td>
        <td class="num ${f.balance < 0 ? 'amt-out' : ''}"><b>${money(f.balance)}</b></td>
        <td class="num ${f.unitDebt > 0 ? 'amt-out' : ''}">${f.unitDebt > 0 ? money(f.unitDebt) : '۰'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>جمع کل</td><td class="num">${money(t.opening)}</td><td class="num">${money(t.received)}</td>
        <td class="num">${money(t.spent)}</td><td class="num">${t.transferNet ? signed(t.transferNet) : '—'}</td><td class="num"><b>${money(t.balance)}</b></td><td class="num">${money(t.unitDebt)}</td></tr></tfoot>
    </table></div></div>
    <div class="filters printhide" style="margin-top:12px"><label class="f" style="max-width:280px">ریزِ یک صندوق<select class="inp" id="rfSel"><option value="">— انتخاب صندوق برای دیدن ریز —</option>
      ${funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label></div>
    <div id="rfBox"></div>`
  wireCommon()
  $('#rfSel').onchange = guard(() => draw(+$('#rfSel').value || 0))
  document.querySelectorAll('[data-fund]').forEach(tr => tr.onclick = () => { $('#rfSel').value = tr.dataset.fund; draw(+tr.dataset.fund) })
}
// ---- برگهٔ سندِ دوطرفه (مودال) ----
// ویرایش/حذفِ یک سند از هر گزارشی (دفتر کل/روزنامه/کارت‌ها)
async function editDoc(dtype, id) {
  if (dtype === 'invoice') { const d = await api('/api/invoice/' + id); invoiceForm(d.invoice) }
  else if (dtype === 'payment') { const v = await api(`/api/report/voucher?dtype=payment&id=${id}`); paymentForm(null, v.raw) }
  else if (dtype === 'contractor') { const v = await api(`/api/report/voucher?dtype=contractor&id=${id}`); cInvoiceForm(v.raw.project_id, v.raw, refresh) }
}
function deleteDoc(dtype, id) {
  const ep = dtype === 'invoice' ? '/api/invoices/' : dtype === 'payment' ? '/api/payments/' : '/api/contractor-invoices/'
  const what = dtype === 'invoice' ? 'این فاکتور' : dtype === 'payment' ? 'این دریافتی' : 'این فاکتور پیمانکار'
  confirmReason(`${what} حذف شود؟ اثرش روی بدهیِ واحدها و موجودیِ صندوق‌ها برگشت می‌خورد.`,
    async r => { await api(ep + id + '?reason=' + encodeURIComponent(r), { method: 'DELETE' }); toast('سند حذف شد'); refresh() })
}
const docActs = (dtype, id) => isAdmin() ? `<button class="btn tiny" data-dedit="${dtype}:${id}" title="ویرایش">✏️</button> <button class="btn tiny del" data-ddel="${dtype}:${id}" title="حذف">🗑</button>` : ''
// شنوندهٔ سراسری (یک‌بار): دکمه‌های ✏️/🗑 در همهٔ جدول‌ها
if (!window.__docActsWired) {
  window.__docActsWired = true
  document.addEventListener('click', e => {
    const ed = e.target.closest('[data-dedit]'); if (ed) { e.stopPropagation(); const [dt, id] = ed.dataset.dedit.split(':'); editDoc(dt, +id); return }
    const dl = e.target.closest('[data-ddel]'); if (dl) { e.stopPropagation(); const [dt, id] = dl.dataset.ddel.split(':'); deleteDoc(dt, +id); return }
    // قرارداد واحد (مورد ۵۴): کلیک روی هر ردیفِ data-voucher = برگهٔ سند، مگر صفحه خودش کنترلش کرده باشد
    const vr = e.target.closest('#view tr[data-voucher]')
    if (vr && !vr.onclick && !e.target.closest('button,a,input,select')) { const [dt, vid] = vr.dataset.voucher.split(':'); showVoucher(dt, +vid) }
  })
}
async function showVoucher(dtype, id) {
  const v = await api(`/api/report/voucher?dtype=${dtype}&id=${id}`).catch(() => null)
  if (!v) return toast('سند یافت نشد', true)
  openModal(`🧾 ${escFa(v.head.no)} — ${esc(v.head.title)}`, `<div class="form">
    <p class="hint">${esc(v.head.typeFa)} · تاریخ ${faDigit(v.head.j)} · مبلغ ${money(v.head.amount)} · ${esc(v.head.meta)}</p>
    <div class="tablewrap"><table class="tx"><thead><tr><th>طرف‌حساب</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th></tr></thead><tbody>
    ${v.lines.map(l => `<tr><td><b>${esc(l.acc)}</b></td><td class="hint">${esc(l.desc)}</td>
      <td class="num ${l.debit ? '' : 'muted'}">${l.debit ? money(l.debit) : '—'}</td>
      <td class="num ${l.credit ? '' : 'muted'}">${l.credit ? money(l.credit) : '—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2">جمع ${v.balanced ? '<span class="amt-in">دو طرف برابر ✓</span>' : '<span class="amt-out">دو طرف برابر نیست!</span>'}</td>
      <td class="num">${money(v.totalDebit)}</td><td class="num">${money(v.totalCredit)}</td></tr></tfoot></table></div></div>`,
    `${isAdmin() && dtype !== 'ftxn' ? '<button class="btn primary" id="vEdit">✏️ ویرایش سند</button><button class="btn del" id="vDel">🗑 حذف سند</button>' : ''}${dtype === 'payment' ? `<button class="btn" data-rcpt="${id}">رسید PDF</button>` : ''}<button class="btn" id="vHist">سابقه</button><button class="btn" id="vCancel">بستن</button>`)
  $('#vCancel').onclick = closeModal
  if ($('#vEdit')) $('#vEdit').onclick = () => { closeModal(); editDoc(dtype, id) }
  if ($('#vDel')) $('#vDel').onclick = () => { closeModal(); deleteDoc(dtype, id) }
  $('#vHist').onclick = guard(() => showDocHistory(dtype === 'invoice' ? 'invoices' : dtype === 'payment' ? 'payments' : 'contractor_invoices', id))
}
const voucherAttr = e => e.inv ? `data-voucher="invoice:${e.inv}"` : e.pid ? `data-voucher="payment:${e.pid}"` : e.cid ? `data-voucher="contractor:${e.cid}"` : (e.refid && e.dtype) ? `data-voucher="${e.dtype}:${e.refid}"` : ''

// ---- دفتر کل (معین هر حساب: واحد/صندوق/پروژه/پیمانکار) ----
REPORTS.gl = async () => {
  const accs = await api('/api/report/ledger-accounts')
  const TYPE_FA = { unit: 'واحد (ساکن)', fund: 'صندوق', project: 'پروژه', contractor: 'پیمانکار' }
  const balCell = v => v > 0 ? `<span class="amt-out">${money(v)}</span>` : v < 0 ? `<span class="amt-in">(${money(-v)})</span>` : '۰'
  const draw = guard(async (type, id, from, to) => {
    const box = $('#glBox')
    if (!id) { box.innerHTML = '<div class="panel"><div class="empty">یک حساب را انتخاب کنید</div></div>'; return }
    box.innerHTML = '<div class="empty">در حال بارگذاری…</div>'
    const d = await api(`/api/report/ledger?type=${type}&id=${encodeURIComponent(id)}&from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`)
    box.innerHTML = `
      <p class="hint">دفتر کل — ${esc(TYPE_FA[type])}: <b>${esc(d.name)}</b> · تاریخ گزارش‌گیری: ${faDigit(jStamp())}${(from || to) ? ' · بازه: ' + (from ? faDigit(from) : '…') + ' تا ' + (to ? faDigit(to) : '…') : ''}</p>
      <div class="kpis">
        ${kpi('جمع بدهکار', money(d.totalDebit))}
        ${kpi('جمع بستانکار', money(d.totalCredit))}
        ${kpi('ماندهٔ نهایی', balCell(d.finalBalance), d.finalBalance > 0 ? 'بدهکار' : d.finalBalance < 0 ? 'بستانکار' : 'تسویه', d.finalBalance > 0 ? 'bad' : '')}
      </div>
      <div class="panel"><div class="tablewrap"><table class="tx">
        <thead><tr><th>تاریخ</th><th>شماره سند</th><th>شرح</th><th>دسته</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th><th class="printhide">عملیات</th></tr></thead><tbody>
        <tr><td class="num">—</td><td class="num">—</td><td><b>ماندهٔ اول دوره</b></td><td class="hint">—</td><td class="num muted">—</td><td class="num muted">—</td><td class="num">${balCell(d.opening)}</td><td class="printhide"></td></tr>
        ${d.rows.length ? d.rows.map(e => { const da = e.inv ? ['invoice', e.inv] : e.pid ? ['payment', e.pid] : e.cid ? ['contractor', e.cid] : (e.refid && e.dtype) ? [e.dtype, e.refid] : null; return `<tr class="${voucherAttr(e) ? 'clickable' : ''}" ${voucherAttr(e)}>
          <td class="num">${e.j === '—' ? 'انتقالی' : faDigit(e.j)}</td><td class="num">${escFa(e.no)}</td>
          <td><b>${esc(e.title)}</b></td><td><span class="catpill">${esc(e.cat)}</span></td>
          <td class="num ${e.debit ? '' : 'muted'}">${e.debit ? money(e.debit) : '—'}</td>
          <td class="num ${e.credit ? '' : 'muted'}">${e.credit ? money(e.credit) : '—'}</td>
          <td class="num">${balCell(e.balance)}</td><td class="printhide rowact">${da ? docActs(da[0], da[1]) : ''}</td></tr>` }).join('') : emptyRow(8, 'تراکنشی در این بازه نیست')}
        </tbody><tfoot><tr><td colspan="4">جمع</td><td class="num">${money(d.totalDebit)}</td><td class="num">${money(d.totalCredit)}</td><td class="num">${balCell(d.finalBalance)}</td><td class="printhide"></td></tr></tfoot>
      </table></div></div>`
    wireCommon()
    box.querySelectorAll('[data-voucher]').forEach(tr => tr.onclick = () => { const [dt, vid] = tr.dataset.voucher.split(':'); showVoucher(dt, +vid) })
  })
  const accOpts = type => (accs[type] || []).map(a => `<option value="${a.id}">${esc(a.label)}</option>`).join('')
  $('#repBody').innerHTML = `
    <div class="filters printhide">
      <label class="f" style="max-width:170px">نوع حساب<select class="inp" id="glType">${Object.keys(TYPE_FA).map(t => `<option value="${t}">${TYPE_FA[t]}</option>`).join('')}</select></label>
      <label class="f" style="max-width:260px">حساب<select class="inp" id="glAcc"><option value="">— انتخاب —</option>${accOpts('unit')}</select></label>
      <label class="f" style="max-width:140px">از تاریخ<input class="inp" id="glFrom" placeholder="۱۴۰۵/۰۱/۰۱"></label>
      <label class="f" style="max-width:140px">تا تاریخ<input class="inp" id="glTo" placeholder="۱۴۰۵/۱۲/۲۹"></label>
      <button class="btn small" id="glPrint">🖨 چاپ رسمی</button><button class="btn small" id="glXls">⬇️ اکسل</button>
    </div>
    <div id="glBox"><div class="panel"><div class="empty">یک حساب را انتخاب کنید</div></div></div>`
  const cur = () => ({ t: $('#glType').value, id: $('#glAcc').value, f: $('#glFrom').value, to: $('#glTo').value })
  $('#glType').onchange = () => { $('#glAcc').innerHTML = `<option value="">— انتخاب —</option>` + accOpts($('#glType').value); $('#glBox').innerHTML = '<div class="panel"><div class="empty">یک حساب را انتخاب کنید</div></div>' }
  $('#glAcc').onchange = () => { const c = cur(); draw(c.t, c.id, c.f, c.to) }
  $('#glFrom').onchange = () => { const c = cur(); if (c.id) draw(c.t, c.id, c.f, c.to) }
  $('#glTo').onchange = () => { const c = cur(); if (c.id) draw(c.t, c.id, c.f, c.to) }
  $('#glXls').onclick = () => { const c = cur(); if (!c.id) return toast('اول حساب را انتخاب کنید', true); location.href = `/api/export/gl?type=${c.t}&id=${encodeURIComponent(c.id)}&from=${encodeURIComponent(c.f || '')}&to=${encodeURIComponent(c.to || '')}` }
  $('#glPrint').onclick = () => { const c = cur(); if (!c.id) return toast('اول حساب را انتخاب کنید', true); printOfficial(`/print/report/gl?type=${c.t}&id=${encodeURIComponent(c.id)}&from=${encodeURIComponent(c.f || '')}&to=${encodeURIComponent(c.to || '')}`, 'دفتر کل') }
}

// ---- دفتر روزنامه ----
REPORTS.journal = async () => {
  const draw = guard(async (f, to, type, fundId, unitId, q) => {
    const d = await api(`/api/report/journal?from=${encodeURIComponent(f || '')}&to=${encodeURIComponent(to || '')}&type=${type || ''}&fundId=${fundId || ''}&unitId=${unitId || ''}&q=${encodeURIComponent(q || '')}`)
    const K = d.kindFa || {}
    const pillCls = { charge: 'b-charge', bill: 'b-open', proj: 'b-settled', exp: 'b-no', pay: 'b-ok', ci: 'b-mgr', ftxn: 'b-open' }
    $('#jnRows').innerHTML = d.rows.length ? d.rows.map(r => `<tr class="clickable" data-voucher="${r.dtype}:${r.id}">
      <td class="num">${faDigit(r.row)}</td><td class="num">${escFa(r.no)}</td><td class="num">${faDigit(r.j)}</td>
      <td><span class="badge ${pillCls[r.kind] || 'b-open'}">${esc(K[r.kind] || r.kind)}</span></td>
      <td>${esc(r.debitAcc)}<br><span class="hint">${esc(r.title)}</span></td>
      <td>${esc(r.creditAcc)}</td>
      <td class="num">${money(r.debit)}</td>
      <td class="num">${money(r.credit)}</td>
      <td class="printhide rowact">${r.dtype === 'ftxn' ? '' : docActs(r.dtype, r.id)}</td></tr>`).join('')
      : emptyRow(9, 'سندی با این فیلتر نیست')
    const c = d.control || { ok: true, funds: [] }
    const trz = c.ok ? '<span class="amt-in"> · خطوط صندوق با موجودی واقعی می‌خواند ✓</span>' : '<span class="amt-out"> · اختلاف با موجودی صندوق‌ها!</span>'
    $('#jnFoot').innerHTML = `<tr><td colspan="6">جمع (${faDigit(d.rows.length)} سند)${trz}</td><td class="num">${money(d.totalDebit)}</td><td class="num">${money(d.totalCredit)}</td><td class="printhide"></td></tr>`
    $('#jnKpis').innerHTML = `${kpi('تعداد اسناد', faDigit(d.rows.length))}${kpi('جمع بدهکار', money(d.totalDebit))}${kpi('جمع بستانکار', money(d.totalCredit))}${kpi('کنترل با صندوق‌ها', c.ok ? 'می‌خواند' : 'اختلاف دارد', c.funds.map(f => f.name + ': ' + (f.diff ? 'اختلاف ' + money(Math.abs(f.diff)) : '✓')).join(' · '), c.ok ? '' : 'bad')}`
    $('#repBody').querySelectorAll('#jnRows [data-voucher]').forEach(tr => tr.onclick = () => { const [dt, vid] = tr.dataset.voucher.split(':'); showVoucher(dt, +vid) })
  })
  const typeOpts = [['', 'همه'], ['charge', 'شارژ ماهانه'], ['bill', 'قبوض و متفرقه'], ['exp', 'هزینهٔ جاری'], ['proj', 'پروژه (عمرانی)'], ['pay', 'دریافتی'], ['ci', 'فاکتور پیمانکار'], ['ftxn', 'انتقال/تسویه/تعدیل صندوق']]
  $('#repBody').innerHTML = `
    <div class="filters printhide">
      <label class="f" style="max-width:130px">از تاریخ<input class="inp" id="jnFrom" placeholder="۱۴۰۵/۰۱/۰۱"></label>
      <label class="f" style="max-width:130px">تا تاریخ<input class="inp" id="jnTo" placeholder="۱۴۰۵/۱۲/۲۹"></label>
      <label class="f" style="max-width:170px">نوع سند<select class="inp" id="jnType">${typeOpts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <label class="f" style="max-width:190px">صندوق<select class="inp" id="jnFund"><option value="">همه</option>${META.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
      <label class="f" style="max-width:190px">واحد<select class="inp" id="jnUnit"><option value="">همه</option>${META.units.filter(u => u.active).map(u => `<option value="${u.id}">واحد ${escFa(u.number)}</option>`).join('')}</select></label>
      <label class="f" style="max-width:160px">جستجو در شرح<input class="inp" id="jnQ" placeholder="مثلاً آب"></label>
      <button class="btn small" id="jnApply">اعمال</button><button class="btn small" id="jnPrint">🖨 چاپ رسمی</button><button class="btn small" id="jnXls">⬇️ اکسل</button>
    </div>
    <p class="hint">هر سند دوطرفه و متوازن است؛ با کلیک، برگهٔ سند با همهٔ طرف‌حساب‌ها باز می‌شود.</p>
    <div class="kpis" id="jnKpis"></div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>ردیف</th><th>شماره سند</th><th>تاریخ</th><th>نوع</th><th>طرف‌حسابِ بدهکار</th><th>طرف‌حسابِ بستانکار</th><th>بدهکار</th><th>بستانکار</th><th class="printhide">عملیات</th></tr></thead>
      <tbody id="jnRows"></tbody><tfoot id="jnFoot"></tfoot>
    </table></div></div>`
  const run = () => draw($('#jnFrom').value, $('#jnTo').value, $('#jnType').value, $('#jnFund').value, $('#jnUnit').value, $('#jnQ').value)
  $('#jnApply').onclick = run
  $('#jnXls').onclick = () => { location.href = '/api/export/journal?' + new URLSearchParams({ from: $('#jnFrom').value, to: $('#jnTo').value, type: $('#jnType').value, fundId: $('#jnFund').value, unitId: $('#jnUnit').value, q: $('#jnQ').value }) }
  $('#jnPrint').onclick = () => printOfficial('/print/report/journal?' + new URLSearchParams({ from: $('#jnFrom').value, to: $('#jnTo').value, type: $('#jnType').value, fundId: $('#jnFund').value, unitId: $('#jnUnit').value, q: $('#jnQ').value }), 'دفتر روزنامه')
  ;['jnType', 'jnFund', 'jnUnit'].forEach(idd => $('#' + idd).onchange = run)
  $('#jnQ').addEventListener('keydown', e => { if (e.key === 'Enter') run() })
  run()
}
REPORTS.invoices = async () => {
  const all = await api('/api/invoices')
  // نوعِ هر فاکتور بر اساس ماهیت، نه فقط صندوق:
  //  - payable (قابل‌پرداخت): هزینه‌ای که از صندوق به فروشنده پرداخت می‌شود (جاری/قبوض/متفرقه)
  //  - billing (صورتحسابِ ساکنین): شارژ ماهانه یا سهمِ مصوبهٔ پروژه؛ اینجا «وصول از ساکنین» معنا دارد
  const fundOpts = `<option value="">همهٔ صندوق‌ها</option>${META.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}`
  const statusCell = i => {
    if (i.payable) {
      if (i.fundUnpaid <= 0) return '<span class="badge b-settled">پرداخت‌شده از صندوق</span>'
      if (i.fundPaid > 0) return '<span class="badge b-open">بخشی پرداخت‌شده</span>'
      return '<span class="badge b-open">پرداخت‌نشده از صندوق</span>'
    }
    return i.remaining > 0 ? '<span class="badge b-open">در حال وصول</span>' : '<span class="badge b-settled">وصول‌شده</span>'
  }
  const fundCell = i => i.payable
    ? `<span class="num ${i.fundUnpaid > 0 ? 'amt-out' : 'amt-in'}">${money(i.fundPaid)}</span>${i.fundUnpaid > 0 ? `<br><span class="hint amt-out">مانده ${money(i.fundUnpaid)}</span>` : ''}`
    : '<span class="hint">—</span>'
  const resCell = i => (i.shareCount > 0 && !i.from_fund)
    ? `<span class="num amt-in">${money(i.collected)}</span>${i.remaining > 0 ? `<br><span class="hint amt-out">بدهی ${money(i.remaining)}</span>` : ''}`
    : '<span class="hint">—</span>'
  // آیا فاکتور تسویه شده؟ هزینهٔ قابل‌پرداخت → پرداخت کاملِ صندوق؛ صورتحسابِ ساکنین → وصولِ کامل
  const isSettled = i => i.payable ? (i.fundUnpaid <= 0) : (i.remaining <= 0)
  const norm = s => enDigit(String(s || '').trim()).replace(/-/g, '/')
  const draw = (fundId, st, detail, from, to) => {
    from = norm(from); to = norm(to)
    let rows = fundId ? all.filter(i => i.fund_id === fundId) : all
    if (st === 'settled') rows = rows.filter(isSettled)
    else if (st === 'open') rows = rows.filter(i => !isSettled(i))
    if (from) rows = rows.filter(i => norm(i.j_date) >= from)
    if (to) rows = rows.filter(i => norm(i.j_date) <= to)
    const amountSum = rows.reduce((a, i) => a + i.amount, 0)
    const fundPaidSum = rows.reduce((a, i) => a + (i.payable ? i.fundPaid : 0), 0)
    const fundUnpaidSum = rows.reduce((a, i) => a + (i.payable ? i.fundUnpaid : 0), 0)
    const resDue = rows.reduce((a, i) => a + ((i.shareCount > 0 && !i.from_fund) ? Math.max(0, i.remaining) : 0), 0)
    $('#repBody').innerHTML = `
      <div class="filters printhide">
        <label class="f" style="max-width:240px">تفکیک بر اساس صندوق<select class="inp" id="invFund">${fundOpts}</select></label>
        <label class="f" style="max-width:200px">وضعیت<select class="inp" id="invStatus">
          <option value="">همه</option><option value="settled">تسویه‌شده</option><option value="open">تسویه‌نشده</option></select></label>
        <label class="f" style="max-width:150px">از تاریخ<input class="inp" id="invFrom" placeholder="۱۴۰۵/۰۱/۰۱" value="${from ? faDigit(from) : ''}"></label>
        <label class="f" style="max-width:150px">تا تاریخ<input class="inp" id="invTo" placeholder="۱۴۰۵/۱۲/۲۹" value="${to ? faDigit(to) : ''}"></label>
        <label class="check" style="margin:0 6px"><input type="checkbox" id="invDetail" ${detail ? 'checked' : ''}> نمایش ریز بدهیِ واحدها</label>
        <a class="btn small" href="/api/export/invoices">⬇️ CSV</a>
        <button class="btn small" id="invPrint">🖨 چاپ / PDF (با فیلترها)</button></div>
      <p class="hint">تاریخ گزارش‌گیری: <b>${faDigit(jStamp())}</b>${(from || to) ? ' · بازه: <b>' + (from ? faDigit(from) : '…') + ' تا ' + (to ? faDigit(to) : '…') + '</b>' : ''}${fundId ? ' · صندوق: <b>' + esc((META.funds.find(f => f.id === fundId) || {}).name || '') + '</b>' : ''}${st ? ' · وضعیت: <b>' + (st === 'settled' ? 'تسویه‌شده' : 'تسویه‌نشده') + '</b>' : ''}</p>
      <div class="kpis">
        ${kpi('جمع فاکتورها', money(amountSum), faDigit(rows.length) + ' فاکتور')}
        ${kpi('پرداخت‌شده از صندوق', money(fundPaidSum), 'هزینه‌هایی که صندوق پرداخته')}
        ${kpi('بدهی به فروشنده', money(fundUnpaidSum), 'مانده‌ی پرداخت از صندوق', fundUnpaidSum > 0 ? 'bad' : '')}
        ${kpi('بدهی ساکنین', money(resDue), 'قبوض/پروژه‌ی وصول‌نشده', resDue > 0 ? 'bad' : '')}</div>
      <div class="panel"><div class="tablewrap"><table class="tx">
        <thead><tr><th>شماره سند</th><th>عنوان</th><th>دسته</th><th>صندوق</th><th>تاریخ</th><th>مبلغ</th><th>پرداخت از صندوق</th><th>وصول از ساکنین</th><th>وضعیت</th></tr></thead><tbody>
        ${rows.length ? rows.map(i => `<tr class="clickable" data-inv="${i.id}"><td class="num"><b>${faDigit(i.id)}</b></td><td><b>${esc(i.title)}</b>${i.from_fund ? ' <span class="badge b-charge">جاری</span>' : ''}</td>
          <td><span class="catpill">${esc(i.categoryName)}</span></td><td class="hint">${esc(i.fundName)}</td>
          <td class="num">${faDigit(i.j_date)}</td><td class="num">${money(i.amount)}</td>
          <td class="num">${fundCell(i)}</td><td class="num">${resCell(i)}</td>
          <td>${statusCell(i)}</td></tr>`).join('') : emptyRow(9, 'فاکتوری با این فیلتر نیست')}
        </tbody></table></div></div>
      <div id="invDetailZone" style="margin-top:12px">${detail ? '<div class="empty">در حال بارگذاری ریز…</div>' : ''}</div>`
    wireCommon()
    $('#invFund').value = fundId || ''
    $('#invStatus').value = st || ''
    const cur = () => ({ f: +$('#invFund').value || 0, s: $('#invStatus').value, d: $('#invDetail').checked, from: $('#invFrom').value, to: $('#invTo').value })
    $('#invFund').onchange = () => { const c = cur(); draw(c.f, c.s, c.d, c.from, c.to) }
    $('#invStatus').onchange = () => { const c = cur(); draw(c.f, c.s, c.d, c.from, c.to) }
    $('#invDetail').onchange = () => { const c = cur(); draw(c.f, c.s, c.d, c.from, c.to) }
    $('#invFrom').onchange = () => { const c = cur(); draw(c.f, c.s, c.d, c.from, c.to) }
    $('#invTo').onchange = () => { const c = cur(); draw(c.f, c.s, c.d, c.from, c.to) }
    $('#invPrint').onclick = () => {
      const qs = `fund=${fundId || 0}&status=${st || ''}&from=${encodeURIComponent(from || '')}&to=${encodeURIComponent(to || '')}`
      const url = `/print/report/invoices?${qs}`
      if (IS_DESKTOP && window.hesabdar && window.hesabdar.savePdf) {
        toast('در حال ساخت PDF…')
        window.hesabdar.savePdf(url, 'گزارش فاکتوری — ریز بدهی واحدها').then(x => toast(x && x.ok ? 'PDF در پوشه‌ی «اسناد صادرشده» ذخیره شد' : 'ناموفق', !(x && x.ok)))
      } else window.open(url + '&print=1', '_blank')
    }
    if (detail) renderDetailZone(rows, fundId)
  }
  // ناحیهٔ ریز: (۱) فهرست فاکتورها بالاست · (۲) بدهیِ هر واحد در یک لیست · (۳) ریزِ فاکتور‌به‌فاکتور
  const renderDetailZone = async (rows, fundId) => {
    const zone = $('#invDetailZone'); if (!zone) return
    const dist = rows.filter(i => i.shareCount > 0 && !i.from_fund)
    const details = await Promise.all(dist.map(async i => { try { return { i, sh: (await api('/api/invoice/' + i.id)).shares || [] } } catch { return { i, sh: [] } } }))
    const occ = s => s.occupied ? (+s.occupants || 0) : 0, com = s => +s.common_units || 0
    // بخش ۲: جمعِ بدهیِ هر واحد به این صندوق (مجموعِ ماندهٔ همهٔ فاکتورهای فیلترشده)
    const byUnit = new Map()
    for (const { sh } of details) for (const s of sh) {
      const u = byUnit.get(s.unit_id) || { number: s.number, name: s.resident_name, share: 0, paid: 0, rem: 0 }
      u.share += s.share_amount; u.paid += s.paid; u.rem += Math.max(0, s.remaining); byUnit.set(s.unit_id, u)
    }
    const units = [...byUnit.values()].sort((a, b) => (parseInt(enDigit(a.number)) || 0) - (parseInt(enDigit(b.number)) || 0))
    const tU = units.reduce((a, u) => ({ share: a.share + u.share, paid: a.paid + u.paid, rem: a.rem + u.rem }), { share: 0, paid: 0, rem: 0 })
    const fundName = fundId ? ((META.funds.find(f => f.id === fundId) || {}).name || '') : 'همهٔ صندوق‌ها'
    const unitList = `<div class="panel"><div class="phead"><b>۲) بدهیِ هر واحد به ${esc(fundName)}</b><span class="hint">مجموعِ ماندهٔ فاکتورهای این فیلتر</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th><th>جمع سهم</th><th>پرداخت‌شده</th><th>بدهیِ مانده</th></tr></thead><tbody>
      ${units.length ? units.map(u => `<tr><td><b>${escFa(u.number)}</b></td><td>${esc(u.name || '—')}</td><td class="num">${money(u.share)}</td>
        <td class="num amt-in">${money(u.paid)}</td><td class="num ${u.rem > 0 ? 'amt-out' : ''}">${u.rem > 0 ? money(u.rem) : '۰'}</td></tr>`).join('') : emptyRow(5, 'واحدی نیست')}
      </tbody><tfoot><tr><td colspan="2">جمع کل</td><td class="num">${money(tU.share)}</td><td class="num">${money(tU.paid)}</td><td class="num">${money(tU.rem)}</td></tr></tfoot></table></div></div>`
    // بخش ۳: ریزِ فاکتور‌به‌فاکتور با ستون‌های مبنای محاسبه
    const blocks = details.map(({ i, sh }) => {
      let mc = { head: '', cell: () => '', note: '' }
      if (i.method === 'occ_common') { const w = sh.reduce((a, s) => a + occ(s) + com(s), 0); mc = { head: '<th>نفرات</th><th>مشاعات</th><th>ضریب</th>', note: ` · هر سهم = مبلغ × (نفرات+مشاعات) ÷ ${faDigit(w)}`, cell: s => `<td class="num">${faDigit(occ(s))}</td><td class="num">${faDigit(com(s))}</td><td class="num">${faDigit(occ(s) + com(s))}</td>` } }
      else if (i.method === 'occupants') { const w = sh.reduce((a, s) => a + occ(s), 0); mc = { head: '<th>نفرات</th>', note: ` · هر سهم = مبلغ × نفرات ÷ ${faDigit(w)}`, cell: s => `<td class="num">${faDigit(occ(s))}</td>` } }
      else if (i.method === 'area') { const w = sh.reduce((a, s) => a + (+s.area || 0), 0); mc = { head: '<th>متراژ</th>', note: ` · هر سهم = مبلغ × متراژ ÷ ${faDigit(w)}`, cell: s => `<td class="num">${faDigit(s.area || 0)}</td>` } }
      else if (i.method === 'equal') mc = { head: '', note: ` · هر سهم = مبلغ ÷ ${faDigit(sh.length)}`, cell: () => '' }
      return `<div class="panel"><div class="phead"><b>سند ${faDigit(i.id)} — ${esc(i.title)}</b> <span class="hint">${money(i.amount)} · ${faDigit(i.j_date)}</span></div>
        <div style="padding:0 12px 10px"><div class="hint" style="margin:4px 0">روشِ محاسبه: <b>${esc(i.methodFa)}</b> · بین ${faDigit(sh.length)} واحد${mc.note}</div>
        <div class="tablewrap"><table class="tx"><thead><tr><th>واحد</th><th>ساکن</th>${mc.head}<th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
        ${sh.map(s => `<tr><td><b>${escFa(s.number)}</b></td><td>${esc(s.resident_name || '—')}</td>${mc.cell(s)}<td class="num">${money(s.share_amount)}</td>
          <td class="num amt-in">${money(s.paid)}</td><td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${s.remaining > 0 ? money(s.remaining) : '۰'}</td></tr>`).join('')}
        </tbody></table></div></div></div>`
    }).join('')
    zone.innerHTML = unitList + `<h3 style="margin:14px 0 6px">۳) ریزِ فاکتور‌به‌فاکتور</h3>` + (blocks || '<div class="empty">فاکتورِ تسهیمی‌ای نیست</div>')
  }
  const defFund = (META.funds.find(f => f.bucket === 'omrani') || META.funds.find(f => /قبوض|متفرقه/.test(f.name)) || {}).id || 0
  draw(defFund, '', false, '', '')
}
REPORTS.fundpay = async () => {
  const r = await api('/api/report/fundpay')
  $('#repBody').innerHTML = `
    <div class="filters printhide"><button class="btn small" onclick="printAs('گزارش پرداخت صندوق‌ها')">🖨 چاپ</button></div>
    <div class="kpis">${kpi('جمع پرداخت از صندوق‌ها', money(r.total), faDigit(r.rows.length) + ' پرداخت')}
      ${kpi('هزینه‌های پرداخت‌نشده', money(r.unpaidTotal), 'بدهی صندوق به فاکتورها', r.unpaidTotal > 0 ? 'bad' : '')}</div>
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
  const bal = v => v > 0 ? `<span class="amt-out">بدهکار ${money(v)}</span>` : v < 0 ? `<span class="amt-in">پیش‌پرداخت ${money(-v)}</span>` : 'تسویه'
  const sect = (title, data, isProj) => {
    const rows = data.rows
    return `<div class="panel"><div class="phead"><b>${title}</b><span class="hint strong">${isProj ? bal(data.total) : (data.total > 0 ? `<span class="amt-out">بدهکار ${money(data.total)}</span>` : 'تسویه')}</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>${isProj ? 'پروژه' : 'عنوان'}</th><th>تاریخ</th><th>${isProj ? 'سهم (مصوبه)' : 'سهم'}</th><th>پرداختی</th><th>${isProj ? 'بدهی/طلب' : 'مانده'}</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr><td>${esc(r.title)}</td><td class="num">${r.j_date ? faDigit(r.j_date) : '—'}</td>
        <td class="num">${money(r.share)}</td><td class="num amt-in">${money(r.paid)}</td>
        <td class="num">${isProj ? bal(r.balance) : (r.remaining > 0 ? `<span class="amt-out">${money(r.remaining)}</span>` : 'تسویه')}</td></tr>`).join('') : emptyRow(5, 'موردی نیست')}
      </tbody></table></div></div>`
  }
  const draw = async id => {
    const box = $('#ruBox'); if (!id) { box.innerHTML = '<div class="panel"><div class="empty">یک واحد را انتخاب کنید</div></div>'; return }
    box.innerHTML = '<div class="empty">در حال بارگذاری…</div>'
    const d = await api('/api/report/unit-statement?unitId=' + id)
    const net = d.charge.total + d.omrani.total + d.projects.total
    box.innerHTML = `
      <div class="kpis">
        ${kpi('بدهی شارژ (جاری)', money(d.charge.total), '', d.charge.total > 0 ? 'bad' : '')}
        ${kpi('بدهی قبوض و متفرقه', money(d.omrani.total), 'آب/برق/گاز و جزئی', d.omrani.total > 0 ? 'bad' : '')}
        ${kpi('پروژه‌ها (عمرانی)', bal(d.projects.total), 'بدهی/طلب', '')}
        ${kpi('جمع خالص', bal(net), '', net > 0 ? 'bad' : '')}
      </div>
      ${sect('شارژ ماهانه (جاری)', d.charge, false)}
      ${sect('قبوض و متفرقه (آب/برق/گاز…)', d.omrani, false)}
      ${sect('پروژه‌های عمرانی', d.projects, true)}`
  }
  $('#repBody').innerHTML = `<div class="filters printhide"><select class="inp" id="ruSel"><option value="">— واحد را انتخاب کنید —</option>
      ${units.map(u => `<option value="${u.id}">واحد ${escFa(u.number)}${u.resident_name ? ' — ' + esc(u.resident_name) : ''}</option>`).join('')}</select>
      <button class="btn small" onclick="printAs('صورت‌حساب واحد')">🖨 چاپ</button>
      <button class="btn small" id="ruFull">کارت کامل واحد</button></div>
    <div id="ruBox"><div class="panel"><div class="empty">یک واحد را انتخاب کنید</div></div></div>`
  $('#ruSel').onchange = guard(() => draw(+$('#ruSel').value || 0))
  $('#ruFull').onclick = () => { if ($('#ruSel').value) showUnitCard(+$('#ruSel').value) }
}
REPORTS.balance = async () => {
  const h = await api('/api/report/balance')
  $('#repBody').innerHTML = `
    <div class="notice ${h.ok ? '' : 'danger'}" >
      <span>${h.ok ? 'همهٔ آزمون‌های سلامت دفاتر درست است؛ هیچ ریالی گم یا دوبار شمرده نشده.' : 'یک یا چند آزمون ایراد دارد. ردیف‌های مشکل‌دار در زیر آمده‌اند.'}</span></div>
    <div class="panel"><div class="phead"><b>آزمون‌ها</b><span class="hint">${faDigit(h.checks.filter(c => c.ok).length)} از ${faDigit(h.checks.length)} سالم</span></div>
      ${h.checks.map(c => `<div class="hrow"><span class="hmark ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'}</span>
        <div class="hbody"><b>${esc(c.title)}</b>${c.ok ? '' : ` <span class="amt-out">— ${faDigit(c.count)} مورد</span>
          <ul class="hlist">${c.items.map(i => `<li>${escFa(i.text)}</li>`).join('')}</ul>${c.hint ? `<div class="hint">${esc(c.hint)}</div>` : ''}`}</div></div>`).join('')}
    </div>
    <div class="kpis">${kpi('جمع بدهیِ خالصِ واحدها', signed(h.totals.netDebt))}${kpi('جمع سهم‌ها', money(h.totals.totalShares))}${kpi('جمع دریافتی‌ها', money(h.totals.totalPayments))}${kpi('موجودی کل صندوق‌ها', money(h.totals.funds.reduce((a, f) => a + f.balance, 0)))}</div>`
}
// سابقهٔ تغییرات: چه کسی، کی، چه سندی را ثبت/ویرایش/حذف کرد و چرا
const AUD_FIELDS = { amount: 'مبلغ', title: 'عنوان', j_date: 'تاریخ', fund_id: 'صندوق', unit_id: 'واحد', method: 'روش تقسیم', note: 'توضیح', paid_amount: 'پرداخت‌شده', vendor_name: 'پیمانکار', opening_balance: 'موجودی اولیه', name: 'نام', _fundPaid: 'پرداخت از صندوق' }
const audFmt = (k, v) => v == null ? '—' : (k === 'amount' || k === 'paid_amount' || k === 'opening_balance' || k === '_fundPaid') ? money(v) : k === 'fund_id' ? esc((META.funds.find(f => f.id === v) || {}).name || v) : k === 'unit_id' ? 'واحد ' + escFa((META.units.find(u => u.id === v) || {}).number || v) : escFa(String(v))
function audDetail(r) {
  if (r.action === 'حذف' && r.before) return Object.keys(AUD_FIELDS).filter(k => r.before[k] != null && r.before[k] !== '').map(k => `${AUD_FIELDS[k]}: ${audFmt(k, r.before[k])}`).join(' · ')
  if (r.before && r.after) { const ch = Object.keys(AUD_FIELDS).filter(k => JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k])); return ch.length ? ch.map(k => `${AUD_FIELDS[k]}: ${audFmt(k, r.before[k])} ← ${audFmt(k, r.after[k])}`).join(' · ') : 'بدون تغییر در مبلغ/تاریخ/طرف‌حساب' }
  if (r.body) return Object.keys(AUD_FIELDS).filter(k => r.body[k] != null && r.body[k] !== '').map(k => `${AUD_FIELDS[k]}: ${audFmt(k, r.body[k])}`).join(' · ') || ''
  return ''
}
const audTable = rows => `<div class="tablewrap"><table class="tx"><thead><tr><th>زمان</th><th>کاربر</th><th>عمل</th><th>سند</th><th>جزئیات</th><th>علت</th></tr></thead><tbody>
  ${rows.length ? rows.map(r => `<tr><td class="num">${faDigit(new Date(r.at).toLocaleString('fa-IR'))}</td><td>${esc(r.user_name || '—')}</td>
    <td><span class="catpill ${r.action === 'حذف' ? 'amt-out' : ''}">${esc(r.action)}</span></td><td>${esc(r.label || '')}${r.entity_id ? ' ' + faDigit(r.entity_id) : ''}</td>
    <td class="hint">${audDetail(r)}</td><td>${esc(r.reason || '')}</td></tr>`).join('') : emptyRow(6, 'هنوز تغییری ثبت نشده')}</tbody></table></div>`
REPORTS.audit = async () => {
  const draw = guard(async act => {
    const rows = await api('/api/audit?limit=300' + (act ? '&action=' + encodeURIComponent(act) : ''))
    $('#audBox').innerHTML = audTable(rows)
  })
  $('#repBody').innerHTML = `<div class="filters printhide"><label class="f" style="max-width:200px">نوع عمل<select class="inp" id="audAct"><option value="">همه</option><option>ثبت</option><option>ویرایش</option><option>حذف</option><option>پرداخت</option><option>تعدیل</option></select></label>
    <button class="btn small" onclick="printAs('سابقهٔ تغییرات')">🖨 چاپ</button></div>
    <p class="hint">هر ثبت، ویرایش و حذفِ سندِ مالی با نامِ کاربر، زمان و وضعیتِ قبل و بعد در اینجا می‌ماند و قابل پاک کردن نیست.</p>
    <div class="panel" id="audBox"><div class="empty">در حال بارگذاری…</div></div>`
  $('#audAct').onchange = e => draw(e.target.value)
  draw('')
}
async function showDocHistory(entity, id) {
  const rows = await api(`/api/audit?entity=${entity}&entityId=${id}`)
  openModal('سابقهٔ این سند', audTable(rows), `<button class="btn" id="dhClose">بستن</button>`)
  $('#dhClose').onclick = closeModal
}
REPORTS.projects = async () => {
  const rows = await api('/api/report/projects')
  const t = rows.reduce((a, p) => ({ budget: a.budget + p.budget, sel: a.sel + p.selectedAmount, inv: a.inv + p.invoiceTotal, paid: a.paid + p.invoicePaid }), { budget: 0, sel: 0, inv: 0, paid: 0 })
  $('#repBody').innerHTML = `
    <div class="filters printhide"><button class="btn small" onclick="printAs('گزارش پروژه‌ها')">🖨 چاپ</button></div>
    <div class="kpis">${kpiN('پروژه‌ها', faDigit(rows.length))}${kpi('جمع بودجه مصوب', money(t.budget))}
      ${kpi('جمع فاکتور پیمانکار', money(t.inv))}${kpi('پرداخت‌شده', money(t.paid))}</div>
    <div class="panel"><div class="tablewrap"><table class="tx">
      <thead><tr><th>پروژه</th><th>وضعیت</th><th>بودجه مصوب</th><th>استعلام</th><th>مبلغ انتخابی</th><th>فاکتور</th><th>جمع فاکتور</th><th>پرداخت‌شده</th></tr></thead><tbody>
      ${rows.length ? rows.map(p => `<tr class="clickable" data-proj="${p.id}"><td><b>${esc(p.title)}</b></td><td><span class="badge ${projStatusCls(p.status)}">${esc(p.statusFa)}</span></td>
        <td class="num">${money(p.budget)}</td><td class="num">${faDigit(p.quoteCount)}</td><td class="num amt-in">${money(p.selectedAmount)}</td>
        <td class="num">${faDigit(p.invoiceCount)}</td><td class="num amt-out">${money(p.invoiceTotal)}</td><td class="num">${money(p.invoicePaid)}</td></tr>`).join('') : emptyRow(8, 'پروژه‌ای ثبت نشده')}
      </tbody></table></div></div>`
  document.querySelectorAll('[data-proj]').forEach(c => c.onclick = () => showProject(+c.dataset.proj))
}
REPORTS.vendors = async () => {
  const rows = await api('/api/report/vendors')
  $('#repBody').innerHTML = `
    <div class="filters printhide"><button class="btn small" onclick="printAs('گزارش پیمانکاران')">🖨 چاپ</button></div>
    <div class="panel"><div class="phead"><b>عملکرد پیمانکاران</b><span class="hint">مجموع استعلام‌ها و فاکتورهای بایگانی‌شده‌ی هر پیمانکار</span></div>
      <div class="tablewrap"><table class="tx">
      <thead><tr><th>پیمانکار</th><th>زمینه</th><th>تلفن</th><th>استعلام</th><th>جمع استعلام</th><th>فاکتور</th><th>جمع فاکتور</th><th>پرداخت‌نشده</th></tr></thead><tbody>
      ${rows.length ? rows.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.field || '—')}</td><td class="num">${faDigit(v.phone || '—')}</td>
        <td class="num">${faDigit(v.quoteCount)}</td><td class="num">${money(v.quoteTotal)}</td>
        <td class="num">${faDigit(v.invoiceCount)}</td><td class="num amt-out">${money(v.invoiceTotal)}</td><td class="num ${v.invoiceUnpaid > 0 ? 'amt-out' : ''}">${money(v.invoiceUnpaid)}</td></tr>`).join('') : emptyRow(8, 'پیمانکاری ثبت نشده')}
      </tbody></table></div></div>`
}

// ==================== تنظیمات ====================
let setTab = 'general'
VIEWS.settings = async () => {
  if (!isAdmin()) { $('#view').innerHTML = head('تنظیمات', '') + '<div class="panel"><div class="empty">شما دسترسی فقط-مشاهده دارید</div></div>'; return }
  const tabs = [['general', 'عمومی'], ['charge', 'شارژ ماهانه'], ['recurring', 'هزینه‌های دوره‌ای'], ['categories', 'دسته‌های هزینه'], ['funds', 'صندوق‌ها'],
  ['openings', 'مانده اولیه'], ['close', 'بستن دوره'], ['handover', 'تحویل مدیریت'], ['users', 'کاربران'], ['backup', 'پشتیبان و آپدیت']]
  $('#view').innerHTML = head('تنظیمات', 'همه‌ی مقادیر قابل سفارشی‌سازی است') +
    `<div class="filters"><div class="chips">${tabs.map(([v, t]) => `<button class="chip ${setTab === v ? 'on' : ''}" data-set="${v}">${t}</button>`).join('')}</div></div>
     <div id="setBody"><div class="empty">در حال بارگذاری…</div></div>`
  document.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { setTab = b.dataset.set; render() })
  await SETTINGS[setTab]()
}
const SETTINGS = {}
SETTINGS.close = async () => {
  const d = await api('/api/period/closes'), st = await api('/api/settings')
  const MN = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>بستن دوره</b><span class="hint strong">${d.lockDateJ ? 'بسته تا ' + faDigit(d.lockDateJ) : 'هیچ دوره‌ای بسته نشده'}</span></div>
      <p class="sub">بعد از بستن، هیچ سندی با تاریخِ آن روز یا قبل از آن ثبت، ویرایش یا حذف نمی‌شود؛ پس گزارشی که برای هیئت‌مدیره چاپ شده، فردا هم همان عدد را نشان می‌دهد. مانده‌های همان روز هم ذخیره می‌شود.</p>
      <div class="form" style="max-width:520px">
        <label class="f">بستن تا تاریخ (معمولاً آخرین روزِ ماه) ${dateBoxHtml('pcd')}</label>
        <div class="fbtns"><button class="btn primary" id="pcGo">بستن دوره</button>${d.lockDateJ ? '<button class="btn" id="pcOpen">بازکردنِ آخرین دوره</button>' : ''}</div></div></div>
    <div class="panel"><div class="phead"><b>سال مالی</b></div><div class="form" style="max-width:520px">
      <label class="f">شروع سال مالی<select class="inp" id="fyStart">${MN.map((m, i) => `<option value="${i + 1}" ${st.fiscalStartMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <span class="hint">گزارش سالانه (درآمد و هزینه ۱۲ ماهه و مقایسه با سال قبل) بر اساس همین ماه ساخته می‌شود.</span></label>
      <div class="fbtns"><button class="btn" id="fySave">ذخیره</button></div></div></div>
    <div class="panel"><div class="phead"><b>سابقهٔ بستن دوره</b></div><div class="tablewrap"><table class="tx">
      <thead><tr><th>تا تاریخ</th><th>موجودی صندوق‌ها</th><th>بدهی ساکنین</th><th>بست</th><th>وضعیت</th></tr></thead><tbody>
      ${d.closes.length ? d.closes.map(c => `<tr><td class="num"><b>${faDigit(c.j_date)}</b></td><td class="num">${money(c.snapshot.fundTotal || 0)}</td><td class="num">${money(c.snapshot.unitDebt || 0)}</td>
        <td>${esc(c.by_name || '—')}</td><td>${c.reopened_at ? `<span class="badge b-open">بازشده</span> <span class="hint">${esc(c.reopen_reason)}${c.reopen_name ? ' — ' + esc(c.reopen_name) : ''}</span>` : '<span class="badge b-settled">بسته</span>'}</td></tr>`).join('') : emptyRow(5, 'هنوز دوره‌ای بسته نشده')}
      </tbody></table></div></div>`
  wireToday($('#setBody'))
  $('#pcGo').onclick = guard(async () => {
    const t = readDate('pcd'); if (!t.jy || !t.jm || !t.jd) throw new Error('تاریخ را کامل وارد کنید')
    confirmBox(`دوره تا ${faDigit(t.jy)}/${faDigit(t.jm)}/${faDigit(t.jd)} بسته شود؟ بعد از آن، سندهای این بازه قابل تغییر نیستند (مگر با بازکردن و ثبت علت).`,
      async () => { await post('/api/period/close', t); toast('دوره بسته شد'); render() }, 'بستن دوره')
  })
  if ($('#pcOpen')) $('#pcOpen').onclick = () => confirmReason('آخرین دورهٔ بسته باز شود؟ این کار با نام شما و علتش ثبت می‌شود.',
    async r => { await post('/api/period/reopen', { reason: r }); toast('دوره باز شد'); render() })
  $('#fySave').onclick = guard(async () => { await post('/api/settings', { fiscalStartMonth: +$('#fyStart').value }); toast('ذخیره شد') })
}
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
    <div class="phead" style="margin-top:10px;padding:0"><b>اطلاعات واریز</b><span class="hint">در پیام واتساپ و صورت‌حساب بدهکاران می‌آید</span></div>
    <label class="f">شماره کارت<input class="inp num" id="sgCard" dir="ltr" inputmode="numeric" placeholder="۶۰۳۷-....-....-...." value="${esc(s.payCard || '')}"></label>
    <label class="f">شماره شبا<input class="inp num" id="sgIban" dir="ltr" placeholder="IR.." value="${esc(s.payIban || '')}"></label>
    <label class="f">صاحب حساب<input class="inp" id="sgHolder" value="${esc(s.payHolder || '')}"></label>
    <label class="f">مهلت پرداخت شارژ (روزِ ماه)<input class="inp num" id="sgDue" inputmode="numeric" placeholder="مثلاً ۱۰" value="${s.payDueDay ? faDigit(s.payDueDay) : ''}"><span class="hint">خالی = بدون مهلت مشخص</span></label>
    <div class="fbtns"><button class="btn primary" id="sgSave">ذخیره</button></div></div></div>`
  let unit = s.displayUnit
  document.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => {
    unit = b.dataset.unit; document.querySelectorAll('[data-unit]').forEach(x => x.classList.toggle('on', x === b))
  })
  $('#sgSave').onclick = guard(async () => {
    const iban = enDigit($('#sgIban').value).replace(/\s/g, '').toUpperCase()
    if (iban && !/^IR\d{24}$/.test(iban)) throw new Error('شماره شبا باید با IR شروع شود و ۲۴ رقم داشته باشد')
    const card = enDigit($('#sgCard').value).replace(/\D/g, '')
    if (card && card.length !== 16) throw new Error('شماره کارت باید ۱۶ رقم باشد')
    await post('/api/settings', { buildingName: $('#sgName').value.trim(), displayUnit: unit, totalUnits: +enDigit($('#sgTotal').value) || 0,
      payCard: card, payIban: iban, payHolder: $('#sgHolder').value.trim(), payDueDay: +enDigit($('#sgDue').value) || 0 })
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
  document.querySelectorAll('[data-issue]').forEach(b => b.onclick = guard(() => chargeIssueFlow([b.dataset.issue])))
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
      <div class="tablewrap"><table class="tx"><thead><tr><th>نام دسته</th><th>روش تقسیم پیش‌فرض</th><th>واحد خالی سهم می‌دهد؟</th><th>صندوق</th><th>بودجهٔ ماهانه</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${cats.map(c => `<tr><td><b>${esc(c.name)}</b>${c.is_charge_cat ? ' <span class="badge b-charge">شارژ ماهانه</span>' : ''}</td>
        <td><span class="catpill">${esc(c.methodFa)}</span></td><td>${c.include_vacant ? '✔ بله' : '— خیر'}</td>
        <td>${esc((fundById(c.default_fund_id) || {}).name || '—')}</td><td class="num">${c.budget_monthly ? money(c.budget_monthly) : '—'}</td>
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
    ${c && c.is_charge_cat ? '' : `<label class="f">بودجهٔ ماهانه (${curFa()}، اختیاری)<input class="inp num" id="ctBudget" data-money="ctBH" inputmode="numeric" value="${c && c.budget_monthly ? sep(Math.round(r2d(c.budget_monthly))) : ''}"><span class="hint" id="ctBH">برای گزارش «بودجه در برابر واقعی» و شارژ پیشنهادی</span></label>`}
    <label class="check"><input type="checkbox" id="ctVacant" ${c && c.include_vacant ? 'checked' : ''}> واحدهای خالی هم از این دسته سهم بدهند</label>
    ${c ? `<label class="check"><input type="checkbox" id="ctActive" ${c.active ? 'checked' : ''}> دسته فعال است</label>` : ''}</div>`,
    `<button class="btn primary" id="ctSave">ذخیره</button><button class="btn" id="ctCancel">انصراف</button>`)
  wireMoney($('#modalBody'))
  $('#ctCancel').onclick = closeModal
  $('#ctSave').onclick = guard(async () => {
    const p = { name: $('#ctName').value.trim(), defaultMethod: $('#ctMethod').value, defaultFundId: +$('#ctFund').value, includeVacant: $('#ctVacant').checked }
    if ($('#ctBudget')) p.budgetMonthly = readMoney($('#ctBudget'))
    if (!p.name) throw new Error('نام دسته را وارد کنید')
    if (c) { p.active = $('#ctActive').checked; await post(`/api/categories/${c.id}`, p, 'PATCH') } else await post('/api/categories', p)
    closeModal(); toast('ذخیره شد'); refresh()
  })
}
SETTINGS.funds = async () => {
  const funds = await api('/api/funds')
  $('#setBody').innerHTML = `<div class="panel"><div class="phead"><b>صندوق‌ها</b><button class="btn small primary" id="newFund">＋ صندوق جدید</button></div>
    <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>نقش</th><th>موجودی اولیه</th><th>موجودی فعلی</th><th></th></tr></thead><tbody>
    ${funds.map(f => `<tr><td><b>${esc(f.name)}</b></td><td><span class="catpill">${esc((META.fundBuckets.find(b => b.value === f.bucket) || {}).fa || '—')}</span></td>
      <td class="num">${money(f.opening_balance)}</td><td class="num"><b>${money(f.balance)}</b></td>
      <td class="rowact"><button class="mini-btn" data-editfund="${f.id}">ویرایش</button><button class="mini-btn" data-adjfund="${f.id}">سند تعدیل</button><button class="del" data-delfund="${f.id}">🗑</button></td></tr>`).join('')}
    </tbody></table></div></div>`
  $('#newFund').onclick = () => fundForm()
  document.querySelectorAll('[data-editfund]').forEach(b => b.onclick = () => fundForm(funds.find(f => f.id === +b.dataset.editfund)))
  document.querySelectorAll('[data-adjfund]').forEach(b => b.onclick = () => fundAdjustForm(funds.find(f => f.id === +b.dataset.adjfund)))
  document.querySelectorAll('[data-delfund]').forEach(b => b.onclick = () => confirmBox('این صندوق حذف شود؟',
    async () => { await api(`/api/funds/${b.dataset.delfund}`, { method: 'DELETE' }); toast('صندوق حذف شد'); refresh() }))
}
function fundForm(f) {
  const body = openModal(f ? 'ویرایش صندوق' : 'صندوق جدید', `<div class="form">
    <label class="f">نام صندوق<input class="inp" id="fnName" value="${esc(f ? f.name : '')}" placeholder="مثلاً: صندوق آسانسور"></label>
    <label class="f">نقشِ صندوق<select class="inp" id="fnBucket">${META.fundBuckets.map(k => `<option value="${k.value}" ${f && f.bucket === k.value ? 'selected' : ''}>${esc(k.fa)}</option>`).join('')}</select>
      <span class="hint">مشخص می‌کند دریافتی و هزینهٔ کدام دسته به این صندوق برود. پس از اولین گردش قفل می‌شود.</span></label>
    <input type="hidden" id="fnKind" value="${f ? f.kind : 'custom'}">
    <label class="f">موجودی اولیه (${curFa()})<input class="inp num" id="fnOpen" data-money="fnHint" inputmode="numeric" value="${f ? sep(Math.round(r2d(f.opening_balance))) : ''}"><span class="hint" id="fnHint"></span></label></div>`,
    `<button class="btn primary" id="fnSave">ذخیره</button><button class="btn" id="fnCancel">انصراف</button>`)
  wireMoney(body); $('#fnCancel').onclick = closeModal
  $('#fnSave').onclick = guard(async () => {
    const p = { name: $('#fnName').value.trim(), kind: $('#fnKind').value, bucket: $('#fnBucket').value, openingBalance: readMoney($('#fnOpen')) }
    if (!p.name) throw new Error('نام صندوق را وارد کنید')
    if (f) await post(`/api/funds/${f.id}`, p, 'PATCH'); else await post('/api/funds', p)
    closeModal(); toast('ذخیره شد'); refresh()
  })
}
// سند تعدیلِ صندوق: اصلاحِ موجودی با علت و تاریخ (به‌جای دستکاریِ موجودیِ اولیه)
function fundAdjustForm(f) {
  const body = openModal('سند تعدیل — ' + f.name, `<div class="form">
    <p class="hint">برای اصلاحِ اختلافِ موجودیِ صندوق با پولِ واقعی (مثلاً شمارش نقدی یا صورت‌حساب بانک). این سند در گردشِ صندوق و دفتر روزنامه دیده می‌شود.</p>
    <div class="frow"><label class="f">نوع<select class="inp" id="adDir"><option value="1">افزایشِ موجودی</option><option value="-1">کاهشِ موجودی</option></select></label>
      <label class="f">مبلغ (${curFa()})<input class="inp num" id="adAmt" data-money="adHint" inputmode="numeric"><span class="hint" id="adHint"></span></label></div>
    <label class="f">علتِ تعدیل<input class="inp" id="adNote" placeholder="مثلاً: اختلاف شمارش صندوق با دفتر"></label>
    <label class="f">تاریخ${dateBoxHtml('ad')}</label></div>`,
    `<button class="btn primary" id="adSave">ثبت سند تعدیل</button><button class="btn" id="adCancel">انصراف</button>`)
  wireMoney(body); wireToday(body); $('#adCancel').onclick = closeModal
  $('#adSave').onclick = guard(async () => {
    const amt = readMoney($('#adAmt')); if (!(amt > 0)) throw new Error('مبلغ را وارد کنید')
    await post(`/api/funds/${f.id}/adjust`, { amount: amt * +$('#adDir').value, note: $('#adNote').value.trim(), ...readDate('ad') })
    closeModal(); toast('سند تعدیل ثبت شد'); refresh()
  })
}
SETTINGS.openings = async () => {
  const d = await api('/api/openings')
  $('#setBody').innerHTML = `
    <div class="notice info">مانده‌ی اولیه یعنی وضعیت مالی «قبل از شروع کار با نرم‌افزار». بدهی اولیه مثل قدیمی‌ترین بدهی رفتار می‌کند و اول از همه تسویه می‌شود.</div>
    <div class="panel"><div class="phead"><b>بدهی/پیش‌پرداخت اولیه‌ی واحدها</b><span class="hint">مثبت = بدهی · منفی = پیش‌پرداخت</span></div>
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
  const seclog = await api('/api/security-log').catch(() => [])
  const st = await api('/api/settings')
  $('#setBody').innerHTML = `
    <div class="panel"><div class="phead"><b>دسترسی از شبکه</b></div>
      <label class="check"><input type="checkbox" id="lanAcc" ${st.lanAccess !== false ? 'checked' : ''}> اجازهٔ ورود از گوشی و کامپیوترهای دیگرِ همین شبکه (وای‌فای)</label>
      <p class="hint" style="margin:6px 0 0">اگر فقط روی همین کامپیوتر کار می‌کنید خاموشش کنید. ورود با ۵ رمزِ اشتباه ۱۵ دقیقه قفل می‌شود و با تغییر رمز، بقیهٔ دستگاه‌ها از حساب خارج می‌شوند.</p></div>
    <div class="panel"><div class="phead"><b>کاربران</b><button class="btn small primary" id="newUser">＋ کاربر جدید</button></div>
      <p class="sub">رئیس هیئت مدیره و بازرس فقط مشاهده می‌کنند — امکان ثبت، ویرایش یا حذف ندارند (هم در رابط و هم در سرور).</p>
      <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th>کد بازیابی</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td><b>${esc(u.display_name)}</b></td><td class="num">${esc(u.username)}</td>
        <td><span class="catpill">${esc(u.roleFa)}</span></td>
        <td>${u.active ? '<span class="badge b-settled">فعال</span>' : '<span class="badge b-vacant">معلق</span>'}</td>
        <td>${u.hasRecovery ? '<span class="badge b-settled">دارد</span>' : '<span class="badge b-open">ندارد</span>'} <button class="mini-btn" data-genrc="${u.id}">تولید کد</button></td>
        <td><button class="mini-btn" data-edituser="${u.id}">ویرایش</button>
          <button class="mini-btn" data-tog="${u.id}" data-act="${u.active ? 0 : 1}">${u.active ? 'تعلیق' : 'فعال‌سازی'}</button>
          <button class="mini-btn" data-pw="${u.id}">تغییر رمز</button>
          ${u.id === ME.id ? '' : `<button class="del" data-deluser="${u.id}">🗑</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>رویدادهای امنیتی</b><span class="hint">۲۰ رویداد آخر</span></div>
      ${seclog.length ? `<div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>رویداد</th><th>کاربر</th><th>جزئیات</th></tr></thead><tbody>
        ${seclog.map(s => `<tr><td class="num">${faDigit(s.j_date)}</td><td>${esc(s.eventFa)}</td><td class="num">${esc(s.username || '—')}</td><td class="hint">${esc(s.detail || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">رویدادی ثبت نشده است</div>'}</div>`
  $('#lanAcc').onchange = guard(async () => { await post('/api/settings', { lanAccess: $('#lanAcc').checked }); toast($('#lanAcc').checked ? 'دسترسی از شبکه روشن شد' : 'دسترسی از شبکه خاموش شد') })
  $('#newUser').onclick = () => userForm()
  document.querySelectorAll('[data-genrc]').forEach(b => b.onclick = guard(async () => {
    const r = await post('/api/auth/recovery/regenerate', { userId: +b.dataset.genrc })
    showRecoveryCode(r.code, { isNew: true, onDone: () => refresh() })
  }))
  document.querySelectorAll('[data-tog]').forEach(b => b.onclick = guard(async () => {
    await post(`/api/users/${b.dataset.tog}`, { active: +b.dataset.act === 1 }, 'PATCH'); refresh()
  }))
  document.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => {
    openModal('تغییر رمز', `<div class="form"><label class="f">رمز جدید<input class="inp" id="pwNew" type="password"></label></div>`,
      `<button class="btn primary" id="pwSave">ذخیره</button><button class="btn" id="pwCancel">انصراف</button>`)
    $('#pwCancel').onclick = closeModal
    $('#pwSave').onclick = guard(async () => {
      const v = $('#pwNew').value; if (v.length < 8) throw new Error('رمز باید حداقل ۸ کاراکتر باشد')
      await post(`/api/users/${b.dataset.pw}`, { password: v }, 'PATCH'); closeModal(); toast('رمز تغییر کرد')
    })
  })
  document.querySelectorAll('[data-edituser]').forEach(b => b.onclick = () => userEditForm(users.find(x => x.id === +b.dataset.edituser)))
  document.querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => confirmBox('این کاربر حذف شود؟',
    async () => { await api(`/api/users/${b.dataset.deluser}`, { method: 'DELETE' }); toast('کاربر حذف شد'); refresh() }))
}
function userEditForm(u) {
  const self = u.id === ME.id
  openModal('ویرایش کاربر', `<div class="form">
    <label class="f">نام و نام خانوادگی<input class="inp" id="ueName" value="${esc(u.display_name)}"></label>
    <label class="f">نام کاربری<input class="inp" id="ueUser" value="${esc(u.username)}" autocomplete="off"></label>
    <label class="f">نقش<select class="inp" id="ueRole" ${self ? 'disabled' : ''}>${META.roles.map(r => `<option value="${r.value}" ${u.role === r.value ? 'selected' : ''}>${esc(r.fa)}</option>`).join('')}</select>${self ? '<span class="hint">نقش خودتان قابل تغییر نیست</span>' : ''}</label>
    <p class="hint">برای تغییر رمز از دکمه‌ی «تغییر رمز» استفاده کنید.</p>
  </div>`, `<button class="btn primary" id="ueSave">ذخیره</button><button class="btn" id="ueCancel">انصراف</button>`)
  $('#ueCancel').onclick = closeModal
  $('#ueSave').onclick = guard(async () => {
    const displayName = $('#ueName').value.trim(), username = $('#ueUser').value.trim()
    if (!displayName || !username) throw new Error('نام و نام کاربری لازم است')
    const payload = { displayName, username }
    if (!self) payload.role = $('#ueRole').value
    await post(`/api/users/${u.id}`, payload, 'PATCH')
    closeModal(); toast('کاربر ویرایش شد'); refresh()
  })
}
function userForm() {
  openModal('کاربر جدید', `<div class="form">
    <label class="f">نام و نام خانوادگی<input class="inp" id="usName"></label>
    <div class="frow">
      <label class="f">نام کاربری<input class="inp" id="usUser"></label>
      <label class="f">رمز عبور<input class="inp" id="usPass" type="password" placeholder="حداقل ۸ کاراکتر"></label>
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
      <label class="check" style="margin-bottom:6px"><input type="checkbox" id="bkAuto" ${s.autoBackup ? 'checked' : ''}> بکاپ خودکارِ روزانه (توصیه‌شده) — ۱۴ نسخهٔ آخر و یک نسخه از هر ماه نگه داشته می‌شود</label>
      <p class="hint" style="margin:0 0 12px">آخرین بکاپ: <b>${s.lastBackupAt ? faDigit(new Date(s.lastBackupAt).toLocaleString('fa-IR')) : 'هنوز گرفته نشده'}</b> · مسیر پیش‌فرض: <span class="num">${esc(s.defaultBackupDir || '')}</span></p>
      <div class="fbtns"><button class="btn primary" id="bkNow">ساخت بکاپ</button>
        <a class="btn" href="/api/backup/download">⬇️ دانلود بکاپ</a>
        <button class="btn" id="bkSaveSet">ذخیره‌ی تنظیمات</button></div>
      ${backups.length ? `<div style="margin-top:14px"><div class="hint">بکاپ‌های موجود:</div>
        ${backups.slice(0, 8).map(b => `<div class="bkitem"><span>${esc(b.name)}</span><span class="hint">${b.auto ? 'خودکار' : b.pre ? 'پیش از بازیابی' : 'دستی'}</span></div>`).join('')}</div>` : ''}
    </div></div>
    <div class="bkcard"><div class="bkicon">♻️</div><div class="bkbody">
      <h3>بازیابی از بکاپ</h3><p>اطلاعات فعلی با محتوای فایل بکاپ جایگزین می‌شود. پیش از بازیابی، فایل بررسی می‌شود و یک بکاپ از وضعیتِ فعلی هم خودکار گرفته می‌شود تا در صورت اشتباه قابل برگشت باشد.</p>
      <label class="drop" id="rsLbl" for="rsFile">📦 انتخاب فایل بکاپ (zip)<input type="file" id="rsFile" accept=".zip" hidden></label>
      <div id="rsInfo"></div>
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
  // بازیابی دومرحله‌ای: ۱) بررسیِ فایل و نمایشِ محتوا  ۲) تأیید با مقایسهٔ دادهٔ فعلی
  let rsInfo = null
  $('#rsFile').addEventListener('change', () => setTimeout(guard(async () => {
    const f = $('#rsFile').files[0]; if (!f) return
    $('#rsGo').disabled = true; $('#rsInfo').innerHTML = '<div class="hint">در حال بررسیِ فایل…</div>'
    try {
      const r = await post('/api/backup/inspect', { dataUrl: await readFileDataUrl(f) }); rsInfo = r
      const b = r.backup, c = r.current
      $('#rsInfo').innerHTML = `<div class="panel" style="margin:10px 0 0;padding:12px 14px;background:var(--panel-2)">
        <b>فایل سالم است.</b> ساختمان: <b>${esc(b.building || '—')}</b> · آخرین سند: <b class="num">${faDigit(b.lastDate || '—')}</b><br>
        <span class="hint">در بکاپ: ${faDigit(b.units)} واحد · ${faDigit(b.invoices)} فاکتور · ${faDigit(b.payments)} دریافتی · ${faDigit(b.docs)} سندِ پیوست</span><br>
        <span class="hint">اکنون: ${faDigit(c.units)} واحد · ${faDigit(c.invoices)} فاکتور · ${faDigit(c.payments)} دریافتی</span></div>`
      $('#rsGo').disabled = false
    } catch (e) { rsInfo = null; $('#rsInfo').innerHTML = `<div class="ferr" style="display:block;margin-top:8px">${esc(e.message)}</div>` }
  }), 0))
  $('#rsGo').onclick = () => {
    if (!rsInfo) return
    const b = rsInfo.backup, c = rsInfo.current
    confirmBox(`بازیابی انجام شود؟\nدادهٔ فعلی (${faDigit(c.invoices)} فاکتور، ${faDigit(c.payments)} دریافتی) با بکاپ (${faDigit(b.invoices)} فاکتور، ${faDigit(b.payments)} دریافتی، آخرین سند ${faDigit(b.lastDate || '—')}) جایگزین می‌شود. پیش از آن یک بکاپ از وضعیت فعلی گرفته می‌شود.`,
      async () => {
        const f = $('#rsFile').files[0]
        const r = await post('/api/backup/restore', { dataUrl: await readFileDataUrl(f) })
        toast(`بازیابی شد (${faDigit(r.count)} سند). نسخهٔ پیش از بازیابی ذخیره شد. دوباره وارد شوید.`); setTimeout(() => location.reload(), 2200)
      }, 'بله، بازیابی شود')
  }
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
// ---------- بررسی نسخه‌ی جدید (دانلود دستی) ----------
const REPO = 'nadershayegan-beep/hesabdar-sakhteman'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`
function cmpVer(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(n => +n || 0)
  const pb = String(b || '0').replace(/^v/, '').split('.').map(n => +n || 0)
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x > y) return 1; if (x < y) return -1 }
  return 0
}
async function fetchLatestRelease() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error('unavailable')
  const j = await r.json()
  return { tag: (j.tag_name || '').replace(/^v/, ''), url: j.html_url || RELEASES_URL,
    assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url })).filter(a => /\.(dmg|exe|zip|AppImage)$/i.test(a.name)) }
}
function assetLinksHtml(L) {
  if (!L.assets.length) return ''
  return `<div style="display:flex;flex-direction:column;gap:6px;margin:10px 0">`
    + L.assets.map(a => `<a class="btn small" href="${esc(a.url)}" target="_blank" rel="noopener">⬇️ ${esc(a.name)}</a>`).join('')
    + `</div>`
}
async function renderUpdateBox() {
  const box = $('#updateBox'); if (!box) return
  try {
    const L = await fetchLatestRelease()
    if (cmpVer(L.tag, APP_VER) > 0) {
      box.innerHTML = `<div class="helpcard" style="border-color:#16a34a;background:#f0fdf4">
        <h3>🎉 نسخه‌ی جدید ${escFa(L.tag)} منتشر شده است</h3>
        <p>نسخه‌ی فعلی شما ${escFa(APP_VER)} است. فایل مربوط به سیستم خودتان را دانلود کنید و روی نسخه‌ی قبلی نصب کنید — <b>داده‌ها و اسناد شما پاک نمی‌شود</b> (در پوشه‌ی جدا نگهداری می‌شوند).</p>
        <p class="hint">🖥 مک: فایل با پسوند <b>dmg</b> · 🪟 ویندوز: فایل با پسوند <b>exe</b></p>
        ${assetLinksHtml(L)}
        <a class="link" href="${esc(L.url)}" target="_blank" rel="noopener">صفحه‌ی دانلود در گیت‌هاب ↗</a></div>`
    } else {
      box.innerHTML = `<div class="helpcard"><h3>✅ برنامه به‌روز است</h3>
        <p>شما آخرین نسخه (${escFa(APP_VER)}) را دارید.</p>
        <a class="link" href="${RELEASES_URL}" target="_blank" rel="noopener">مشاهده‌ی همه‌ی نسخه‌ها ↗</a></div>`
    }
  } catch {
    box.innerHTML = `<div class="helpcard"><h3>⬇️ دریافت آخرین نسخه</h3>
      <p>برای دانلود دستی آخرین نسخه به صفحه‌ی زیر بروید و فایل مخصوص سیستم خود را بگیرید (مک: dmg · ویندوز: exe):</p>
      <a class="abcta" href="${RELEASES_URL}" target="_blank" rel="noopener">صفحه‌ی دانلود نسخه‌ها ↗</a>
      <p class="hint" style="margin-top:8px">اگر اینترنت در دسترس نیست، بعداً همین‌جا دوباره امتحان کنید.</p></div>`
  }
}

// ==================== رویدادها (جلسات/تصمیمات/پیشنهادات) ====================
const parseJ = s => { const p = String(s || '').split('/').map(x => +enDigit(x)); return p.length === 3 && p[0] ? { jy: p[0], jm: p[1], jd: p[2] } : null }
const evStatusCls = s => ({ approved: 'b-ok', rejected: 'b-no', pending: 'b-open', done: 'b-done' }[s] || 'b-open')

function attachRow(e, type = 'event') {
  const files = (e.attachments || []).map(a =>
    `<span class="attpill"><a href="/uploads/${encodeURI(a.file)}" target="_blank" rel="noopener">📎 ${esc(a.display_name || 'سند')}</a>${adminOnly(`<button class="attx" data-att-del="${a.id}" title="حذف سند">✕</button>`)}</span>`).join('')
  return `<div class="attrow">${files}${adminOnly(`<button class="btn tiny" data-att-add="${e.id}" data-att-type="${type}">📎 افزودن سند</button>`)}</div>`
}
// آپلود یک سند به هر موجودیت (event/project/quote)؛ true اگر افزوده شد
function doAttachUpload(type, id) {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'
    inp.onchange = guard(async () => {
      const f = inp.files[0]; if (!f) { resolve(false); return }
      const c = await maybeCompress(f)
      toast('در حال آپلود سند…')
      await post(`/api/attachments/${type}/${id}`, { doc: { name: c.name, dataUrl: await readFileDataUrl(c) } })
      toast('سند افزوده شد'); resolve(true)
    })
    inp.click()
  })
}
function eventItem(e) {
  const badge = e.statusFa ? `<span class="badge ${evStatusCls(e.status)}">${e.statusFa}</span>` : ''
  return `<div class="evitem">
    <div class="evhead"><div><span class="evkind k-${e.kind}">${e.kindFa}</span> <b>${esc(e.title)}</b> ${badge}
      <span class="evdate num">${e.j_date ? faDigit(e.j_date) : ''}</span></div>
      ${adminOnly(`<div class="evacts"><button class="btn tiny" data-ev-edit="${e.id}">✏️</button><button class="btn tiny" data-ev-del="${e.id}">🗑</button></div>`)}</div>
    ${e.summary ? `<div class="evsummary">${esc(e.summary).replace(/\n/g, '<br>')}</div>` : ''}
    ${attachRow(e)}</div>`
}
function meetingCard(m) {
  return `<div class="panel evcard">
    <div class="evhead"><div><span class="evkind k-meeting">جلسه</span> <b>${esc(m.title)}</b>
      <span class="evdate num">${m.j_date ? faDigit(m.j_date) : ''}</span></div>
      <div class="evacts">
        <button class="btn tiny" data-ev-pdf="${m.id}" title="صورت‌جلسه PDF">📄</button>
        ${adminOnly(`<button class="btn tiny" data-ev-decision="${m.id}" title="افزودن مصوبه/پیشنهاد">＋ مصوبه</button>
        <button class="btn tiny" data-ev-edit="${m.id}">✏️</button>
        <button class="btn tiny" data-ev-del="${m.id}">🗑</button>`)}</div></div>
    ${m.attendees ? `<div class="evmeta">👥 حاضرین: ${esc(m.attendees)}</div>` : ''}
    ${m.summary ? `<div class="evsummary">${esc(m.summary).replace(/\n/g, '<br>')}</div>` : ''}
    ${attachRow(m)}
    ${m.children.length ? `<div class="evchildren">${m.children.map(eventItem).join('')}</div>` : ''}</div>`
}

let EV_CACHE = {}
VIEWS.events = async () => {
  const d = await api('/api/events')
  EV_CACHE = {}
  d.meetings.forEach(m => { EV_CACHE[m.id] = m; m.children.forEach(c => EV_CACHE[c.id] = c) })
  d.orphans.forEach(o => EV_CACHE[o.id] = o)
  const empty = !d.meetings.length && !d.orphans.length
  $('#view').innerHTML = head('رویدادها و جلسات', 'بایگانی جلسات، مصوبات و پیشنهادات ساختمان',
    adminOnly(`<button class="btn primary" id="evNewMeeting">＋ ثبت جلسه</button><button class="btn" id="evNewDecision">＋ تصمیم/پیشنهاد</button>`)) +
    `<div class="kpis">
      ${kpiN('جلسات برگزارشده', faDigit(d.counts.meetings))}
      ${kpiN('مصوبات', faDigit(d.counts.decisions))}
      ${kpiN('پیشنهادات', faDigit(d.counts.proposals))}
    </div>
    ${empty ? `<div class="empty">هنوز جلسه یا تصمیمی ثبت نشده${isAdmin() ? ' — با دکمه‌های بالا شروع کنید' : ''}</div>` : `
    <div class="evlist">
      ${d.meetings.map(meetingCard).join('')}
      ${d.orphans.length ? `<div class="panel"><div class="phead"><b>تصمیمات و پیشنهادات مستقل</b></div>
        <div class="evchildren">${d.orphans.map(eventItem).join('')}</div></div>` : ''}
    </div>`}`
  wireCommon()
  if ($('#evNewMeeting')) $('#evNewMeeting').onclick = () => eventForm('meeting')
  if ($('#evNewDecision')) $('#evNewDecision').onclick = () => eventForm('decision')
  document.querySelectorAll('[data-ev-pdf]').forEach(b => b.onclick = () => { const e = EV_CACHE[+b.dataset.evPdf]; if (e) saveMeetingPdf(e) })
  document.querySelectorAll('[data-ev-decision]').forEach(b => b.onclick = () => eventForm('decision', null, +b.dataset.evDecision))
  document.querySelectorAll('[data-ev-edit]').forEach(b => b.onclick = () => { const e = EV_CACHE[+b.dataset.evEdit]; if (e) eventForm(e.kind, e) })
  document.querySelectorAll('[data-ev-del]').forEach(b => b.onclick = () => {
    const e = EV_CACHE[+b.dataset.evDel]
    confirmBox(`«${e ? e.title : 'این رویداد'}» حذف شود؟ اسناد پیوستش هم پاک می‌شود.`, async () => {
      await api('/api/events/' + b.dataset.evDel, { method: 'DELETE' }); toast('حذف شد'); render()
    })
  })
  document.querySelectorAll('[data-att-add]').forEach(b => b.onclick = () => doAttachUpload(b.dataset.attType, +b.dataset.attAdd).then(ok => ok && render()))
  document.querySelectorAll('[data-att-del]').forEach(b => b.onclick = () => confirmBox('این فایل پیوست برای همیشه پاک شود؟ (اگر لازمش دارید، اول از آن بکاپ بگیرید)',
    async () => { await api('/api/attachments/' + b.dataset.attDel, { method: 'DELETE' }); toast('فایل پیوست حذف شد'); render() }))
}

const saveMeetingPdf = guard(async m => {
  const rel = `/print/meeting/${m.id}`, fname = `صورت‌جلسه ${m.title}`
  if (window.hesabdar && window.hesabdar.savePdf) {
    toast('در حال ساخت PDF…')
    const r = await window.hesabdar.savePdf(rel, fname)
    toast(r && r.ok ? 'صورت‌جلسه در پوشه‌ی «اسناد صادرشده» ذخیره شد' : (r && r.error) || 'ناموفق', !(r && r.ok))
  } else window.open(rel, '_blank')
})

function eventForm(kind, ev = null, parentId = 0) {
  const isMeeting = (ev ? ev.kind : kind) === 'meeting'
  const k = ev ? ev.kind : kind
  const j = ev && ev.j_date ? parseJ(ev.j_date) : null
  openModal(ev ? 'ویرایش رویداد' : (isMeeting ? 'ثبت جلسه' : 'ثبت تصمیم/پیشنهاد'), `<div class="form">
    ${!isMeeting ? `<label class="f">نوع
      <select class="inp" id="evKind">
        <option value="decision" ${k === 'decision' ? 'selected' : ''}>تصمیم/مصوبه</option>
        <option value="proposal" ${k === 'proposal' ? 'selected' : ''}>پیشنهاد</option></select></label>` : ''}
    <label class="f">عنوان<input class="inp" id="evTitle" value="${ev ? esc(ev.title) : ''}" placeholder="${isMeeting ? 'مثلاً: جلسه‌ی هیئت‌مدیره — مرداد' : 'مثلاً: تصویب بازسازی لابی'}"></label>
    <label class="f">تاریخ ${dateBoxHtml('ev', j)}</label>
    ${isMeeting ? `<label class="f">حاضرین<input class="inp" id="evAttendees" value="${ev ? esc(ev.attendees || '') : ''}" placeholder="نام اعضای حاضر در جلسه"></label>` : ''}
    ${!isMeeting ? `<label class="f">وضعیت
      <select class="inp" id="evStatus">
        <option value="">—</option>
        <option value="approved">مصوب</option>
        <option value="rejected">رد شده</option>
        <option value="pending">در دست بررسی</option>
        <option value="done">انجام‌شده</option></select></label>` : ''}
    <label class="f">${isMeeting ? 'خلاصه‌ی جلسه و مذاکرات' : 'متن تصمیم/پیشنهاد'}
      <textarea class="inp" id="evSummary" rows="4" placeholder="${isMeeting ? 'مهم‌ترین موضوعات و جمع‌بندی…' : 'شرح دقیق…'}">${ev ? esc(ev.summary || '') : ''}</textarea></label>
    ${!ev ? `<p class="hint">پس از ذخیره، از دکمه‌ی «📎 افزودن سند» روی همان رویداد، فایل صورت‌جلسه یا مدارک را پیوست کنید.</p>` : ''}
  </div>`, `<button class="btn primary" id="evSave">ذخیره</button><button class="btn" id="evCancel">انصراف</button>`)
  wireToday($('#modalBody'))
  if (ev && ev.status && $('#evStatus')) $('#evStatus').value = ev.status
  $('#evCancel').onclick = closeModal
  $('#evSave').onclick = guard(async () => {
    const title = $('#evTitle').value.trim(); if (!title) throw new Error('عنوان لازم است')
    const dt = readDate('ev')
    const payload = { title, jy: dt.jy, jm: dt.jm, jd: dt.jd, summary: $('#evSummary').value.trim() }
    if (isMeeting) { payload.kind = 'meeting'; payload.attendees = $('#evAttendees').value.trim() }
    else { payload.kind = $('#evKind').value; payload.status = $('#evStatus').value; if (parentId) payload.parentId = parentId }
    if (ev) await post('/api/events/' + ev.id, payload, 'PUT')
    else await post('/api/events', payload)
    closeModal(); toast('ذخیره شد'); render()
  })
}

// ==================== پروژه‌ها ====================
const PROJECT_STATUS_FA = { proposed: 'پیشنهادی', approved: 'تصویب‌شده', in_progress: 'در حال اجرا', done: 'تمام‌شده', canceled: 'متوقف' }
const projStatusCls = s => ({ approved: 'b-ok', in_progress: 'b-open', done: 'b-done', canceled: 'b-no', proposed: 'b-open' }[s] || 'b-open')

function projectCard(p) {
  const s = p.summary
  return `<button class="pcard" data-proj="${p.id}">
    <div class="pctop"><span class="pn">${esc(p.title)}</span><span class="badge ${projStatusCls(p.status)}">${esc(p.statusFa)}</span></div>
    ${p.budget ? `<div class="pline"><span>برآورد مصوب</span><b class="num">${money(p.budget)} ${curFa()}</b></div>` : ''}
    ${s && s.hasCharge ? `
      <div class="pline"><span>هزینهٔ واقعی</span><b class="num">${money(s.netCost)}</b></div>
      <div class="pline"><span>وصول از ساکنین</span><b class="num amt-in">${money(s.collected)}</b></div>
      <div class="pline"><span>بدهی ساکنین</span><b class="num ${s.debt > 0 ? 'amt-out' : ''}">${money(s.debt)}</b></div>
      <div class="pline"><span>سهم واقعی هر واحد</span><b class="num">${money(s.perUnitFinal)}</b></div>
      <div class="pline"><span>صندوق پروژه</span>${s.fundBalance >= 0 ? `<b class="num amt-in">مازاد ${money(s.fundBalance)}</b>` : `<b class="num amt-out">کسری ${money(-s.fundBalance)}</b>`}</div>`
    : `<div class="pline"><span>استعلام‌ها</span><b class="num">${faDigit(p.quoteCount)}</b></div>
    ${p.selectedAmount ? `<div class="pline"><span>مبلغ انتخابی</span><b class="num amt-in">${money(p.selectedAmount)} ${curFa()}</b></div>` : ''}`}
    ${p.decisionTitle ? `<div class="pfoot">📋 مصوبه: ${esc(p.decisionTitle)}</div>` : ''}</button>`
}
VIEWS.projects = async () => {
  const list = await api('/api/projects')
  const counts = { total: list.length, active: list.filter(p => p.status === 'in_progress').length, done: list.filter(p => p.status === 'done').length }
  $('#view').innerHTML = head('پروژه‌ها', 'پروژه‌های تصویب‌شده، استعلام‌ها و پیمانکاران',
    adminOnly(`<button class="btn primary" id="prNew">＋ پروژه جدید</button><button class="btn" id="prVendors">👷 پیمانکاران</button>`)) +
    `<div class="kpis">
      ${kpiN('کل پروژه‌ها', faDigit(counts.total))}
      ${kpiN('در حال اجرا', faDigit(counts.active))}
      ${kpiN('تمام‌شده', faDigit(counts.done))}
    </div>
    ${list.length ? `<div class="pgrid">${list.map(projectCard).join('')}</div>`
      : `<div class="empty">هنوز پروژه‌ای ثبت نشده${isAdmin() ? ' — با «＋ پروژه جدید» شروع کنید' : ''}</div>`}`
  wireCommon()
  if ($('#prNew')) $('#prNew').onclick = () => projectForm()
  if ($('#prVendors')) $('#prVendors').onclick = () => vendorsManager()
  document.querySelectorAll('[data-proj]').forEach(c => c.onclick = () => showProject(+c.dataset.proj))
}

function quoteRow(q) {
  const badges = `${q.isCheapest ? '<span class="badge b-ok">کمترین</span>' : ''}${q.selected ? ' <span class="badge b-done">⭐ انتخاب‌شده</span>' : ''}`
  const files = (q.attachments || []).map(a => `<a class="attmini" href="/uploads/${encodeURI(a.file)}" target="_blank" rel="noopener" title="${esc(a.display_name || 'سند')}">📎</a>`).join('')
  return `<tr class="${q.selected ? 'qsel' : ''}">
    <td><b>${esc(q.vendorLabel)}</b> ${badges}</td>
    <td class="num">${money(q.amount)} ${curFa()}</td>
    <td class="num">${q.j_date ? faDigit(q.j_date) : '—'}</td>
    <td>${esc(q.note || '—')}</td>
    <td>${files}${adminOnly(`<button class="btn tiny" data-q-att="${q.id}" title="افزودن سند">＋</button>`)}</td>
    <td class="rowact">${adminOnly(`<button class="btn tiny" data-q-sel="${q.id}" data-q-sel-on="${q.selected ? 1 : 0}" title="انتخاب نهایی">${q.selected ? '★' : '☆'}</button><button class="btn tiny" data-q-edit="${q.id}">✏️</button><button class="btn tiny" data-q-del="${q.id}">🗑</button>`)}</td></tr>`
}
const showProject = guard(async id => {
  const d = await api('/api/projects/' + id)
  if (!markDetail('project', id)) scrollTo(0, 0)
  const p = d.project, refresh = () => showProject(id)
  $('#view').innerHTML =
    `<button class="btn small back printhide" id="backBtn">→ بازگشت به پروژه‌ها</button>` +
    head('پروژه: ' + p.title, `${p.statusFa}${p.budget ? ` · برآورد اولیه: ${money(p.budget)} ${curFa()}` : ''}${d.reconciled ? ` · نهایی: ${money(d.finalBasis)} · انحراف: ${signed(d.deviation)}` : ''}${p.decisionTitle ? ` · مصوبه: ${p.decisionTitle}` : ''}`,
      `<button class="btn" id="pjReport">📄 گزارش پروژه</button>` + adminOnly(`<button class="btn primary" id="pjQuote">＋ استعلام</button><button class="btn" id="pjEdit">✏️ ویرایش</button><button class="btn danger" id="pjDel">🗑 حذف</button>`)) +
    (p.note ? `<div class="panel" style="padding:12px 16px">${esc(p.note).replace(/\n/g, '<br>')}</div>` : '') +
    `<div class="panel"><div class="phead"><b>وضعیت مالی پروژه</b><span class="hint">روش تقسیم: ${d.charge ? d.charge.methodFa : '—'}${d.charge ? ' · بر عهدهٔ ' + (d.charge.payer === 'owner' ? 'مالک' : 'مستاجر') : ''}</span></div>
      ${d.charge ? `<div class="kpis">
        ${kpi('برآورد اولیه', money(d.box.estimate.total), 'سهم هر واحد: ' + money(d.box.estimate.perUnit))}
        ${kpi('وصول از ساکنین', money(d.box.collection.collected), 'مانده بدهی ساکنین: ' + money(d.box.collection.debt))}
        ${kpi('مخارج کلی پروژه', money(d.box.expenses.total), 'پرداخت به پیمانکار: ' + money(d.box.expenses.paid) + ' · مانده طلب: ' + money(d.box.expenses.outstanding), 'bad')}
        ${d.reconciled ? kpi('مبلغ نهایی مخارج', money(d.box.final.total), 'انحراف از برآورد: ' + signed(d.box.final.deviation) + ' · سهم نهایی هر واحد: ' + money(d.box.final.perUnit), d.box.final.deviation > 0 ? 'warn' : 'good') : ''}
      </div>
      ${d.reconciled ? `<div class="notice ${d.box.fund.balance >= 0 ? 'info' : 'danger'} printhide">جمع‌بندی صندوقِ پروژه: وصول ${money(d.box.fund.collected)} − مخارج نهایی ${money(d.box.fund.finalCost)} = ${d.box.fund.balance >= 0 ? `<b class="amt-in">صندوق بستانکار (مازاد) ${money(d.box.fund.balance)}</b>` : `<b class="amt-out">صندوق بدهکار (کسری) ${money(-d.box.fund.balance)}</b>`} ${curFa()}</div>` : ''}
      <div class="tablewrap"><table class="tx"><thead><tr><th>ردیف</th><th>واحد</th><th>ساکن</th><th>سهم مصوبه</th>${d.reconciled ? '<th>سهم نهایی (مخارج)</th>' : ''}<th>پرداختی</th><th>بدهی/طلب طبق مصوبه</th>${d.reconciled ? '<th>بدهی/طلب طبق مخارج</th>' : ''}${adminOnly('<th></th>')}</tr></thead><tbody>
      ${d.chargeShares.map(s => { const badge = v => v > 0 ? `<span class="badge b-no">بدهکار ${money(v)}</span>` : v < 0 ? `<span class="badge b-done">پیش‌پرداخت ${money(-v)}</span>` : `<span class="badge b-ok">تسویه</span>`; return `<tr>
        <td class="num">${faDigit(s.row)}</td><td><b>واحد ${escFa(s.number)}</b></td><td>${esc(s.resident_name || '—')}</td>
        <td class="num">${money(s.budgetShare)}</td>${d.reconciled ? `<td class="num">${money(s.finalShare)}</td>` : ''}
        <td class="num amt-in">${money(s.paid)}</td>
        <td>${badge(s.balByBudget)}</td>${d.reconciled ? `<td>${badge(s.balByFinal)}</td>` : ''}
        ${adminOnly(`<td class="rowact"><button class="btn tiny" data-pjpay="${s.unit_id}" title="ثبت پرداخت این واحد">＋ پرداخت</button></td>`)}</tr>` }).join('')}
      </tbody></table></div>
      ${d.reconciled ? `<div class="hint" style="margin-top:4px">«طبق مصوبه» = آنچه هر واحد باید بدهد (برآورد اولیه). «طبق مخارج» = نسبت به هزینهٔ واقعی؛ اگر واحدی مصوبه را کامل داده، مازادش طلبِ او از صندوق است.</div>` : ''}
      ${adminOnly(`<div style="padding:10px 0 0; display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn small" id="pjChargeEdit">✏️ ویرایش مبلغ شارژ</button>
        <button class="btn small primary" id="pjReconcile">✅ اتمام و ثبت کامل هزینه‌ها</button></div>`)}`
      : `<div class="empty">هنوز شارژی برای این پروژه صادر نشده است</div>
      ${adminOnly(`<div style="padding:6px 0 0"><button class="btn small primary" id="pjChargeNew">＋ صدور شارژ پروژه از ساکنین</button></div>`)}`}
    </div>` +
    `<div class="panel"><div class="phead"><b>استعلام‌ها (${faDigit(d.quotes.length)})</b><span class="hint">ارزان‌ترین با نشان «کمترین»؛ انتخاب نهایی را با ★ علامت بزنید</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>پیمانکار</th><th>مبلغ</th><th>تاریخ</th><th>توضیح</th><th>سند</th><th></th></tr></thead><tbody>
      ${d.quotes.length ? d.quotes.map(quoteRow).join('') : emptyRow(6, 'استعلامی ثبت نشده')}
      </tbody></table></div></div>
    <div class="panel"><div class="phead"><b>فاکتورهای خرید/فروش پروژه (${faDigit(d.invoices.length)})</b>
      <span class="hint">خرید: ${money(d.purchaseTotal || 0)} · فروش: ${money(d.saleTotal || 0)} · هزینهٔ خالص: <b>${money(d.invoiceTotal)}</b> ${curFa()}</span></div>
      <div class="tablewrap"><table class="tx"><thead><tr><th>پیمانکار / شرح</th><th>مبلغ</th><th>تاریخ</th><th>وضعیت</th><th>سند</th><th></th></tr></thead><tbody>
      ${d.invoices.length ? d.invoices.map(cInvoiceRow).join('') : emptyRow(6, 'فاکتوری بایگانی نشده')}
      </tbody></table></div>
      ${adminOnly(`<div style="padding:10px 0 0"><button class="btn small" id="ciNew">＋ فاکتور پیمانکار</button></div>`)}
      <div class="hint" style="margin-top:6px">فاکتور خریدِ «پرداخت‌شده» از صندوق اصلی کسر و فروشِ «دریافت‌شده» به آن اضافه می‌شود.</div></div>
    <div class="panel"><div class="phead"><b>اسناد پروژه</b></div>${attachRow({ id: p.id, attachments: d.attachments }, 'project')}</div>`
  $('#backBtn').onclick = () => goBack('projects')
  if ($('#pjReport')) $('#pjReport').onclick = () => {
    const rel = '/print/expenses?mode=project&projectId=' + id
    if (IS_DESKTOP && window.hesabdar.savePdf) { toast('در حال ساخت گزارش…'); window.hesabdar.savePdf(rel, `گزارش پروژه ${p.title}`).then(x => toast(x && x.ok ? 'PDF ذخیره شد' : 'ناموفق', !(x && x.ok))) }
    else window.open(rel, '_blank')
  }
  document.querySelectorAll('[data-pjpay]').forEach(b => b.onclick = () => paymentForm(+b.dataset.pjpay, null, refresh, id))
  if ($('#pjQuote')) $('#pjQuote').onclick = () => quoteForm(id, null, refresh)
  if ($('#pjEdit')) $('#pjEdit').onclick = () => projectForm(p, refresh)
  if ($('#pjChargeNew')) $('#pjChargeNew').onclick = () => projectChargeForm(p, null, refresh)
  if ($('#pjChargeEdit')) $('#pjChargeEdit').onclick = () => projectChargeForm(p, d.charge, refresh)
  if ($('#pjReconcile')) $('#pjReconcile').onclick = () => {
    if (!d.finalBasis) return toast('اول فاکتورهای پروژه را ثبت کنید یا «مبلغ نهایی» را در ویرایش پروژه وارد کنید', true)
    const src = d.finalAmount ? 'مبلغ نهاییِ حسابرسی' : 'هزینهٔ خالص فاکتورها'
    const dev = d.finalBasis - (p.budget || 0)
    confirmBox(`هزینهٔ کامل روی ${moneyU(d.finalBasis)} (${src}) ثبت شود؟\nسهم هر واحد و فاکتور کلی پروژه بازمحاسبه و بدهکار/بستانکار ساکنین به‌روز می‌شود.${p.budget ? `\nانحراف از برآورد اولیه: ${signed(dev)} ${curFa()}` : ''}`,
      async () => { const r = await post('/api/projects/' + id + '/reconcile', {}); toast(`ثبت شد — هزینهٔ کامل ${moneyU(r.amount)}${p.budget ? ` · انحراف ${signed(dev)}` : ''}`); refresh() })
  }
  if ($('#pjDel')) $('#pjDel').onclick = () => confirmBox(`پروژه «${p.title}» و همه‌ی استعلام‌ها و اسنادش حذف شود؟`,
    async () => { await api('/api/projects/' + id, { method: 'DELETE' }); toast('حذف شد'); VIEW = 'projects'; NAV_STACK = []; render() })
  document.querySelectorAll('[data-q-sel]').forEach(b => b.onclick = guard(async () => {
    await post('/api/quotes/' + b.dataset.qSel + '/select', { selected: b.dataset.qSelOn !== '1' }); refresh()
  }))
  document.querySelectorAll('[data-q-edit]').forEach(b => b.onclick = () => quoteForm(id, d.quotes.find(x => x.id === +b.dataset.qEdit), refresh))
  document.querySelectorAll('[data-q-del]').forEach(b => b.onclick = () => confirmBox('این استعلام حذف شود؟',
    async () => { await api('/api/quotes/' + b.dataset.qDel, { method: 'DELETE' }); toast('حذف شد'); refresh() }))
  document.querySelectorAll('[data-q-att]').forEach(b => b.onclick = () => doAttachUpload('quote', +b.dataset.qAtt).then(ok => ok && refresh()))
  if ($('#ciNew')) $('#ciNew').onclick = () => cInvoiceForm(id, null, refresh)
  document.querySelectorAll('[data-ci-paid]').forEach(b => b.onclick = guard(async () => { await post('/api/contractor-invoices/' + b.dataset.ciPaid, { paid: b.dataset.ciPaidOn !== '1' }, 'PUT'); refresh() }))
  document.querySelectorAll('[data-ci-edit]').forEach(b => b.onclick = () => cInvoiceForm(id, d.invoices.find(x => x.id === +b.dataset.ciEdit), refresh))
  document.querySelectorAll('[data-ci-pay]').forEach(b => b.onclick = guard(() => ciPayForm(d.invoices.find(x => x.id === +b.dataset.ciPay), refresh)))
  document.querySelectorAll('[data-ci-del]').forEach(b => b.onclick = () => confirmReason('این فاکتور پیمانکار حذف شود؟ اثرش روی صندوق برگشت می‌خورد.', async r => { await api('/api/contractor-invoices/' + b.dataset.ciDel + '?reason=' + encodeURIComponent(r), { method: 'DELETE' }); toast('حذف شد'); refresh() }))
  document.querySelectorAll('[data-ci-att]').forEach(b => b.onclick = () => doAttachUpload('cinvoice', +b.dataset.ciAtt).then(ok => ok && refresh()))
  document.querySelectorAll('[data-att-add]').forEach(b => b.onclick = () => doAttachUpload(b.dataset.attType, +b.dataset.attAdd).then(ok => ok && refresh()))
  document.querySelectorAll('[data-att-del]').forEach(b => b.onclick = () => confirmBox('این فایل پیوست برای همیشه پاک شود؟', async () => { await api('/api/attachments/' + b.dataset.attDel, { method: 'DELETE' }); toast('فایل پیوست حذف شد'); refresh() }))
})

async function projectForm(p = null, after) {
  const ev = await api('/api/events')
  const decisions = []
  ev.meetings.forEach(m => m.children.forEach(c => { if (c.kind === 'decision') decisions.push(c) }))
  ev.orphans.forEach(o => { if (o.kind === 'decision') decisions.push(o) })
  openModal(p ? 'ویرایش پروژه' : 'پروژه جدید', `<div class="form">
    <label class="f">عنوان پروژه<input class="inp" id="pjTitle" value="${p ? esc(p.title) : ''}" placeholder="مثلاً: بازسازی لابی"></label>
    <div class="frow">
      <label class="f">وضعیت<select class="inp" id="pjStatus">
        ${Object.entries(PROJECT_STATUS_FA).map(([k, v]) => `<option value="${k}" ${(p ? p.status : 'approved') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">برآورد اولیه (${curFa()})<input class="inp num" id="pjBudget" data-money="pjBudgetHint" inputmode="numeric" value="${p && p.budget ? sep(Math.round(r2d(p.budget))) : ''}"><span class="hint" id="pjBudgetHint"></span></label>
    </div>
    <label class="f">مبلغ نهایی — بعد از حسابرسی (${curFa()})<input class="inp num" id="pjFinal" data-money="pjFinalHint" inputmode="numeric" value="${p && p.final_amount ? sep(Math.round(r2d(p.final_amount))) : ''}"><span class="hint" id="pjFinalHint">مبنای «تعدیل نهایی» و انحراف از برآورد</span></label>
    <label class="f">مصوبه‌ی مرتبط (اختیاری)<select class="inp" id="pjDecision">
      <option value="0">—</option>
      ${decisions.map(z => `<option value="${z.id}" ${p && +p.decision_event_id === z.id ? 'selected' : ''}>${esc(z.title)}${z.j_date ? ' — ' + z.j_date : ''}</option>`).join('')}</select></label>
    <label class="f">توضیح<textarea class="inp" id="pjNote" rows="3">${p ? esc(p.note || '') : ''}</textarea></label>
  </div>`, `<button class="btn primary" id="pjSave">ذخیره</button><button class="btn" id="pjCancel">انصراف</button>`)
  wireMoney($('#modalBody'))
  $('#pjCancel').onclick = closeModal
  $('#pjSave').onclick = guard(async () => {
    const title = $('#pjTitle').value.trim(); if (!title) throw new Error('عنوان پروژه لازم است')
    const payload = { title, status: $('#pjStatus').value, budget: readMoney($('#pjBudget')), finalAmount: readMoney($('#pjFinal')), decisionEventId: +$('#pjDecision').value, note: $('#pjNote').value.trim() }
    if (p) await post('/api/projects/' + p.id, payload, 'PUT'); else await post('/api/projects', payload)
    closeModal(); toast('ذخیره شد'); after ? after() : render()
  })
}

// صدور یا ویرایش شارژ عمرانیِ پروژه (تقسیم بین ساکنین)
function projectChargeForm(project, charge, after) {
  const divMethods = (META.methods || []).filter(m => ['equal', 'area', 'occupants', 'common'].includes(m.value))
  openModal(charge ? 'ویرایش مبلغ شارژ' : 'صدور شارژ پروژه از ساکنین', `<div class="form">
    <div class="frow">
      <label class="f">مبلغ شارژ (${curFa()})<input class="inp num" id="pcAmount" data-money="pcHint" inputmode="numeric" value="${sep(Math.round(r2d(charge ? charge.amount : (project.budget || 0))))}"><span class="hint" id="pcHint"></span></label>
      <label class="f">روش تقسیم<select class="inp" id="pcMethod">${divMethods.map(m => `<option value="${m.value}" ${(charge ? charge.method : 'equal') === m.value ? 'selected' : ''}>${esc(m.fa)}</option>`).join('')}</select></label>
    </div>
    <div class="frow">
      <label class="f">بر عهدهٔ<select class="inp" id="pcPayer"><option value="owner" ${(charge ? charge.payer : 'owner') === 'owner' ? 'selected' : ''}>مالک</option><option value="tenant" ${charge && charge.payer === 'tenant' ? 'selected' : ''}>مستاجر / ساکن</option></select></label>
      <label class="f">نوع هزینه<select class="inp" id="pcKind"><option value="operational" ${(project.charge_kind || 'operational') === 'operational' ? 'selected' : ''}>عملیاتی (پروژه‌ای)</option><option value="current" ${project.charge_kind === 'current' ? 'selected' : ''}>جاری</option></select></label>
    </div>
    <label class="f">تاریخ${dateBoxHtml('pc')}</label>
    <p class="hint">شارژ بین همه‌ی واحدها تقسیم می‌شود (واحد خالی هم سهم عمرانی می‌دهد). با ذخیره، سهم هر واحد بازمحاسبه می‌شود؛ پرداخت‌های قبلی حفظ می‌مانند.</p>
  </div>`, `<button class="btn primary" id="pcSave">ذخیره</button><button class="btn" id="pcCancel">انصراف</button>`)
  wireToday($('#modalBody')); wireMoney($('#modalBody'))
  $('#pcCancel').onclick = closeModal
  $('#pcSave').onclick = guard(async () => {
    const amount = readMoney($('#pcAmount')); if (!(amount > 0)) throw new Error('مبلغ را وارد کنید')
    const dt = readDate('pc')
    await post('/api/projects/' + project.id + '/charge', { amount, method: $('#pcMethod').value, payer: $('#pcPayer').value, chargeKind: $('#pcKind').value, includeVacant: true, jy: dt.jy, jm: dt.jm, jd: dt.jd })
    closeModal(); toast(charge ? 'شارژ به‌روزرسانی شد' : 'شارژ صادر شد'); after ? after() : render()
  })
}

async function quoteForm(projectId, q = null, after) {
  const vendors = await api('/api/vendors')
  const j = q && q.j_date ? parseJ(q.j_date) : null
  openModal(q ? 'ویرایش استعلام' : 'ثبت استعلام', `<div class="form">
    <label class="f">پیمانکار<select class="inp" id="qVendor"><option value="0">— انتخاب از فهرست —</option>
      ${vendors.map(v => `<option value="${v.id}" ${q && +q.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="f">یا نام پیمانکار (اگر در فهرست نیست)<input class="inp" id="qVendorName" value="${q && !+q.vendor_id ? esc(q.vendor_name || '') : ''}"></label>
    <div class="frow">
      <label class="f">مبلغ استعلام (${curFa()})<input class="inp num" id="qAmount" data-money="qAmountHint" inputmode="numeric" value="${q ? sep(Math.round(r2d(q.amount))) : ''}"><span class="hint" id="qAmountHint"></span></label>
      <label class="f">تاریخ${dateBoxHtml('qd', j)}</label>
    </div>
    <label class="f">توضیح<input class="inp" id="qNote" value="${q ? esc(q.note || '') : ''}"></label>
    ${docPickerHtml('qDoc')}
  </div>`, `<button class="btn primary" id="qSave">ذخیره</button><button class="btn" id="qCancel">انصراف</button>`)
  const qStore = { doc: null }
  wireToday($('#modalBody')); wireMoney($('#modalBody')); wireDocPicker('qDoc', qStore)
  $('#qCancel').onclick = closeModal
  $('#qSave').onclick = guard(async () => {
    const dt = readDate('qd')
    const payload = { projectId, vendorId: +$('#qVendor').value, vendorName: $('#qVendorName').value.trim(), amount: readMoney($('#qAmount')), jy: dt.jy, jm: dt.jm, jd: dt.jd, note: $('#qNote').value.trim() }
    const r = q ? await post('/api/quotes/' + q.id, payload, 'PUT') : await post('/api/quotes', payload)
    const qid = q ? q.id : r.id
    if (qStore.doc && qid) await post(`/api/attachments/quote/${qid}`, { doc: qStore.doc })
    closeModal(); toast('ذخیره شد'); after ? after() : render()
  })
}

function cInvoiceRow(ci) {
  const paidAmt = ci.paid_amount != null ? ci.paid_amount : (ci.paid ? ci.amount : 0)
  const rem = ci.amount - paidAmt
  const paid = paidAmt <= 0 ? '<span class="badge b-open">تسویه‌نشده</span>'
    : rem <= 0 ? '<span class="badge b-ok">تسویه</span>'
      : `<span class="badge b-open">جزئی</span><br><span class="hint">پرداخت ${money(paidAmt)} · مانده ${money(rem)}</span>`
  const kindBadge = ci.kind === 'sale' ? '<span class="badge b-done">فروش</span>' : '<span class="badge b-no">خرید</span>'
  const files = (ci.attachments || []).map(a => `<a class="attmini" href="/uploads/${encodeURI(a.file)}" target="_blank" rel="noopener" title="${esc(a.display_name || 'سند')}">📎</a>`).join('')
  return `<tr>
    <td><span class="hint">سند ${faDigit(ci.id)}</span><br><b>${esc(ci.vendorLabel)}</b> ${kindBadge}${ci.title ? `<br><span class="hint">${esc(ci.title)}</span>` : ''}</td>
    <td class="num ${ci.kind === 'sale' ? 'amt-in' : ''}">${ci.kind === 'sale' ? '−' : ''}${money(ci.amount)} ${curFa()}</td>
    <td class="num">${ci.j_date ? faDigit(ci.j_date) : '—'}</td>
    <td>${paid}</td>
    <td>${files}${adminOnly(`<button class="btn tiny" data-ci-att="${ci.id}" title="افزودن سند">＋</button>`)}</td>
    <td class="rowact">${adminOnly(`<button class="btn tiny ${rem > 0 ? 'primary' : ''}" data-ci-pay="${ci.id}" title="پرداخت‌ها (با تاریخ هر قسط)">💸 پرداخت‌ها</button><button class="btn tiny" data-ci-edit="${ci.id}" title="ویرایش">✏️</button><button class="btn tiny" data-ci-del="${ci.id}">🗑</button>`)}</td></tr>`
}
async function cInvoiceForm(projectId, ci = null, after) {
  const vendors = await api('/api/vendors')
  const j = ci && ci.j_date ? parseJ(ci.j_date) : null
  openModal(ci ? 'ویرایش فاکتور پیمانکار' : 'ثبت فاکتور پیمانکار', `<div class="form">
    <label class="f">پیمانکار<select class="inp" id="ciVendor"><option value="0">— انتخاب از فهرست —</option>
      ${vendors.map(v => `<option value="${v.id}" ${ci && +ci.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="f">یا نام پیمانکار (اگر در فهرست نیست)<input class="inp" id="ciVendorName" value="${ci && !+ci.vendor_id ? esc(ci.vendor_name || '') : ''}"></label>
    <label class="f">شرح فاکتور<input class="inp" id="ciTitle" value="${ci ? esc(ci.title || '') : ''}" placeholder="مثلاً: مرحله اول نقاشی"></label>
    <div class="frow">
      <label class="f">مبلغ (${curFa()})<input class="inp num" id="ciAmount" data-money="ciAmountHint" inputmode="numeric" value="${ci ? sep(Math.round(r2d(ci.amount))) : ''}"><span class="hint" id="ciAmountHint"></span></label>
      <label class="f">تاریخ${dateBoxHtml('cid', j)}</label>
    </div>
    <label class="f">نوع<select class="inp" id="ciKind"><option value="purchase" ${!ci || ci.kind !== 'sale' ? 'selected' : ''}>خرید / هزینه (به هزینه اضافه می‌شود)</option><option value="sale" ${ci && ci.kind === 'sale' ? 'selected' : ''}>فروش / درآمد (از هزینه کم می‌شود)</option></select></label>
    ${ci ? `<div class="notice info" style="margin:0">پرداخت‌شده تا امروز: <b class="num">${moneyU(ci.paid_amount || 0)}</b> — پرداخت‌ها (با تاریخ هر قسط) از دکمهٔ «💸 پرداخت‌ها» ثبت یا اصلاح می‌شوند.</div>
      <input type="hidden" id="ciPaidAmount" value="">`
    : `<div class="frow" style="align-items:end">
      <label class="f">پرداخت/دریافت همین الان (${curFa()})<input class="inp num" id="ciPaidAmount" data-money="ciPaidHint" inputmode="numeric"><span class="hint" id="ciPaidHint">خالی = هنوز پرداخت نشده؛ قسط‌های بعدی از دکمهٔ «پرداخت‌ها»</span></label>
      <button type="button" class="btn" id="ciPaidFull">= کل مبلغ</button>
    </div>
    <p class="hint" id="ciRemHint"></p>`}
    <label class="f">توضیح<input class="inp" id="ciNote" value="${ci ? esc(ci.note || '') : ''}"></label>
    ${!ci ? `<p class="hint">مثال فروش: فروش داغیِ منبع قدیمی.</p>` : ''}
    ${docPickerHtml('ciDoc')}
  </div>`, `<button class="btn primary" id="ciSave">ذخیره</button><button class="btn" id="ciCancel">انصراف</button>`)
  const ciStore = { doc: null }
  wireToday($('#modalBody')); wireMoney($('#modalBody')); wireDocPicker('ciDoc', ciStore)
  $('#ciCancel').onclick = closeModal
  // مبلغ پرداختی تا وقتی کاربر دستی نزده، با مبلغِ فاکتور هم‌گام می‌ماند (پیش‌فرض: پرداخت کامل)
  const store = { paidEdited: true }
  const refreshRem = () => {
    if (ci || !$('#ciRemHint')) return
    const amt = readMoney($('#ciAmount')), paid = readMoney($('#ciPaidAmount')), rem = amt - paid
    $('#ciRemHint').innerHTML = amt > 0
      ? (rem > 0 ? `مانده بدهی به پیمانکار: <b class="amt-out">${moneyU(rem)}</b>` : rem < 0 ? `<b class="amt-out">مبلغ پرداختی از فاکتور بیشتر است!</b>` : '<b class="amt-in">تسویهٔ کامل ✓</b>')
      : ''
  }
  $('#ciAmount').addEventListener('input', () => { if (!store.paidEdited) { $('#ciPaidAmount').value = $('#ciAmount').value } refreshRem() })
  $('#ciPaidAmount').addEventListener('input', () => { store.paidEdited = true; refreshRem() })
  if ($('#ciPaidFull')) $('#ciPaidFull').onclick = () => { $('#ciPaidAmount').value = $('#ciAmount').value; refreshRem() }
  refreshRem()
  $('#ciSave').onclick = guard(async () => {
    const amount = readMoney($('#ciAmount')); if (!amount) throw new Error('مبلغ فاکتور لازم است')
    const paidAmount = ci ? null : readMoney($('#ciPaidAmount'))
    if (paidAmount != null && paidAmount > amount) throw new Error('مبلغ پرداختی از مبلغ فاکتور بیشتر است')
    const dt = readDate('cid')
    const payload = { projectId, vendorId: +$('#ciVendor').value, vendorName: $('#ciVendorName').value.trim(), title: $('#ciTitle').value.trim(), amount, kind: $('#ciKind').value, jy: dt.jy, jm: dt.jm, jd: dt.jd, note: $('#ciNote').value.trim() }
    if (paidAmount != null) payload.paidAmount = paidAmount
    const r = ci ? await post('/api/contractor-invoices/' + ci.id, payload, 'PUT') : await post('/api/contractor-invoices', payload)
    const cid = ci ? ci.id : r.id
    if (ciStore.doc && cid) await post(`/api/attachments/cinvoice/${cid}`, { doc: ciStore.doc })
    closeModal(); toast('ذخیره شد'); after ? after() : render()
  })
}

// پرداخت‌های یک فاکتور پیمانکار: هر قسط با تاریخ و صندوقِ خودش
async function ciPayForm(ci, after) {
  const pays = await api(`/api/contractor-invoices/${ci.id}/payments`)
  const paid = pays.reduce((s, p) => s + p.amount, 0), rem = ci.amount - paid, sale = ci.kind === 'sale'
  const defFund = ci.fund_id || (META.funds.find(f => f.bucket === 'project') || META.funds[0] || {}).id
  const body = openModal(`${sale ? 'دریافت‌های' : 'پرداخت‌های'} فاکتور «${ci.title || ci.vendorLabel || ''}»`, `<div class="form">
    <div class="kpis" style="margin-bottom:6px">${kpi('مبلغ فاکتور', money(ci.amount))}${kpi(sale ? 'دریافت‌شده' : 'پرداخت‌شده', money(paid))}${kpi('مانده', money(rem), '', rem > 0 ? 'bad' : '')}</div>
    <div class="tablewrap"><table class="tx"><thead><tr><th>تاریخ</th><th>صندوق</th><th>مبلغ</th><th>توضیح</th><th></th></tr></thead><tbody>
      ${pays.length ? pays.map(p => `<tr><td class="num">${faDigit(p.j_date)}</td><td>${esc(p.fund_name || '—')}</td><td class="num">${money(p.amount)}</td><td class="hint">${esc(p.note || '')}</td>
        <td>${isAdmin() ? `<button class="btn tiny del" data-cpdel="${p.id}" title="حذف">🗑</button>` : ''}</td></tr>`).join('') : emptyRow(5, 'هنوز پرداختی ثبت نشده')}
    </tbody></table></div>
    ${isAdmin() && rem > 0 ? `<h4 style="margin:14px 0 6px">ثبتِ ${sale ? 'دریافتِ' : 'پرداختِ'} جدید</h4>
      <div class="frow"><label class="f">مبلغ (${curFa()})<input class="inp num" id="cpAmt" data-money="cpHint" inputmode="numeric" value="${sep(Math.round(r2d(rem)))}"><span class="hint" id="cpHint"></span></label>
        <label class="f">تاریخ${dateBoxHtml('cp')}</label></div>
      <div class="frow"><label class="f">از صندوق<select class="inp" id="cpFund">${META.funds.map(f => `<option value="${f.id}" ${f.id === defFund ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <label class="f">توضیح<input class="inp" id="cpNote" placeholder="مثلاً: قسط دوم"></label></div>` : ''}
  </div>`, `${isAdmin() && rem > 0 ? '<button class="btn primary" id="cpSave">ثبت</button>' : ''}<button class="btn" id="cpClose">بستن</button>`)
  wireMoney(body); wireToday(body)
  $('#cpClose').onclick = () => { closeModal(); after ? after() : refresh() }
  if ($('#cpSave')) $('#cpSave').onclick = guard(async () => {
    await post(`/api/contractor-invoices/${ci.id}/payments`, { amount: readMoney($('#cpAmt')), fundId: +$('#cpFund').value, note: $('#cpNote').value.trim(), ...readDate('cp') })
    toast('ثبت شد'); const fresh = { ...ci, paid_amount: paid + readMoney($('#cpAmt')) }; closeModal(); after ? after() : refresh(); ciPayForm(fresh, after)
  })
  body.querySelectorAll('[data-cpdel]').forEach(b => b.onclick = () => confirmReason('این پرداخت حذف شود؟ اثرش از صندوق برمی‌گردد.', async r => {
    await api(`/api/contractor-payments/${b.dataset.cpdel}?reason=${encodeURIComponent(r)}`, { method: 'DELETE' }); toast('حذف شد'); closeModal(); after ? after() : refresh(); ciPayForm(ci, after)
  }))
}
function vendorsManager() {
  const draw = guard(async () => {
    const vs = await api('/api/vendors')
    openModal('👷 دفترچه‌ی پیمانکاران', `<div class="form">
      ${adminOnly(`<div class="frow" style="align-items:end">
        <input class="inp" id="vnName" placeholder="نام پیمانکار">
        <input class="inp" id="vnPhone" placeholder="تلفن">
        <input class="inp" id="vnField" placeholder="زمینه (مثلاً آسانسور)">
        <button class="btn primary" id="vnAdd">＋ افزودن</button></div>`)}
      <div class="tablewrap"><table class="tx"><thead><tr><th>نام</th><th>زمینه</th><th>تلفن</th><th></th></tr></thead><tbody>
      ${vs.length ? vs.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.field || '—')}</td><td class="num">${faDigit(v.phone || '—')}</td>
        <td class="rowact">${adminOnly(`<button class="btn tiny" data-vn-edit="${v.id}">✏️</button><button class="btn tiny" data-vn-del="${v.id}">🗑</button>`)}</td></tr>`).join('') : emptyRow(4, 'هنوز پیمانکاری ثبت نشده')}
      </tbody></table></div></div>`)
    if ($('#vnAdd')) $('#vnAdd').onclick = guard(async () => {
      const name = $('#vnName').value.trim(); if (!name) return toast('نام لازم است', true)
      await post('/api/vendors', { name, phone: $('#vnPhone').value.trim(), field: $('#vnField').value.trim() })
      toast('افزوده شد'); draw()
    })
    document.querySelectorAll('[data-vn-edit]').forEach(b => b.onclick = () => vendorEditForm(vs.find(x => x.id === +b.dataset.vnEdit), draw))
    document.querySelectorAll('[data-vn-del]').forEach(b => b.onclick = () => { const v = vs.find(x => x.id === +b.dataset.vnDel)
      confirmBox(`پیمانکار «${v ? v.name : ''}» از فهرست حذف شود؟ فاکتورهای ثبت‌شده‌اش سر جایشان می‌مانند.`, async () => { await api('/api/vendors/' + b.dataset.vnDel, { method: 'DELETE' }); toast('حذف شد'); draw() }) })
  })
  draw()
}
function vendorEditForm(v, after) {
  openModal('ویرایش پیمانکار', `<div class="form">
    <label class="f">نام<input class="inp" id="veName" value="${esc(v.name)}"></label>
    <div class="frow">
      <label class="f">تلفن<input class="inp num" id="vePhone" inputmode="tel" value="${esc(v.phone || '')}"></label>
      <label class="f">زمینه<input class="inp" id="veField" value="${esc(v.field || '')}"></label>
    </div>
    <label class="f">یادداشت<input class="inp" id="veNote" value="${esc(v.note || '')}"></label>
  </div>`, `<button class="btn primary" id="veSave">ذخیره</button><button class="btn" id="veCancel">انصراف</button>`)
  $('#veCancel').onclick = () => (after ? after() : closeModal())
  $('#veSave').onclick = guard(async () => {
    const name = $('#veName').value.trim(); if (!name) throw new Error('نام لازم است')
    await post('/api/vendors/' + v.id, { name, phone: $('#vePhone').value.trim(), field: $('#veField').value.trim(), note: $('#veNote').value.trim() }, 'PUT')
    toast('ذخیره شد'); after ? after() : closeModal()
  })
}

VIEWS.help = async () => {
  const lan = LAN_URL
  let qr = ''
  try { if (lan) qr = qrSvg(lan, { scale: 6, margin: 2, dark: '#111', light: '#fff' }) } catch { qr = '' }
  const cards = [
    ['🚪', 'واحدها', 'ابتدا واحدهای ساختمان را با شماره، طبقه، متراژ، تعداد نفرات و نام ساکن وارد کنید. هر واحد می‌تواند شارژ اختصاصی داشته باشد. واحد خالی را با برداشتن تیک «واحد پر است» مشخص کنید تا از هزینه‌های خاص معاف شود.'],
    ['🧾', 'فاکتورها و تسهیم', 'هر هزینه‌ی ساختمان را به‌عنوان یک فاکتور ثبت کنید. مبلغ کل بین واحدهای مشمول به یکی از پنج روش (مساوی، متراژ، نفرات، شارژ هر واحد، دستی) تقسیم می‌شود و جمع سهم‌ها همیشه دقیقاً برابر مبلغ فاکتور می‌ماند.'],
    ['💰', 'دریافتی‌ها', 'واریز هر واحد را ثبت کنید. مبلغ خودکار از قدیمی‌ترین بدهی همان واحد تسویه می‌شود (اول قدیمی‌ترین بدهی) یا می‌توانید فاکتور مشخصی را تیک بزنید. مازاد، پیش‌پرداختِ واحد می‌شود و در فاکتورهای بعدی خودکار مصرف می‌گردد.'],
    ['🏦', 'صندوق‌ها و طلب مدیر', 'هر واریز به یک صندوق می‌رود و هر فاکتور از یک صندوق پرداخت می‌شود. اگر مدیر هزینه‌ای را از جیب خود بدهد، «طلب مدیر» بالا می‌رود و بعداً از صندوق تسویه می‌شود.'],
    ['📅', 'شارژ ماهانه', 'مبلغ شارژ سراسری را در تنظیمات تعیین کنید؛ در ابتدای هر ماه شارژ به‌صورت خودکار برای همه‌ی واحدهای مشمول صادر می‌شود. تغییر مبلغ شارژ، شارژهای صادرشده‌ی قبلی را تغییر نمی‌دهد.'],
    ['📑', 'گزارش‌ها', 'گزارش عملکرد مدیر مالی برای ارائه به هیئت مدیره، گزارش بدهکاران با قدمت بدهی، گزارش فاکتوری، کارت واحد با صورت‌حساب چاپی و تراز کل. همه‌ی جدول‌ها خروجی CSV سازگار با اکسل دارند.'],
    ['⚖️', 'مانده اولیه', 'اگر پیش از شروع کار با نرم‌افزار، واحدها بدهی/پیش‌پرداخت یا صندوق‌ها موجودی داشته‌اند، از تنظیمات ← مانده اولیه واردشان کنید تا دفاتر از همان نقطه تراز بماند.'],
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
     <div class="helpsec">⬇️ دریافت و به‌روزرسانی برنامه</div>
     <div id="updateBox"><div class="helpcard"><h3>در حال بررسی نسخه‌ی جدید…</h3>
       <p>یک لحظه صبر کنید یا <a class="link" href="${RELEASES_URL}" target="_blank" rel="noopener">صفحه‌ی دانلود نسخه‌ها ↗</a> را باز کنید.</p></div></div>
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
  renderUpdateBox()
}

// ==================== شروع ====================
boot().catch(e => { $('#auth').classList.remove('hidden'); $('#authErr').textContent = e.message })
