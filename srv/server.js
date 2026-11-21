// حسابدار ساختمان توی دید — سرور محلی (Node.js خالص + node:sqlite، بدون وابستگی)
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { readFile, mkdir, writeFile, rm, readdir, stat, chmod, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { toGregorian, toJalaali, jStr } from './public/jalaali.js'
import { makeZip } from './zip.js'
import { readZip } from './unzip.js'

const ROOT = import.meta.dirname
// ---------- حالت اپ نصب‌شده (ویندوز/مک) ----------
// در اپ بسته‌بندی‌شده، پوشه‌ی کد فقط-خواندنی است؛ پس داده در پوشه‌ی داده‌ی کاربر ذخیره می‌شود.
// Electron این دو متغیر را ست می‌کند: HS_PACKAGED=1 و HS_USER_DIR=<userData>
const PACKAGED = process.env.HS_PACKAGED === '1'
const USER_ROOT = process.env.HS_USER_DIR || join(ROOT, '..')
let PORT = Number(process.env.PORT) || 3000
const DATA_DIR = PACKAGED ? join(USER_ROOT, 'data') : join(ROOT, 'data')
const UP_DIR = join(USER_ROOT, 'uploads')
const PUB_DIR = join(ROOT, 'public')

if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
if (!existsSync(UP_DIR)) await mkdir(UP_DIR, { recursive: true })
// فایل درخواستِ ریستِ محلیِ کهنه = یک درِ باز؛ در هر بار بالا آمدن حذف می‌شود
await rm(join(USER_ROOT, 'reset.request'), { force: true })

// ---------- دیتابیس ----------
let db = new DatabaseSync(join(DATA_DIR, 'sakhteman.db'))
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL, floor INTEGER DEFAULT 0, area REAL DEFAULT 0,
    occupants INTEGER DEFAULT 0, resident_name TEXT DEFAULT '', phone TEXT DEFAULT '',
    occupied INTEGER DEFAULT 1, monthly_charge INTEGER,
    active INTEGER DEFAULT 1, note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'current',
    opening_balance INTEGER DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, default_method TEXT NOT NULL, include_vacant INTEGER NOT NULL,
    default_fund_id INTEGER, is_charge_cat INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, category_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    g_date TEXT NOT NULL, j_date TEXT NOT NULL,
    method TEXT NOT NULL, include_vacant INTEGER NOT NULL, fund_id INTEGER NOT NULL,
    paid_by_manager INTEGER DEFAULT 0, expense_kind TEXT DEFAULT 'variable',
    vendor TEXT DEFAULT '', note TEXT DEFAULT '', doc_file TEXT DEFAULT '',
    status TEXT DEFAULT 'open', is_charge INTEGER DEFAULT 0, charge_period TEXT DEFAULT '',
    is_opening INTEGER DEFAULT 0,
    created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(g_date);
  CREATE TABLE IF NOT EXISTS invoice_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL, unit_id INTEGER NOT NULL, share_amount INTEGER NOT NULL,
    UNIQUE(invoice_id, unit_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sh_unit ON invoice_shares(unit_id);
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    g_date TEXT NOT NULL, j_date TEXT NOT NULL, fund_id INTEGER NOT NULL,
    method TEXT DEFAULT '', doc_file TEXT DEFAULT '', note TEXT DEFAULT '',
    is_opening INTEGER DEFAULT 0,
    created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pay_unit ON payments(unit_id);
  CREATE TABLE IF NOT EXISTS payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL, share_id INTEGER NOT NULL, amount INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alloc_p ON payment_allocations(payment_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_s ON payment_allocations(share_id);
  CREATE TABLE IF NOT EXISTS credit_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER NOT NULL, invoice_id INTEGER DEFAULT 0, amount INTEGER DEFAULT 0,
    g_date TEXT DEFAULT '', j_date TEXT DEFAULT '', note TEXT DEFAULT '',
    created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credituse_unit ON credit_uses(unit_id);
  CREATE TABLE IF NOT EXISTS fund_txns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
    ref_payment_id INTEGER, ref_invoice_id INTEGER, peer_fund_id INTEGER,
    g_date TEXT NOT NULL, j_date TEXT NOT NULL,
    note TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ft_fund ON fund_txns(fund_id);
  CREATE TABLE IF NOT EXISTS charge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount INTEGER NOT NULL, effective_j TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS opening_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER NOT NULL UNIQUE, amount INTEGER NOT NULL,
    note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, role TEXT NOT NULL,
    pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
    active INTEGER DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  -- هزینه‌های ثابت دوره‌ای (ماهانه/هفتگی/فصلی) مثل سرویس آسانسور
  CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, amount INTEGER NOT NULL,
    period_kind TEXT NOT NULL DEFAULT 'monthly',
    category_id INTEGER NOT NULL, method TEXT NOT NULL, include_vacant INTEGER NOT NULL,
    fund_id INTEGER NOT NULL, expense_kind TEXT DEFAULT 'fixed',
    auto INTEGER DEFAULT 1, active INTEGER DEFAULT 1, created_at TEXT NOT NULL
  );
  -- پرداخت هزینه/فاکتور از صندوق (تفکیک تعهد از پرداخت). هر ردیف یک fund_txns خروجی معادل دارد.
  CREATE TABLE IF NOT EXISTS expense_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL, fund_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    g_date TEXT NOT NULL, j_date TEXT NOT NULL,
    note TEXT DEFAULT '', doc_file TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ep_inv ON expense_payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_ep_fund ON expense_payments(fund_id);
  -- تحویل مدیریت مالی به مدیر بعدی از یک تاریخ مشخص
  CREATE TABLE IF NOT EXISTS manager_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outgoing_name TEXT DEFAULT '', incoming_name TEXT NOT NULL,
    j_date TEXT NOT NULL, g_date TEXT NOT NULL,
    settled_amount INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  -- رویدادهای امنیتی (بازیابی/ریست رمز)
  CREATE TABLE IF NOT EXISTS security_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,            -- recovery_generated | recovery_used | local_reset | recovery_failed
    username TEXT DEFAULT '', detail TEXT DEFAULT '', ip TEXT DEFAULT '',
    g_date TEXT NOT NULL, j_date TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS report_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, phone TEXT DEFAULT '', role TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  -- ماژول رویدادها و پروژه‌ها --
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                 -- meeting | decision | proposal
    title TEXT NOT NULL, g_date TEXT DEFAULT '', j_date TEXT DEFAULT '',
    summary TEXT DEFAULT '', attendees TEXT DEFAULT '',
    status TEXT DEFAULT '',             -- approved | rejected | pending | done
    parent_id INTEGER DEFAULT 0,        -- تصمیم/پیشنهاد ذیل یک جلسه
    project_id INTEGER DEFAULT 0,
    created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, status TEXT DEFAULT 'approved',
    budget INTEGER DEFAULT 0, decision_event_id INTEGER DEFAULT 0,
    note TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, phone TEXT DEFAULT '', field TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL, vendor_id INTEGER DEFAULT 0, vendor_name TEXT DEFAULT '',
    amount INTEGER DEFAULT 0, g_date TEXT DEFAULT '', j_date TEXT DEFAULT '',
    note TEXT DEFAULT '', selected INTEGER DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contractor_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER DEFAULT 0, vendor_id INTEGER DEFAULT 0, vendor_name TEXT DEFAULT '',
    title TEXT DEFAULT '', amount INTEGER DEFAULT 0, g_date TEXT DEFAULT '', j_date TEXT DEFAULT '',
    paid INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    file TEXT NOT NULL, display_name TEXT DEFAULT '', created_at TEXT NOT NULL
  );
`
// افزودن امن ستون‌های جدید به دیتابیس‌های موجود (بدون از دست رفتن داده)
function migrate() {
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  const addCol = (t, c, def) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`) }
  addCol('invoices', 'recur_id', 'INTEGER DEFAULT 0')
  addCol('invoices', 'recur_period', `TEXT DEFAULT ''`)
  addCol('invoices', 'is_billing', 'INTEGER DEFAULT 0')   // 1 = صورت‌حساب ساکن (شارژ/جریمه)، نه هزینه‌ی صندوق
  addCol('fund_txns', 'peer_fund_id', 'INTEGER')
  addCol('users', 'recovery_hash', `TEXT DEFAULT ''`)     // کد بازیابیِ رمز (فقط هش، هرگز خودِ کد)
  addCol('users', 'recovery_salt', `TEXT DEFAULT ''`)
  addCol('users', 'recovery_set_at', `TEXT DEFAULT ''`)
  addCol('invoices', 'project_id', 'INTEGER DEFAULT 0')   // لینک شارژ پروژه به پروژه
  addCol('projects', 'final_amount', 'INTEGER DEFAULT 0') // مبلغ نهایی حسابرسی‌شده (مبنای تعدیل)
  addCol('units', 'common_units', 'INTEGER DEFAULT 0')    // نفرات مشاعات (جدا از نفرات واقعی)
  addCol('units', 'owner_name', `TEXT DEFAULT ''`)        // نام مالک (ساکن = مستاجر/بهره‌بردار)
  addCol('contractor_invoices', 'kind', `TEXT DEFAULT 'purchase'`) // purchase=خرید(هزینه) | sale=فروش(درآمد)
  addCol('invoices', 'payer', `TEXT DEFAULT 'tenant'`)    // بر عهدهٔ: tenant=مستاجر/ساکن | owner=مالک
  addCol('projects', 'charge_kind', `TEXT DEFAULT 'operational'`) // جاری=current | عملیاتی=operational
  addCol('invoices', 'doc_no', `TEXT DEFAULT ''`)         // شماره سند (روی سند فیزیکی صندوق‌دار)
  addCol('fund_txns', 'ref_cinvoice_id', 'INTEGER')       // پیوند تراکنش صندوق به فاکتور پیمانکار (خرید/فروش پروژه)
  addCol('payments', 'project_id', 'INTEGER DEFAULT 0')   // پرداختِ علامت‌خوردهٔ پروژه (دفترِ مجزا؛ مازاد = طلبِ پروژه)
  addCol('invoices', 'from_fund', 'INTEGER DEFAULT 0')    // 1 = هزینهٔ جاری از صندوق (بدون تقسیم/بدهکار کردن واحدها)
  addCol('contractor_invoices', 'paid_amount', 'INTEGER DEFAULT 0')
  addCol('fund_txns', 'ref_exppay_id', 'INTEGER')
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER, user_name TEXT,
    action TEXT NOT NULL, entity TEXT, entity_id INTEGER, label TEXT, reason TEXT DEFAULT '',
    before_json TEXT, after_json TEXT, body_json TEXT, path TEXT)`)
  db.exec(`CREATE TABLE IF NOT EXISTS contractor_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cinvoice_id INTEGER NOT NULL, fund_id INTEGER, amount INTEGER NOT NULL,
    g_date TEXT NOT NULL, j_date TEXT NOT NULL, note TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL)`)
  addCol('contractor_invoices', 'fund_id', 'INTEGER DEFAULT 0')
  addCol('fund_txns', 'ref_cpay_id', 'INTEGER')            // پیوندِ تراکنشِ صندوق به ردیفِ پرداختِ پیمانکار
  addCol('funds', 'bucket', `TEXT DEFAULT ''`)                // نقشِ صندوق: charge=شارژ/جاری · omrani=قبوض و متفرقه · project=عمرانی/پروژه          // پیوندِ دقیقِ خروجیِ صندوق به ردیفِ پرداختِ هزینه // مبلغِ پرداخت‌شده (پرداختِ جزئی مجاز)؛ مانده = amount − paid_amount
}
function ensureSchema() { db.exec(SCHEMA_SQL); migrate() }
ensureSchema()

const nowISO = () => new Date().toISOString()
const pad2 = n => String(n).padStart(2, '0')
const getSetting = (k, d = '') => { const r = db.prepare(`SELECT value FROM settings WHERE key=?`).get(k); return r != null ? r.value : d }
const setSetting = (k, v) => db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, String(v))
function lanUrl() {
  for (const ifs of Object.values(networkInterfaces())) for (const i of ifs || [])
    if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${PORT}`
  return ''
}

// ---------- تاریخ ----------
const gDateStr = (jy, jm, jd) => { const g = toGregorian(jy, jm, jd); return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}` }
function todayJ() { const d = new Date(); return toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
const periodOf = j => `${j.jy}/${pad2(j.jm)}`                 // «1405/05»
const curPeriod = () => periodOf(todayJ())
const splitPeriod = p => ({ jy: +p.slice(0, 4), jm: +p.slice(5, 7) })
function shiftPeriod(p, delta) {
  let { jy, jm } = splitPeriod(p); jm += delta
  while (jm < 1) { jm += 12; jy-- }
  while (jm > 12) { jm -= 12; jy++ }
  return `${jy}/${pad2(jm)}`
}
const periodFirstG = p => { const { jy, jm } = splitPeriod(p); return gDateStr(jy, jm, 1) }
const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
const faNum = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d])
const periodFa = p => { const { jy, jm } = splitPeriod(p); return `${J_MONTHS[jm - 1]} ${faNum(jy)}` }
const daysBetween = (gFrom, gTo) => Math.floor((Date.parse(gTo + 'T00:00:00Z') - Date.parse(gFrom + 'T00:00:00Z')) / 86400000)
const todayG = () => { const j = todayJ(); return gDateStr(j.jy, j.jm, j.jd) }

// ---------- ثابت‌ها ----------
const METHODS = ['equal', 'area', 'occupants', 'common', 'occ_common', 'per_unit_charge', 'custom']
const METHOD_FA = {
  equal: 'مساوی بین واحدها', area: 'بر اساس متراژ', occupants: 'بر اساس نفرات',
  common: 'بر اساس مشاعات', occ_common: 'نفرات + مشاعات (سرانه)', per_unit_charge: 'شارژ هر واحد', custom: 'دستی'
}
const EXPENSE_KINDS = ['fixed', 'variable', 'unexpected']
const EXPENSE_KIND_FA = { fixed: 'ثابت', variable: 'متغیر', unexpected: 'پیش‌بینی‌نشده' }
const FUND_KINDS = ['current', 'reserve', 'custom']
const FUND_BUCKETS = ['charge', 'omrani', 'project']
const FUND_BUCKET_FA = { charge: 'شارژ و هزینه‌های جاری', omrani: 'قبوض و متفرقه (تقسیم بین واحدها)', project: 'عمرانی و پروژه‌ها' }
// نقشِ صندوق از ستونِ bucket؛ فقط برای داده‌ای که هنوز مهاجرت نشده، از نام حدس زده می‌شود
const bucketOfFund = f => (f && FUND_BUCKETS.includes(f.bucket)) ? f.bucket
  : (f && /شارژ|جاری/.test(f.name || '')) ? 'charge' : (f && /قبوض|متفرقه/.test(f.name || '')) ? 'omrani' : 'project'
const FUND_KIND_FA = { current: 'جاری', reserve: 'ذخیره/تعمیرات', custom: 'دلخواه' }
const ROLES = ['admin', 'board', 'inspector']
const ROLE_FA = { admin: 'مدیر ساختمان', board: 'رئیس هیئت مدیره', inspector: 'بازرس' }
const PAY_METHODS = ['نقد', 'کارت', 'حواله']
const PERIOD_KINDS = ['monthly', 'weekly', 'seasonal']
const PERIOD_KIND_FA = { monthly: 'ماهانه', weekly: 'هفتگی', seasonal: 'فصلی' }
const SEASON_FA = ['بهار', 'تابستان', 'پاییز', 'زمستان']
const OPENING_G = '1900-01-01'      // تاریخ ساختگی مانده‌ی اولیه تا در FIFO همیشه اول باشد
const OPENING_J = '۰۰۰۰/۰۰'
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.svg': 'image/svg+xml'
}
const DEFAULT_CHARGE = 8000000   // ۸٬۰۰۰٬۰۰۰ ریال = ۸۰۰ هزار تومان

// ---------- داده‌ی پیش‌فرض اولین اجرا ----------
function seedDefaults() {
  if (db.prepare(`SELECT COUNT(*) c FROM funds`).get().c === 0) {
    db.prepare(`INSERT INTO funds(name,kind,opening_balance,created_at) VALUES(?,?,0,?)`).run('صندوق جاری', 'current', nowISO())
    db.prepare(`INSERT INTO funds(name,kind,opening_balance,created_at) VALUES(?,?,0,?)`).run('صندوق تعمیرات', 'reserve', nowISO())
  }
  if (db.prepare(`SELECT COUNT(*) c FROM expense_categories`).get().c === 0) {
    const cur = db.prepare(`SELECT id FROM funds WHERE kind='current' ORDER BY id`).get()
    const res = db.prepare(`SELECT id FROM funds WHERE kind='reserve' ORDER BY id`).get() || cur
    const rows = [
      ['شارژ ماهانه', 'per_unit_charge', 0, cur.id, 1],
      ['موتورخانه', 'area', 0, cur.id, 0],
      ['آسانسور', 'equal', 0, cur.id, 0],
      ['آب', 'occupants', 0, cur.id, 0],
      ['گاز', 'occupants', 0, cur.id, 0],
      ['پسماند', 'occupants', 0, cur.id, 0],
      ['برق مشاع', 'equal', 1, cur.id, 0],
      ['آب مشاع', 'equal', 1, cur.id, 0],
      ['تعمیرات مشترک', 'equal', 0, res.id, 0],
      ['تعمیرات اساسی', 'area', 1, res.id, 0],
      ['نظافت', 'equal', 0, cur.id, 0],
      ['سایر', 'equal', 0, cur.id, 0]
    ]
    const st = db.prepare(`INSERT INTO expense_categories(name,default_method,include_vacant,default_fund_id,is_charge_cat,sort) VALUES(?,?,?,?,?,?)`)
    rows.forEach((r, i) => st.run(r[0], r[1], r[2], r[3], r[4], i))
  }
  if (db.prepare(`SELECT COUNT(*) c FROM charge_history`).get().c === 0)
    db.prepare(`INSERT INTO charge_history(amount,effective_j,created_at) VALUES(?,?,?)`).run(DEFAULT_CHARGE, curPeriod(), nowISO())
  if (getSetting('buildingName', null) === null) setSetting('buildingName', 'ساختمان')
  if (getSetting('displayUnit', null) === null) setSetting('displayUnit', 'toman')
  if (getSetting('managerOpening', null) === null) setSetting('managerOpening', '0')
  if (getSetting('totalUnits', null) === null) setSetting('totalUnits', '0')   // ۰ = تعیین‌نشده
  if (getSetting('managerName', null) === null) setSetting('managerName', '')
  if (getSetting('lateFeePercent', null) === null) setSetting('lateFeePercent', '0')   // ۰ = خاموش
  if (getSetting('lateFeeGraceDays', null) === null) setSetting('lateFeeGraceDays', '30')
}
seedDefaults()

// مهاجرت داده به مدل تفکیک هزینه: فاکتورهای قبلی که مستقیم از صندوق کسر شده بودند،
// به‌عنوان «پرداخت از صندوق» ثبت می‌شوند تا مانده‌ها دقیقاً حفظ و تاریخچه سازگار بماند.
function migrateData() {
  if (getSetting('mig_expense_pay', '') === '1') return
  const legacy = db.prepare(`SELECT * FROM fund_txns WHERE type='out' AND ref_invoice_id IS NOT NULL`).all()
  const ins = db.prepare(`INSERT INTO expense_payments(invoice_id,fund_id,amount,g_date,j_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
  for (const t of legacy) {
    if (db.prepare(`SELECT 1 FROM invoices WHERE id=?`).get(t.ref_invoice_id))
      ins.run(t.ref_invoice_id, t.fund_id, t.amount, t.g_date, t.j_date, t.note || '', t.created_by, t.created_at || nowISO())
  }
  setSetting('mig_expense_pay', '1')
}
migrateData()
// عطف‌به‌ماسبق: فاکتورهای پیمانکارِ «تسویه‌شده»ی قدیمی، مبلغِ پرداختی‌شان = کلِ مبلغ شود
function migrateCInvoicePaidAmount() {
  if (getSetting('mig_cinv_paidamt', '') === '1') return
  db.prepare(`UPDATE contractor_invoices SET paid_amount=amount WHERE paid=1 AND COALESCE(paid_amount,0)=0`).run()
  setSetting('mig_cinv_paidamt', '1')
}
migrateCInvoicePaidAmount()
// عطف‌به‌ماسبق: وضعیتِ فاکتورهای «جاری/از محل شارژ» بر اساس پرداختِ صندوق (نه وصول از ساکنین) بازمحاسبه شود
function migrateFromFundStatus() {
  if (getSetting('mig_fromfund_status', '') === '1') return
  const fp = `(SELECT COALESCE(SUM(amount),0) FROM expense_payments WHERE invoice_id=invoices.id)`
  db.prepare(`UPDATE invoices SET status='settled' WHERE COALESCE(from_fund,0)=1 AND is_opening=0 AND ${fp} >= amount`).run()
  db.prepare(`UPDATE invoices SET status='open'     WHERE COALESCE(from_fund,0)=1 AND is_opening=0 AND ${fp} <  amount`).run()
  setSetting('mig_fromfund_status', '1')
}
migrateFromFundStatus()
// پیوند دادنِ خروجی‌های قدیمیِ صندوق به ردیف‌های پرداختِ هزینه (یک‌به‌یک)
function migrateExpPayLinks() {
  if (getSetting('mig_exppay_link', '') === '1') return
  const used = new Set()
  for (const ep of db.prepare(`SELECT * FROM expense_payments ORDER BY id`).all()) {
    const cands = db.prepare(`SELECT id FROM fund_txns WHERE type='out' AND ref_exppay_id IS NULL AND fund_id=? AND ref_invoice_id=? AND amount=? ORDER BY (g_date=?) DESC, id`).all(ep.fund_id, ep.invoice_id, ep.amount, ep.g_date)
    const t = cands.find(c => !used.has(c.id)); if (!t) continue
    used.add(t.id); db.prepare(`UPDATE fund_txns SET ref_exppay_id=? WHERE id=?`).run(ep.id, t.id)
  }
  setSetting('mig_exppay_link', '1')
}
migrateExpPayLinks()
function migrateFundBuckets() {
  for (const f of db.prepare(`SELECT * FROM funds WHERE COALESCE(bucket,'')=''`).all())
    db.prepare(`UPDATE funds SET bucket=? WHERE id=?`).run(bucketOfFund({ name: f.name }), f.id)
}
migrateFundBuckets()
function migrateCiPayments() {
  if (getSetting('mig_ci_payments', '') === '1') return
  for (const ci of db.prepare(`SELECT * FROM contractor_invoices WHERE COALESCE(paid_amount,0) > 0`).all()) {
    if (db.prepare(`SELECT 1 FROM contractor_payments WHERE cinvoice_id=?`).get(ci.id)) continue
    const tx = db.prepare(`SELECT * FROM fund_txns WHERE ref_cinvoice_id=? ORDER BY id LIMIT 1`).get(ci.id)
    const cpId = Number(db.prepare(`INSERT INTO contractor_payments(cinvoice_id,fund_id,amount,g_date,j_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(ci.id, tx ? tx.fund_id : null, ci.paid_amount, tx ? tx.g_date : ci.g_date, tx ? tx.j_date : ci.j_date, 'انتقال از سابقهٔ قبلی', null, nowISO()).lastInsertRowid)
    if (tx) db.prepare(`UPDATE fund_txns SET ref_cpay_id=? WHERE id=?`).run(cpId, tx.id)
  }
  setSetting('mig_ci_payments', '1')
}
migrateCiPayments()

// ---------- احراز هویت ----------
const sessions = new Map()   // sid → { uid, exp, last }
const SESSION_MAX_MS = 30 * 86400000, SESSION_IDLE_MS = 14 * 86400000
const PW_MIN = 8, PW_MIN_MSG = 'رمز باید حداقل ۸ کاراکتر باشد'
function newSession(uid) { const t = randomBytes(24).toString('hex'); sessions.set(t, { uid, exp: Date.now() + SESSION_MAX_MS, last: Date.now() }); return t }
function killSessionsOf(uid, exceptSid = null) { for (const [k, v] of sessions) if (v.uid === uid && k !== exceptSid) sessions.delete(k) }
// محدودیتِ تلاشِ ورود (در حافظه، چون پاسخِ ناموفق تراکنش را برمی‌گرداند): ۵ خطا برای یک نام کاربری یا ۲۰ خطا از یک IP → قفل ۱۵ دقیقه
const loginFails = new Map()
function loginLockedMin(key) { const s = loginFails.get(key); return s && s.until > Date.now() ? Math.ceil((s.until - Date.now()) / 60000) : 0 }
function loginFail(key, max) {
  let s = loginFails.get(key); if (!s || (s.until && s.until <= Date.now())) s = { count: 0, until: 0 }
  s.count++; if (s.count >= max) s.until = Date.now() + 15 * 60000
  loginFails.set(key, s); return s.until > Date.now()
}
function hashPw(pw) { const salt = randomBytes(16); return { hash: scryptSync(pw, salt, 32).toString('hex'), salt: salt.toString('hex') } }
function verifyPw(pw, hashHex, saltHex) {
  const h = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32)
  const stored = Buffer.from(hashHex, 'hex')
  return h.length === stored.length && timingSafeEqual(h, stored)
}
function getCookie(req, name) {
  const h = req.headers.cookie || ''
  for (const p of h.split(';')) { const i = p.indexOf('='); if (i < 0) continue; if (p.slice(0, i).trim() === name) return decodeURIComponent(p.slice(i + 1).trim()) }
  return null
}
function authUser(req) {
  const sid = getCookie(req, 'sid'); if (!sid) return null
  const ss = sessions.get(sid); if (!ss) return null
  const now = Date.now()
  if (now > ss.exp || now - ss.last > SESSION_IDLE_MS) { sessions.delete(sid); return null }
  ss.last = now
  return db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(ss.uid) || null
}
const userPublic = u => u && ({ id: u.id, username: u.username, name: u.display_name, role: u.role, roleFa: ROLE_FA[u.role] })

// ---------- بازیابی رمز ----------
const delay = ms => new Promise(r => setTimeout(r, ms))
const clientIp = req => (req.socket && req.socket.remoteAddress) || ''
const isLoopback = req => { const a = clientIp(req); return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' }
// الفبای بدونِ کاراکترهای مبهم (بدون I، O، 0، 1)
const RC_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeRecoveryCode() {
  const b = randomBytes(16); let s = ''
  for (let i = 0; i < 16; i++) s += RC_ALPHA[b[i] % RC_ALPHA.length]
  return s.match(/.{4}/g).join('-')          // مثال: K7QP-3MZR-XW9T-BHNV
}
const normalizeCode = c => String(c || '').toUpperCase().replace(/[^A-Z2-9]/g, '')
// کد بازیابیِ جدید: فقط هش ذخیره می‌شود؛ خودِ کد یک‌بار برگردانده و دیگر قابل بازخوانی نیست
function setRecoveryCode(userId) {
  const code = makeRecoveryCode()
  const { hash, salt } = hashPw(normalizeCode(code))
  db.prepare(`UPDATE users SET recovery_hash=?, recovery_salt=?, recovery_set_at=? WHERE id=?`).run(hash, salt, nowISO(), userId)
  return code
}
// محدودیت نرخ (مقاوم به ری‌استارت — در جدول settings): ۵ تلاش → قفل ۱۵ دقیقه
const RC_MAX = 5, RC_LOCK_MS = 15 * 60000
const rcState = username => {
  const raw = getSetting('rc_fail_' + username, ''); if (!raw) return { count: 0, until: 0 }
  const [c, u] = raw.split('|'); return { count: +c || 0, until: u ? Date.parse(u) || 0 : 0 }
}
const rcLockedMin = username => { const s = rcState(username); return (s.until && Date.now() < s.until) ? Math.ceil((s.until - Date.now()) / 60000) : 0 }
function rcFail(username) {
  let s = rcState(username)
  if (s.until && Date.now() >= s.until) s = { count: 0, until: 0 }   // قفل منقضی‌شده ⇒ شمارنده صفر
  const count = s.count + 1
  const until = count >= RC_MAX ? new Date(Date.now() + RC_LOCK_MS).toISOString() : ''
  setSetting('rc_fail_' + username, count + '|' + until)
}
const rcClear = username => db.prepare(`DELETE FROM settings WHERE key=?`).run('rc_fail_' + username)
function logSecurity(event, username, detail, ip) {
  const t = todayJ()
  db.prepare(`INSERT INTO security_log(event,username,detail,ip,g_date,j_date,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(event, username || '', detail || '', ip || '', todayG(), jStr(t.jy, t.jm, t.jd), nowISO())
}
async function resetRequestFresh() {
  try { const st = await stat(join(USER_ROOT, 'reset.request')); return (Date.now() - st.mtimeMs) < 10 * 60000 } catch { return false }
}

// ---------- کمک‌کارهای HTTP ----------
function sendJSON(res, code, obj, headers = {}) {
  res._json = obj
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(obj))
}
function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('حجم درخواست زیاد است')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
const jbody = async req => { const b = JSON.parse((await readBody(req)).toString('utf8') || '{}'); req._body = b; return b }
let docSeq = 0
const safeFolder = s => ((s || '').trim().replace(/[\/\\:*?"<>| -]/g, '-').replace(/\s+/g, ' ').slice(0, 60) || 'بدون-نام')
async function saveDoc(doc, subdir = '') {
  if (!doc || !doc.dataUrl) return ''
  const m = /^data:([^;]+);base64,(.+)$/s.exec(doc.dataUrl); if (!m) return ''
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 20 * 1024 * 1024) throw new Error('حجم سند بیش از ۲۰ مگابایت است')
  let ext = extname(doc.name || '').toLowerCase()
  if (!ext) ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf', 'image/webp': '.webp' })[m[1]] || '.bin'
  const dir = subdir ? join(UP_DIR, subdir) : UP_DIR
  await mkdir(dir, { recursive: true })
  docSeq = (docSeq + 1) % 100000
  const fname = `doc_${Date.now()}_${docSeq}${ext}`
  await writeFile(join(dir, fname), buf)
  return subdir ? subdir + '/' + fname : fname
}

// ---------- واحدها ----------
const listUnits = (onlyActive = false) =>
  db.prepare(`SELECT * FROM units ${onlyActive ? 'WHERE active=1' : ''} ORDER BY active DESC, floor, CAST(number AS INTEGER), number, id`).all()
const unitLabel = u => u ? `واحد ${u.number}${u.resident_name ? ' — ' + u.resident_name : ''}` : '—'

// واحدهای مشمول یک فاکتور: همه‌ی واحدهای فعال.
// «خالی» بودن واحد فقط در روش‌های مصرفی (نفرات) سهمش را صفر می‌کند؛ در مساوی/متراژ/عمرانی کامل سهم می‌دهد.
const eligibleUnits = () =>
  db.prepare(`SELECT * FROM units WHERE active=1 ORDER BY id`).all()

// ---------- مبلغ شارژ ----------
function chargeAmountAt(period) {
  const r = db.prepare(`SELECT amount FROM charge_history WHERE effective_j<=? ORDER BY effective_j DESC, id DESC`).get(period)
  if (r) return r.amount
  const first = db.prepare(`SELECT amount FROM charge_history ORDER BY effective_j, id`).get()
  return first ? first.amount : DEFAULT_CHARGE
}
const unitChargeAt = (u, period) => (u.monthly_charge != null ? u.monthly_charge : chargeAmountAt(period))

// ---------- موتور تسهیم ----------
// سهم‌ها به ریال صحیح گرد می‌شوند و اختلافِ گرد کردن به سهم بزرگ‌ترین واحد اعمال می‌شود
// تا Σسهم‌ها همیشه دقیقاً برابر مبلغ فاکتور بماند (بند ۴ سند مشخصات).
function computeShares(units, method, amount, opts = {}) {
  if (!units.length) return []
  let raw
  if (method === 'equal') {
    raw = units.map(u => ({ unit_id: u.id, v: amount / units.length }))
  } else if (method === 'area' || method === 'occupants' || method === 'common' || method === 'occ_common') {
    // common = نفرات مشاعات؛ occ_common = نفرات + نفرات مشاعات
    // نکته: در occ_common، واحدِ خالی (بدون ساکن) نفراتش صفر حساب می‌شود و فقط سهمِ مشاعات می‌دهد
    const val = u => method === 'area' ? (+u.area || 0)
      : method === 'occupants' ? (u.occupied ? (+u.occupants || 0) : 0)
      : method === 'common' ? (+u.common_units || +u.occupants || 0)
      : ((u.occupied ? (+u.occupants || 0) : 0) + (+u.common_units || 0))
    const total = units.reduce((s, u) => s + val(u), 0)
    // اگر مجموع صفر باشد (هنوز وارد نشده)، به تسهیم مساوی برمی‌گردیم تا فاکتور بی‌سهم نماند
    raw = total > 0
      ? units.map(u => ({ unit_id: u.id, v: amount * val(u) / total }))
      : units.map(u => ({ unit_id: u.id, v: amount / units.length }))
  } else if (method === 'per_unit_charge') {
    const period = opts.period || curPeriod()
    raw = units.map(u => ({ unit_id: u.id, v: unitChargeAt(u, period) }))
  } else if (method === 'custom') {
    const map = opts.custom || {}
    raw = units.map(u => ({ unit_id: u.id, v: Math.round(+map[u.id] || 0) }))
  } else throw new Error('روش تسهیم نامعتبر است')

  const out = raw.map(r => ({ unit_id: r.unit_id, share_amount: Math.round(r.v) }))
  // per_unit_charge و custom مبلغشان از خودِ سهم‌ها می‌آید و نیازی به اصلاح گرد کردن ندارند
  if (method === 'per_unit_charge' || method === 'custom') return out
  const sum = out.reduce((s, r) => s + r.share_amount, 0)
  const diff = amount - sum
  if (diff !== 0) {
    let big = out[0]
    for (const r of out) if (r.share_amount > big.share_amount) big = r
    big.share_amount += diff
  }
  return out
}

// مبلغ کل یک تسهیم (برای روش‌هایی که مبلغ از سهم‌ها می‌آید)
const sumShares = list => list.reduce((s, r) => s + r.share_amount, 0)

// ---------- تخصیص پرداخت ----------
const shareAllocated = shareId => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payment_allocations WHERE share_id=?`).get(shareId).s
const paymentAllocated = payId => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payment_allocations WHERE payment_id=?`).get(payId).s
const paymentLeftover = pay => pay.amount - paymentAllocated(pay.id)

// سهم‌های تسویه‌نشده‌ی یک واحد، از قدیمی‌ترین فاکتور (مانده‌ی اولیه همیشه اول است)
function openSharesOfUnit(unitId, onlyIds = null) {
  const rows = db.prepare(`SELECT s.*, i.g_date, i.id inv_id, i.project_id proj_id, i.is_charge chg, i.is_opening opn, i.is_billing bill FROM invoice_shares s
    JOIN invoices i ON i.id=s.invoice_id WHERE s.unit_id=?
    ORDER BY i.g_date, i.id, s.id`).all(unitId)
  const filtered = onlyIds ? rows.filter(r => onlyIds.includes(r.id) || onlyIds.includes(r.invoice_id)) : rows
  return filtered.filter(r => r.share_amount - shareAllocated(r.id) > 0)
}

// دستهٔ سبدِ یک صندوق بر اساس نامش: charge (شارژ/جاری) | omrani (قبوض/متفرقه) | project (عمرانی)
function fundBucket(fundId) {
  const f = fundId ? db.prepare(`SELECT * FROM funds WHERE id=?`).get(fundId) : null
  return bucketOfFund(f)
}
// آیا سهم s در سبدِ دستهٔ cat است؟ (chg=شارژ، opn=انتقالی، bill&proj=پروژه، باقی=قبوض/توزیعی)
const shareInBucket = (s, cat) => cat === 'charge' ? (s.chg || s.opn || (s.bill && !s.proj_id))
  : cat === 'project' ? (s.bill && !!s.proj_id)
  : (!s.chg && !s.opn && !s.bill && !s.proj_id)

// تخصیص یک پرداخت: اول به فاکتورهای هدف؛ سپس (جز در حالت strict) خودکار فقط روی سبدِ هم‌دستهٔ همان صندوقِ پرداخت
function allocatePayment(paymentId, targetInvoiceIds = null, strict = false) {
  const pay = db.prepare(`SELECT * FROM payments WHERE id=?`).get(paymentId)
  if (!pay) return 0
  let left = paymentLeftover(pay)
  if (left <= 0) return 0
  const queue = []
  if (pay.project_id) {
    // پرداختِ مخصوص پروژه: فقط به سهمِ فاکتور شارژِ همان پروژه می‌نشیند؛ مازاد به‌صورت طلبِ پروژه باقی می‌ماند (سرریز نمی‌کند)
    const inv = projectChargeInvoice(pay.project_id)
    if (inv) queue.push(...openSharesOfUnit(pay.unit_id, [inv.id]))
  } else {
    const all = openSharesOfUnit(pay.unit_id)
    const tset = new Set(targetInvoiceIds && targetInvoiceIds.length ? targetInvoiceIds : [])
    const targeted = tset.size ? all.filter(s => tset.has(s.invoice_id)) : []
    // strict: فقط روی فاکتورهای هدف؛ مازاد به‌صورت بستانکاری می‌ماند (برای «بابتِ یک فاکتورِ مشخص»)
    // غیرِ strict: پس از هدف‌ها، خودکار FIFO فقط روی سبدِ هم‌دستهٔ همان صندوقِ پرداخت (قبوض→قبوض، عمرانی→پروژه، شارژ→شارژ)؛ هرگز بین صندوق‌ها جابه‌جا نمی‌شود
    const cat = fundBucket(pay.fund_id)
    const auto = strict ? [] : all.filter(s => !tset.has(s.invoice_id) && shareInBucket(s, cat))
    queue.push(...targeted, ...auto)
  }
  const ins = db.prepare(`INSERT INTO payment_allocations(payment_id,share_id,amount) VALUES(?,?,?)`)
  const touched = new Set()
  for (const s of queue) {
    if (left <= 0) break
    const rem = s.share_amount - shareAllocated(s.id)
    if (rem <= 0) continue
    const amt = Math.min(rem, left)
    ins.run(paymentId, s.id, amt)
    left -= amt; touched.add(s.invoice_id)
  }
  for (const iid of touched) refreshInvoiceStatus(iid)
  return pay.amount - left
}

// بستانکاری واحد = پرداخت‌های تخصیص‌نیافته. بعد از هر فاکتور جدید خودکار مصرف می‌شود.
function applyCreditsOfUnit(unitId) {
  const pays = db.prepare(`SELECT * FROM payments WHERE unit_id=? ORDER BY g_date, id`).all(unitId)
  for (const p of pays) if (paymentLeftover(p) > 0) allocatePayment(p.id)
}
const unitCredit = unitId => {
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE unit_id=?`).get(unitId).s
  const alloc = db.prepare(`SELECT COALESCE(SUM(a.amount),0) s FROM payment_allocations a
    JOIN payments p ON p.id=a.payment_id WHERE p.unit_id=?`).get(unitId).s
  return paid - alloc
}
// «پرداخت از محل طلبِ واحد»: بستانکاریِ موجود (پرداخت‌های تخصیص‌نیافته) را تا سقفِ cap روی سهم‌های هدف می‌نشاند.
// این عبورِ دستی از ایزولهٔ پروژه است (طلبِ یک پروژه می‌تواند خرجِ بدهیِ دیگر شود). پول نقدِ جدیدی وارد صندوق نمی‌شود.
function useCreditForShares(unitId, targetShares, cap) {
  let left = Math.max(0, Math.round(cap))
  const pays = db.prepare(`SELECT * FROM payments WHERE unit_id=? ORDER BY g_date, id`).all(unitId)
  const ins = db.prepare(`INSERT INTO payment_allocations(payment_id,share_id,amount) VALUES(?,?,?)`)
  const touched = new Set()
  for (const s of targetShares) {
    if (left <= 0) break
    let need = Math.min(left, s.share_amount - shareAllocated(s.id))
    if (need <= 0) continue
    for (const p of pays) {
      if (need <= 0) break
      const lo = paymentLeftover(p)
      if (lo <= 0) continue
      const amt = Math.min(lo, need)
      ins.run(p.id, s.id, amt)
      need -= amt; left -= amt; touched.add(s.invoice_id)
    }
  }
  for (const iid of touched) refreshInvoiceStatus(iid)
  return Math.round(cap) - left
}

// کم کردن تخصیص‌های یک سهم تا سقف تازه (از جدیدترین تخصیص) — پول آزادشده دوباره در گردش می‌افتد
function trimShareAllocations(shareId, maxAmount) {
  let alloc = shareAllocated(shareId)
  if (alloc <= maxAmount) return
  const rows = db.prepare(`SELECT * FROM payment_allocations WHERE share_id=? ORDER BY id DESC`).all(shareId)
  for (const a of rows) {
    if (alloc <= maxAmount) break
    const excess = alloc - maxAmount
    if (a.amount <= excess) { db.prepare(`DELETE FROM payment_allocations WHERE id=?`).run(a.id); alloc -= a.amount }
    else { db.prepare(`UPDATE payment_allocations SET amount=? WHERE id=?`).run(a.amount - excess, a.id); alloc -= excess }
  }
}

function invoiceCollected(invId) {
  return db.prepare(`SELECT COALESCE(SUM(a.amount),0) s FROM payment_allocations a
    JOIN invoice_shares s ON s.id=a.share_id WHERE s.invoice_id=?`).get(invId).s
}
function refreshInvoiceStatus(invId) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invId); if (!inv) return
  // هزینهٔ جاری (از محل شارژ): با پرداخت کاملِ صندوق تمام می‌شود (واحدها بدهکار نمی‌شوند)
  // شارژ/قبوض/پروژه: با وصولِ کامل از ساکنین
  const settled = inv.from_fund
    ? invoiceFundPaid(invId) >= inv.amount
    : invoiceCollected(invId) >= inv.amount
  db.prepare(`UPDATE invoices SET status=? WHERE id=?`).run(settled ? 'settled' : 'open', invId)
}

// نوشتن سهم‌های یک فاکتور (ساخت یا ویرایش). تخصیص‌های موجود حفظ می‌شوند و مازاد آزاد می‌گردد.
function writeShares(invId, shares) {
  const old = db.prepare(`SELECT * FROM invoice_shares WHERE invoice_id=?`).all(invId)
  const keep = new Set(shares.map(s => s.unit_id))
  const affected = new Set()
  for (const o of old) {
    affected.add(o.unit_id)
    if (!keep.has(o.unit_id)) {
      trimShareAllocations(o.id, 0)
      db.prepare(`DELETE FROM invoice_shares WHERE id=?`).run(o.id)
    }
  }
  const byUnit = {}; for (const o of old) byUnit[o.unit_id] = o
  for (const s of shares) {
    affected.add(s.unit_id)
    const ex = byUnit[s.unit_id]
    if (ex) {
      if (s.share_amount < shareAllocated(ex.id)) trimShareAllocations(ex.id, s.share_amount)
      db.prepare(`UPDATE invoice_shares SET share_amount=? WHERE id=?`).run(s.share_amount, ex.id)
    } else db.prepare(`INSERT INTO invoice_shares(invoice_id,unit_id,share_amount) VALUES(?,?,?)`).run(invId, s.unit_id, s.share_amount)
  }
  // پول آزادشده و بستانکاری‌ها دوباره روی قدیمی‌ترین بدهی‌ها می‌نشیند
  for (const uid of affected) applyCreditsOfUnit(uid)
  refreshInvoiceStatus(invId)
  for (const r of db.prepare(`SELECT DISTINCT s.invoice_id i FROM invoice_shares s WHERE s.unit_id IN (${[...affected].map(() => '?').join(',') || '0'})`).all(...affected))
    refreshInvoiceStatus(r.i)
}

// ---------- صندوق ----------
const FUND_IN = `('in','transfer_in','adjust_in')`
const FUND_OUT = `('out','transfer_out','manager_settle','adjust_out')`
const TXN_LABEL = { in: 'واریز ساکن', out: 'پرداخت فاکتور', transfer_in: 'انتقال ورودی', transfer_out: 'انتقال خروجی', manager_settle: 'تسویه با مدیر', adjust_in: 'سند تعدیل (افزایش)', adjust_out: 'سند تعدیل (کاهش)' }
function fundBalance(id) {
  const f = db.prepare(`SELECT opening_balance FROM funds WHERE id=?`).get(id); if (!f) return 0
  const i = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fund_txns WHERE fund_id=? AND type IN ${FUND_IN}`).get(id).s
  const o = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fund_txns WHERE fund_id=? AND type IN ${FUND_OUT}`).get(id).s
  return f.opening_balance + i - o
}
const listFunds = () => db.prepare(`SELECT * FROM funds ORDER BY id`).all()
  .map(f => ({ ...f, kindFa: FUND_KIND_FA[f.kind] || f.kind, balance: fundBalance(f.id) }))
function addFundTxn(fundId, type, amount, extra = {}) {
  if (!(amount > 0)) return
  const g = extra.g_date || todayG()
  const j = extra.j_date || (() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })()
  db.prepare(`INSERT INTO fund_txns(fund_id,type,amount,ref_payment_id,ref_invoice_id,peer_fund_id,ref_cinvoice_id,ref_exppay_id,ref_cpay_id,g_date,j_date,note,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(fundId, type, amount, extra.payId || null, extra.invId || null, extra.peer || null, extra.cinvId || null, extra.epId || null, extra.cpId || null, g, j, extra.note || '', extra.by || null, nowISO())
}
// صندوق اصلی (اولین صندوق)
const mainFundId = () => { const f = db.prepare(`SELECT id FROM funds ORDER BY id LIMIT 1`).get(); return f ? f.id : null }
// صندوق عمرانی — مقصد پیش‌فرضِ خرید/فروشِ پیمانکارِ پروژه (اگر نبود، صندوق اصلی)
const omraniFundId = () => { const f = db.prepare(`SELECT id FROM funds WHERE bucket='project' ORDER BY id LIMIT 1`).get() || db.prepare(`SELECT id FROM funds WHERE name LIKE '%عمران%' ORDER BY id LIMIT 1`).get(); return f ? f.id : mainFundId() }
// هم‌گام‌سازی اثر یک فاکتور پیمانکار روی صندوق: خریدِ پرداخت‌شده = خروج، فروشِ دریافت‌شده = ورود، پرداخت‌نشده = بدون تراکنش
// پرداخت‌های پیمانکار: هر پرداخت ردیفِ جدا با تاریخ و صندوقِ خودش و یک تراکنشِ صندوقِ مستقل دارد.
// ویرایشِ فاکتور (مبلغ/عنوان/تاریخ) به تراکنش‌های گذشتهٔ صندوق دست نمی‌زند.
const ciPaidSum = ciId => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM contractor_payments WHERE cinvoice_id=?`).get(ciId).s
function ciFundOf(ci) { return ci.fund_id && db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(ci.fund_id) ? ci.fund_id : omraniFundId() }
function refreshCiPaid(ciId) {
  const ci = db.prepare(`SELECT * FROM contractor_invoices WHERE id=?`).get(ciId); if (!ci) return
  const paid = ciPaidSum(ciId)
  db.prepare(`UPDATE contractor_invoices SET paid_amount=?, paid=? WHERE id=?`).run(paid, paid >= ci.amount ? 1 : 0, ciId)
}
function addCiPayment(ci, amount, d, fundId, note, by) {
  amount = Math.round(+amount); if (!(amount > 0)) throw new Error('مبلغ پرداخت را وارد کنید')
  const rem = ci.amount - ciPaidSum(ci.id)
  if (amount > rem) throw new Error(`ماندهٔ این فاکتور ${pMoney(rem)} ${pUnitFa()} است؛ مبلغ بیشتر مجاز نیست`)
  fundId = fundId && db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId) ? fundId : ciFundOf(ci)
  const cpId = Number(db.prepare(`INSERT INTO contractor_payments(cinvoice_id,fund_id,amount,g_date,j_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(ci.id, fundId, amount, d.g_date, d.j_date, note || '', by || null, nowISO()).lastInsertRowid)
  const isSale = ci.kind === 'sale'
  addFundTxn(fundId, isSale ? 'in' : 'out', amount, { g_date: d.g_date, j_date: d.j_date, cinvId: ci.id, cpId, by,
    note: (isSale ? 'دریافت از فروش پروژه: ' : 'پرداخت به پیمانکار: ') + (ci.title || '') + (ci.vendor_name ? ' (' + ci.vendor_name + ')' : '') })
  refreshCiPaid(ci.id)
  return cpId
}
function deleteCiPayment(cpId) {
  const cp = db.prepare(`SELECT * FROM contractor_payments WHERE id=?`).get(cpId); if (!cp) return
  db.prepare(`DELETE FROM fund_txns WHERE ref_cpay_id=?`).run(cpId)
  db.prepare(`DELETE FROM contractor_payments WHERE id=?`).run(cpId)
  refreshCiPaid(cp.cinvoice_id)
}
// تنظیمِ مجموعِ پرداخت به مقدارِ هدف (سازگاری با فرمِ قدیمی): کم → پرداختِ جدید با تاریخِ داده‌شده، زیاد → حذف از آخرین پرداخت‌ها
function setCiPaidTarget(ci, target, d, by) {
  target = Math.max(0, Math.min(ci.amount, Math.round(+target || 0)))
  let cur = ciPaidSum(ci.id)
  if (target > cur) addCiPayment(ci, target - cur, d, null, '', by)
  else if (target < cur) {
    for (const cp of db.prepare(`SELECT * FROM contractor_payments WHERE cinvoice_id=? ORDER BY g_date DESC, id DESC`).all(ci.id)) {
      if (cur <= target) break
      const over = cur - target
      deleteCiPayment(cp.id)
      if (cp.amount > over) addCiPayment(ci, cp.amount - over, { g_date: cp.g_date, j_date: cp.j_date }, cp.fund_id, cp.note, cp.created_by)
      cur = ciPaidSum(ci.id)
    }
  }
}
// سازگاری: فراخوانی‌های قدیمی فقط وضعیت را هم‌سان می‌کنند (دیگر تراکنش‌ها را بازنویسی نمی‌کند)
function syncContractorFundTxn(ci) { if (ci) refreshCiPaid(ci.id) }
// عطف‌به‌ماسبق: برای فاکتورهای پیمانکارِ پرداخت‌شده‌ای که هنوز تراکنش صندوق ندارند، تراکنش ساخته می‌شود (یک‌بار)
function backfillContractorFundTxns() {
  if (getSetting('cinvoiceFundBackfill') === '1') return
  const rows = db.prepare(`SELECT * FROM contractor_invoices WHERE paid=1 AND amount>0
    AND id NOT IN (SELECT ref_cinvoice_id FROM fund_txns WHERE ref_cinvoice_id IS NOT NULL)`).all()
  for (const ci of rows) syncContractorFundTxn(ci, null)
  setSetting('cinvoiceFundBackfill', '1')
  if (rows.length) console.log(`✓ اثر صندوقِ ${rows.length} فاکتور پیمانکارِ قبلی اعمال شد`)
}
// عطف‌به‌ماسبق: پرداخت‌هایی که در گذشته بابت شارژِ یک پروژه داده شده‌اند علامت‌دار می‌شوند (project_id)
// تا در دفترِ مجزای پروژه، «پرداختی ناخالص» و «طلب/بدهی نسبت به سهم نهایی» درست محاسبه شود.
function backfillProjectPayments() {
  if (getSetting('projectPaymentBackfill') === '1') return
  const charges = db.prepare(`SELECT id, project_id FROM invoices WHERE project_id>0 AND is_billing=1`).all()
  let n = 0
  for (const inv of charges) {
    const pays = db.prepare(`SELECT DISTINCT p.id FROM payments p
      JOIN payment_allocations a ON a.payment_id=p.id
      JOIN invoice_shares s ON s.id=a.share_id
      WHERE s.invoice_id=? AND COALESCE(p.project_id,0)=0`).all(inv.id)
    for (const p of pays) {
      // فقط اگر این پرداخت به هیچ سهمِ فاکتورِ دیگری تخصیص نخورده باشد (تا ناخالص دوباره‌شماری نشود)
      const other = db.prepare(`SELECT COUNT(*) c FROM payment_allocations a
        JOIN invoice_shares s ON s.id=a.share_id WHERE a.payment_id=? AND s.invoice_id<>?`).get(p.id, inv.id).c
      if (other === 0) { db.prepare(`UPDATE payments SET project_id=? WHERE id=?`).run(inv.project_id, p.id); n++ }
    }
  }
  setSetting('projectPaymentBackfill', '1')
  if (n) console.log(`✓ ${n} پرداختِ پروژه‌ای علامت‌گذاری شد`)
}

// ---------- طلب مدیر ----------
function managerDebt() {
  const opening = +getSetting('managerOpening', '0') || 0
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE paid_by_manager=1 AND is_opening=0`).get().s
  const settled = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fund_txns WHERE type='manager_settle'`).get().s
  return opening + paid - settled
}

// ---------- پرداخت هزینه/فاکتور از صندوق (مدل تفکیک تعهد از پرداخت) ----------
const invoiceFundPaid = invId => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expense_payments WHERE invoice_id=?`).get(invId).s
// فاکتوری که «هزینه‌ی قابل پرداخت از صندوق» است: نه شارژ، نه صورت‌حساب/جریمه، نه انتقالی، نه از جیب مدیر
const isPayableExpense = inv => !!inv && !inv.is_charge && !inv.is_billing && !inv.is_opening && !inv.paid_by_manager
function payExpense(invoiceId, fundId, amount, dates, note, by) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId)
  if (!inv) throw new Error('فاکتور یافت نشد')
  if (inv.is_charge) throw new Error('شارژ ماهانه هزینه‌ی ساختمان نیست و از صندوق پرداخت نمی‌شود')
  if (inv.paid_by_manager) throw new Error('این فاکتور را مدیر از جیب خودش پرداخت کرده است')
  if (inv.is_opening) throw new Error('این ردیف مانده‌ی اولیه است')
  if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) throw new Error('صندوق نامعتبر است')
  amount = Math.round(+amount)
  if (!(amount > 0)) throw new Error('مبلغ پرداخت را وارد کنید')
  const unpaid = inv.amount - invoiceFundPaid(invoiceId)
  if (amount > unpaid) throw new Error(`مانده‌ی پرداخت‌نشده‌ی این هزینه ${unpaid} ریال است؛ مبلغ بیشتر مجاز نیست`)
  const payId = Number(db.prepare(`INSERT INTO expense_payments(invoice_id,fund_id,amount,g_date,j_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(invoiceId, fundId, amount, dates.g_date, dates.j_date, note || '', by || null, nowISO()).lastInsertRowid)
  addFundTxn(fundId, 'out', amount, { ...dates, invId: invoiceId, epId: payId, note: `پرداخت هزینه: ${inv.title}`, by })
  refreshInvoiceStatus(invoiceId)
  return { payId, unpaid: unpaid - amount, crossFund: fundId !== inv.fund_id }
}
function deleteExpensePayment(id) {
  const ep = db.prepare(`SELECT * FROM expense_payments WHERE id=?`).get(id); if (!ep) return
  // اول با پیوندِ دقیق؛ فقط برای داده‌های خیلی قدیمیِ بی‌پیوند، تطبیق با مبلغ/تاریخ
  const tx = db.prepare(`SELECT id FROM fund_txns WHERE ref_exppay_id=?`).get(id)
    || db.prepare(`SELECT id FROM fund_txns WHERE type='out' AND ref_exppay_id IS NULL AND fund_id=? AND ref_invoice_id=? AND amount=? AND g_date=? ORDER BY id DESC LIMIT 1`)
      .get(ep.fund_id, ep.invoice_id, ep.amount, ep.g_date)
  if (tx) db.prepare(`DELETE FROM fund_txns WHERE id=?`).run(tx.id)
  db.prepare(`DELETE FROM expense_payments WHERE id=?`).run(id)
  refreshInvoiceStatus(ep.invoice_id)
}
function invoiceFundPayments(invId) {
  return db.prepare(`SELECT ep.*, f.name fund_name FROM expense_payments ep LEFT JOIN funds f ON f.id=ep.fund_id
    WHERE ep.invoice_id=? ORDER BY ep.g_date, ep.id`).all(invId)
}
// تنظیمِ «پرداخت‌شده از صندوق» یک فاکتور به مقدارِ هدف (برای فرم ثبت/ویرایش): کم باشد اضافه، زیاد باشد حذف می‌شود
function setFundPaid(invoiceId, fundId, target, dates, by) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId); if (!inv || !isPayableExpense(inv)) return
  target = Math.min(Math.max(0, Math.round(+target || 0)), inv.amount)
  const current = invoiceFundPaid(invoiceId)
  if (target > current) { try { payExpense(invoiceId, fundId, target - current, dates, 'پرداخت هنگام ثبت/ویرایش', by) } catch (e) { } }
  else if (target < current) {
    let excess = current - target
    for (const ep of db.prepare(`SELECT * FROM expense_payments WHERE invoice_id=? ORDER BY id DESC`).all(invoiceId)) {
      if (excess <= 0) break
      if (ep.amount <= excess) { deleteExpensePayment(ep.id); excess -= ep.amount }
      else { const keep = ep.amount - excess; deleteExpensePayment(ep.id); try { payExpense(invoiceId, ep.fund_id, keep, { g_date: ep.g_date, j_date: ep.j_date }, ep.note, ep.created_by) } catch (e) { } excess = 0 }
    }
  }
}
// بدهی خالصِ جهت‌دار بین صندوق‌ها (پرداخت متقابل منهای انتقال‌ها)
function interFundDebts() {
  const funds = db.prepare(`SELECT id,name FROM funds ORDER BY id`).all()
  const idx = {}; funds.forEach(f => idx[f.id] = f)
  const owe = {}, key = (i, j) => i + '>' + j
  const add = (i, j, a) => { owe[key(i, j)] = (owe[key(i, j)] || 0) + a }
  for (const r of db.prepare(`SELECT ep.fund_id payer, i.fund_id owner, SUM(ep.amount) amt
      FROM expense_payments ep JOIN invoices i ON i.id=ep.invoice_id WHERE ep.fund_id<>i.fund_id GROUP BY ep.fund_id,i.fund_id`).all())
    if (idx[r.owner] && idx[r.payer]) add(r.owner, r.payer, r.amt)   // owner به payer بدهکار
  for (const t of db.prepare(`SELECT fund_id, peer_fund_id, amount FROM fund_txns WHERE type='transfer_out' AND peer_fund_id IS NOT NULL`).all())
    if (idx[t.fund_id] && idx[t.peer_fund_id]) add(t.fund_id, t.peer_fund_id, -t.amount)   // انتقال بدهی را تسویه می‌کند
  const out = []
  for (const f1 of funds) for (const f2 of funds) {
    if (f1.id >= f2.id) continue
    const net = (owe[key(f1.id, f2.id)] || 0) - (owe[key(f2.id, f1.id)] || 0)
    if (net > 0) out.push({ from: f1.id, fromName: f1.name, to: f2.id, toName: f2.name, amount: net })
    else if (net < 0) out.push({ from: f2.id, fromName: f2.name, to: f1.id, toName: f1.name, amount: -net })
  }
  return out
}
// جمع هزینه‌های پرداخت‌نشده از صندوق (تعهدهای باز ساختمان)
function unpaidExpensesTotal() {
  const rows = db.prepare(`SELECT id, amount FROM invoices WHERE is_charge=0 AND is_billing=0 AND is_opening=0 AND paid_by_manager=0`).all()
  return rows.reduce((s, i) => s + Math.max(0, i.amount - invoiceFundPaid(i.id)), 0)
}
function fundPaymentsReport(from, to) {
  from = from || '1900-01-01'; to = to || '2100-01-01'
  const rows = db.prepare(`SELECT ep.*, f.name fund_name, i.title inv_title, c.name category
    FROM expense_payments ep LEFT JOIN funds f ON f.id=ep.fund_id
    JOIN invoices i ON i.id=ep.invoice_id LEFT JOIN expense_categories c ON c.id=i.category_id
    WHERE ep.g_date>=? AND ep.g_date<=? ORDER BY ep.g_date DESC, ep.id DESC`).all(from, to)
  const byFund = {}, byCat = {}
  for (const r of rows) {
    (byFund[r.fund_name || '—'] ||= { name: r.fund_name || '—', amount: 0, count: 0 })
    byFund[r.fund_name || '—'].amount += r.amount; byFund[r.fund_name || '—'].count++
    ;(byCat[r.category || '—'] ||= { name: r.category || '—', amount: 0, count: 0 })
    byCat[r.category || '—'].amount += r.amount; byCat[r.category || '—'].count++
  }
  return {
    rows, total: rows.reduce((s, r) => s + r.amount, 0),
    byFund: Object.values(byFund), byCategory: Object.values(byCat).sort((a, b) => b.amount - a.amount),
    interFund: interFundDebts(), unpaidTotal: unpaidExpensesTotal()
  }
}

// ---------- مانده‌ی اولیه ----------
// بدهی اولیه = یک فاکتور مخفی با تاریخ ۱۹۰۰ (در FIFO اول از همه)، بستانکاری اولیه = یک دریافتی تخصیص‌نیافته.
function openingCategoryId() {
  let c = db.prepare(`SELECT id FROM expense_categories WHERE name='مانده انتقالی از قبل'`).get()
  if (!c) {
    const fund = db.prepare(`SELECT id FROM funds ORDER BY id`).get()
    const id = Number(db.prepare(`INSERT INTO expense_categories(name,default_method,include_vacant,default_fund_id,active,sort) VALUES(?,?,?,?,0,99)`)
      .run('مانده انتقالی از قبل', 'custom', 1, fund ? fund.id : null).lastInsertRowid)
    return id
  }
  return c.id
}
function setOpeningBalance(unitId, amount, note, by) {
  amount = Math.round(+amount || 0)
  // پاک کردن ردیف‌های قبلی
  const oldInv = db.prepare(`SELECT i.id FROM invoices i JOIN invoice_shares s ON s.invoice_id=i.id
    WHERE i.is_opening=1 AND s.unit_id=?`).get(unitId)
  if (oldInv) { deleteInvoice(oldInv.id) }
  for (const p of db.prepare(`SELECT id FROM payments WHERE unit_id=? AND is_opening=1`).all(unitId)) deletePayment(p.id)
  db.prepare(`DELETE FROM opening_balances WHERE unit_id=?`).run(unitId)
  if (amount === 0) return
  db.prepare(`INSERT INTO opening_balances(unit_id,amount,note,created_at) VALUES(?,?,?,?)`).run(unitId, amount, note || '', nowISO())
  const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId)
  const fund = db.prepare(`SELECT id FROM funds ORDER BY id`).get()
  if (amount > 0) {
    const invId = Number(db.prepare(`INSERT INTO invoices
      (title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,note,status,is_opening,created_by,created_at)
      VALUES(?,?,?,?,?,'custom',1,?,0,'variable',?,'open',1,?,?)`)
      .run(`بدهی انتقالی از قبل — واحد ${faNum(u.number)}`, openingCategoryId(), amount, OPENING_G, OPENING_J, fund.id, note || '', by || null, nowISO()).lastInsertRowid)
    db.prepare(`INSERT INTO invoice_shares(invoice_id,unit_id,share_amount) VALUES(?,?,?)`).run(invId, unitId, amount)
    applyCreditsOfUnit(unitId)
    refreshInvoiceStatus(invId)
  } else {
    // بستانکاری اولیه: دریافتی بدون تأثیر روی صندوق (موجودی اولیه‌ی صندوق جدا وارد می‌شود)
    const payId = Number(db.prepare(`INSERT INTO payments(unit_id,amount,g_date,j_date,fund_id,method,note,is_opening,created_by,created_at)
      VALUES(?,?,?,?,?,'','بستانکاری انتقالی از قبل',1,?,?)`).run(unitId, -amount, OPENING_G, OPENING_J, fund.id, by || null, nowISO()).lastInsertRowid)
    allocatePayment(payId)
  }
}

// ---------- حذف‌ها ----------
function deletePayment(id) {
  const p = db.prepare(`SELECT * FROM payments WHERE id=?`).get(id); if (!p) return
  const invIds = db.prepare(`SELECT DISTINCT s.invoice_id i FROM payment_allocations a JOIN invoice_shares s ON s.id=a.share_id WHERE a.payment_id=?`).all(id).map(r => r.i)
  db.prepare(`DELETE FROM payment_allocations WHERE payment_id=?`).run(id)
  db.prepare(`DELETE FROM fund_txns WHERE ref_payment_id=?`).run(id)
  db.prepare(`DELETE FROM payments WHERE id=?`).run(id)
  applyCreditsOfUnit(p.unit_id)
  for (const i of invIds) refreshInvoiceStatus(i)
}
function deleteInvoice(id) {
  const shares = db.prepare(`SELECT * FROM invoice_shares WHERE invoice_id=?`).all(id)
  const units = [...new Set(shares.map(s => s.unit_id))]
  for (const s of shares) trimShareAllocations(s.id, 0)
  db.prepare(`DELETE FROM invoice_shares WHERE invoice_id=?`).run(id)
  db.prepare(`DELETE FROM expense_payments WHERE invoice_id=?`).run(id)   // پرداخت‌های صندوق به این فاکتور
  db.prepare(`DELETE FROM fund_txns WHERE ref_invoice_id=?`).run(id)      // و خروجی‌های صندوقِ متناظرشان
  db.prepare(`DELETE FROM invoices WHERE id=?`).run(id)
  for (const u of units) applyCreditsOfUnit(u)
}

// ---------- نمای فاکتور ----------
function invoiceRow(inv) {
  const collected = invoiceCollected(inv.id)
  const cat = db.prepare(`SELECT name FROM expense_categories WHERE id=?`).get(inv.category_id)
  const fund = db.prepare(`SELECT name FROM funds WHERE id=?`).get(inv.fund_id)
  const payable = isPayableExpense(inv)
  const fundPaid = payable ? invoiceFundPaid(inv.id) : 0
  return {
    ...inv, collected, remaining: inv.amount - collected,
    categoryName: cat ? cat.name : '—', fundName: fund ? fund.name : '—',
    methodFa: METHOD_FA[inv.method] || inv.method, kindFa: EXPENSE_KIND_FA[inv.expense_kind] || '',
    shareCount: db.prepare(`SELECT COUNT(*) c FROM invoice_shares WHERE invoice_id=?`).get(inv.id).c,
    payable, fundPaid, fundUnpaid: payable ? inv.amount - fundPaid : 0
  }
}
function listInvoices(q = {}) {
  const w = ['i.is_opening=0'], a = []
  if (q.category_id) { w.push('i.category_id=?'); a.push(+q.category_id) }
  if (q.fund_id) { w.push('i.fund_id=?'); a.push(+q.fund_id) }
  if (q.status) { w.push('i.status=?'); a.push(q.status) }
  if (q.expense_kind) { w.push('i.expense_kind=?'); a.push(q.expense_kind) }
  if (q.from) { w.push('i.g_date>=?'); a.push(q.from) }
  if (q.to) { w.push('i.g_date<=?'); a.push(q.to) }
  if (q.q) { const s = `%${q.q}%`; w.push('(i.title LIKE ? OR i.vendor LIKE ? OR i.note LIKE ?)'); a.push(s, s, s) }
  const rows = db.prepare(`SELECT i.* FROM invoices i WHERE ${w.join(' AND ')} ORDER BY i.g_date DESC, i.id DESC ${q.limit ? 'LIMIT ' + Number(q.limit) : ''}`).all(...a)
  return rows.map(invoiceRow)
}

// ---------- نمای واحد ----------
function unitDebt(unitId) {
  const shares = db.prepare(`SELECT COALESCE(SUM(share_amount),0) s FROM invoice_shares WHERE unit_id=?`).get(unitId).s
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE unit_id=?`).get(unitId).s
  return shares - paid
}
function unitOldestOpenG(unitId) {
  const r = db.prepare(`SELECT i.g_date g FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id
    WHERE s.unit_id=? AND s.share_amount > (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE share_id=s.id)
    ORDER BY i.g_date, i.id LIMIT 1`).get(unitId)
  return r ? r.g : null
}
function agingBucket(unitId) {
  const g = unitOldestOpenG(unitId); if (!g) return null
  const days = g === OPENING_G ? 9999 : daysBetween(g, todayG())
  return { days, bucket: days <= 30 ? '۰-۳۰' : days <= 60 ? '۳۱-۶۰' : days <= 90 ? '۶۱-۹۰' : '+۹۰' }
}
// ماتریسِ سنیِ بدهیِ یک واحد: ماندهٔ هر سهمِ باز در ستونِ سنِ خودش (نه کلِ بدهی در ستونِ قدیمی‌ترین قلم)
const AGE_KEYS = ['۰-۳۰', '۳۱-۶۰', '۶۱-۹۰', '+۹۰']
function unitAges(unitId, debt) {
  const ages = { '۰-۳۰': 0, '۳۱-۶۰': 0, '۶۱-۹۰': 0, '+۹۰': 0 }
  if (!(debt > 0)) return ages
  const open = db.prepare(`SELECT i.g_date g, s.share_amount - (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE share_id=s.id) rem
    FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id WHERE s.unit_id=? ORDER BY i.g_date, i.id`).all(unitId).filter(r => r.rem > 0)
  // پرداختِ تخصیص‌نیافته (اگر باشد) اول از قدیمی‌ترین‌ها کم می‌شود تا جمعِ ستون‌ها = بدهیِ واقعی
  let extra = open.reduce((a, r) => a + r.rem, 0) - debt
  const today = todayG()
  for (const r of open) {
    let rem = r.rem; if (extra > 0) { const k = Math.min(extra, rem); rem -= k; extra -= k }
    if (rem <= 0) continue
    const days = r.g === OPENING_G ? 9999 : daysBetween(r.g, today)
    ages[days <= 30 ? '۰-۳۰' : days <= 60 ? '۳۱-۶۰' : days <= 90 ? '۶۱-۹۰' : '+۹۰'] += rem
  }
  return ages
}
function unitsWithBalance() {
  return listUnits().map(u => {
    const debt = unitDebt(u.id)
    return { ...u, debt, credit: debt < 0 ? -debt : 0, aging: debt > 0 ? agingBucket(u.id) : null, label: unitLabel(u) }
  })
}
function unitCard(unitId) {
  const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId); if (!u) return null
  const shares = db.prepare(`SELECT s.*, i.title, i.j_date, i.g_date, i.is_opening, i.is_charge, c.name category
    FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id
    LEFT JOIN expense_categories c ON c.id=i.category_id
    WHERE s.unit_id=? ORDER BY i.g_date DESC, i.id DESC`).all(unitId)
    .map(s => { const al = shareAllocated(s.id); return { ...s, paid: al, remaining: s.share_amount - al } })
  const payments = db.prepare(`SELECT p.*, f.name fund_name FROM payments p LEFT JOIN funds f ON f.id=p.fund_id
    WHERE p.unit_id=? ORDER BY p.g_date DESC, p.id DESC`).all(unitId)
    .map(p => ({ ...p, allocated: paymentAllocated(p.id), leftover: p.amount - paymentAllocated(p.id) }))
  const creditUses = db.prepare(`SELECT cu.*, i.title FROM credit_uses cu LEFT JOIN invoices i ON i.id=cu.invoice_id
    WHERE cu.unit_id=? ORDER BY cu.g_date DESC, cu.id DESC`).all(unitId)
  const debt = unitDebt(unitId)
  return {
    unit: { ...u, label: unitLabel(u), chargeAmount: unitChargeAt(u, curPeriod()) },
    shares, payments, creditUses, debt, credit: debt < 0 ? -debt : 0,
    totalShares: shares.reduce((s, r) => s + r.share_amount, 0),
    totalPaid: payments.reduce((s, r) => s + r.amount, 0),
    aging: debt > 0 ? agingBucket(unitId) : null,
    buildingName: getSetting('buildingName'), today: (() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })()
  }
}

// ---------- شارژ ماهانه‌ی خودکار ----------
function chargeCategory() {
  return db.prepare(`SELECT * FROM expense_categories WHERE is_charge_cat=1 ORDER BY id`).get()
    || db.prepare(`SELECT * FROM expense_categories WHERE name='شارژ ماهانه' ORDER BY id`).get()
}
function issueCharge(period, by = null) {
  if (!/^\d{4}\/\d{2}$/.test(period || '')) throw new Error('ماه نامعتبر است')
  const exists = db.prepare(`SELECT id FROM invoices WHERE is_charge=1 AND charge_period=?`).get(period)
  if (exists) return { created: false, id: exists.id }
  const cat = chargeCategory()
  if (!cat) throw new Error('دسته‌ی «شارژ ماهانه» پیدا نشد')
  const units = eligibleUnits(!!cat.include_vacant)
  if (!units.length) return { created: false, reason: 'واحد مشمولی وجود ندارد' }
  const shares = computeShares(units, 'per_unit_charge', 0, { period })
  const amount = sumShares(shares)
  if (amount <= 0) return { created: false, reason: 'مبلغ شارژ صفر است' }
  const { jy, jm } = splitPeriod(period)
  const gd = periodFirstG(period), jd = jStr(jy, jm, 1)
  const fundId = cat.default_fund_id || db.prepare(`SELECT id FROM funds ORDER BY id`).get().id
  const invId = Number(db.prepare(`INSERT INTO invoices
    (title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,status,is_charge,charge_period,created_by,created_at)
    VALUES(?,?,?,?,?,'per_unit_charge',?,?,0,'fixed','open',1,?,?,?)`)
    .run(`شارژ ماهانه ${periodFa(period)}`, cat.id, amount, gd, jd, cat.include_vacant, fundId, period, by, nowISO()).lastInsertRowid)
  writeShares(invId, shares)
  return { created: true, id: invId, amount, units: shares.length }
}
// ماه‌های جامانده‌ی قابل صدور (از قدیمی‌ترین ردیف تاریخچه‌ی شارژ تا ماه جاری)
function missingChargePeriods() {
  const first = db.prepare(`SELECT effective_j FROM charge_history ORDER BY effective_j, id`).get()
  let p = first ? first.effective_j : curPeriod()
  const cur = curPeriod(), out = []
  let guard = 0
  while (p <= cur && guard++ < 240) {
    if (!db.prepare(`SELECT 1 FROM invoices WHERE is_charge=1 AND charge_period=?`).get(p)) out.push({ period: p, fa: periodFa(p) })
    p = shiftPeriod(p, 1)
  }
  return out
}
function autoIssueCurrentCharge() {
  try {
    if (db.prepare(`SELECT COUNT(*) c FROM units WHERE active=1`).get().c === 0) return
    const r = issueCharge(curPeriod())
    if (r.created) console.log(`✓ شارژ ماه ${curPeriod()} صادر شد (${r.units} واحد)`)
  } catch (e) { console.error('صدور خودکار شارژ ناموفق:', e.message) }
}

// ---------- هزینه‌های دوره‌ای (ماهانه/هفتگی/فصلی) ----------
const dayOfYearJ = j => (j.jm <= 6 ? (j.jm - 1) * 31 : 186 + (j.jm - 7) * 30) + j.jd
const weekOfYearJ = j => Math.floor((dayOfYearJ(j) - 1) / 7) + 1
const seasonOfJ = j => Math.ceil(j.jm / 3)
function recurPeriodKey(kind, j = todayJ()) {
  if (kind === 'weekly') return `${j.jy}/W${pad2(weekOfYearJ(j))}`
  if (kind === 'seasonal') return `${j.jy}/S${seasonOfJ(j)}`
  return `${j.jy}/${pad2(j.jm)}`
}
function recurPeriodFa(kind, key) {
  const jy = faNum(key.slice(0, 4))
  if (kind === 'weekly') return `هفتهٔ ${faNum(+key.slice(6))} سال ${jy}`
  if (kind === 'seasonal') return `${SEASON_FA[(+key.slice(6)) - 1]} ${jy}`
  return periodFa(key)
}
const listRecurring = () => db.prepare(`SELECT * FROM recurring_expenses ORDER BY active DESC, id`).all()
  .map(r => {
    const cat = db.prepare(`SELECT name FROM expense_categories WHERE id=?`).get(r.category_id)
    const fund = db.prepare(`SELECT name FROM funds WHERE id=?`).get(r.fund_id)
    const key = recurPeriodKey(r.period_kind)
    const issued = !!db.prepare(`SELECT 1 FROM invoices WHERE recur_id=? AND recur_period=?`).get(r.id, key)
    const count = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE recur_id=?`).get(r.id).c
    return {
      ...r, categoryName: cat ? cat.name : '—', fundName: fund ? fund.name : '—',
      periodKindFa: PERIOD_KIND_FA[r.period_kind] || r.period_kind, methodFa: METHOD_FA[r.method] || r.method,
      curPeriodKey: key, curPeriodFa: recurPeriodFa(r.period_kind, key), issuedThisPeriod: issued, issuedCount: count
    }
  })
function issueRecurring(rec, key, by = null) {
  if (!rec) return { created: false, reason: 'قالب یافت نشد' }
  if (!rec.active) return { created: false, reason: 'قالب غیرفعال است' }
  const exists = db.prepare(`SELECT id FROM invoices WHERE recur_id=? AND recur_period=?`).get(rec.id, key)
  if (exists) return { created: false, id: exists.id }
  const units = eligibleUnits(!!rec.include_vacant)
  if (!units.length) return { created: false, reason: 'واحد مشمولی وجود ندارد' }
  const method = METHODS.includes(rec.method) && rec.method !== 'custom' ? rec.method : 'equal'
  let shares, amount
  if (method === 'per_unit_charge') { shares = computeShares(units, method, 0, { period: curPeriod() }); amount = sumShares(shares) }
  else { amount = rec.amount; shares = computeShares(units, method, amount, {}) }
  if (!(amount > 0)) return { created: false, reason: 'مبلغ صفر است' }
  const t = todayJ(), gd = todayG(), jd = jStr(t.jy, t.jm, t.jd)
  const fundId = rec.fund_id || db.prepare(`SELECT id FROM funds ORDER BY id`).get().id
  const invId = Number(db.prepare(`INSERT INTO invoices
    (title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,status,recur_id,recur_period,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,0,?,'open',?,?,?,?)`)
    .run(`${rec.title} — ${recurPeriodFa(rec.period_kind, key)}`, rec.category_id, amount, gd, jd, method, rec.include_vacant, fundId,
      EXPENSE_KINDS.includes(rec.expense_kind) ? rec.expense_kind : 'fixed', rec.id, key, by, nowISO()).lastInsertRowid)
  // مدل تفکیک: هزینهٔ دوره‌ای هم تعهد است؛ پرداختش از صندوق جداگانه انجام می‌شود.
  writeShares(invId, shares)
  return { created: true, id: invId, amount, units: shares.length }
}
function autoIssueRecurring() {
  try {
    if (db.prepare(`SELECT COUNT(*) c FROM units WHERE active=1`).get().c === 0) return
    for (const r of db.prepare(`SELECT * FROM recurring_expenses WHERE active=1 AND auto=1`).all()) {
      const res = issueRecurring(r, recurPeriodKey(r.period_kind))
      if (res.created) console.log(`✓ هزینهٔ دوره‌ای «${r.title}» صادر شد`)
    }
  } catch (e) { console.error('صدور خودکار هزینهٔ دوره‌ای ناموفق:', e.message) }
}

// گزارشِ تفکیکیِ بدهیِ هر واحد در سه سبد: شارژ(جاری) | صندوق عمرانی(فیش‌ها/تقسیمی) | پروژه‌ها(بدهی/طلب)
function unitLedgerReport() {
  const faToEn = s => parseInt(String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0
  // نگاشتِ سهمِ مصوبه (تعهد) و سهمِ هزینهٔ واقعی (مانده) برای هر واحد در هر پروژه
  const projBudget = {}, projFinal = {}
  for (const inv of db.prepare(`SELECT * FROM invoices WHERE project_id>0 AND is_billing=1`).all()) {
    const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(inv.project_id)
    const u = invoiceUnits(inv.id)
    const basis = (p && p.final_amount) || projectNetCost(inv.project_id).net || inv.amount
    projBudget[inv.project_id] = (p && p.budget) ? Object.fromEntries(computeShares(u, inv.method, p.budget, {}).map(s => [s.unit_id, s.share_amount])) : {}
    projFinal[inv.project_id] = Object.fromEntries(computeShares(u, inv.method, basis, {}).map(s => [s.unit_id, s.share_amount]))
  }
  const units = listUnits().filter(u => u.active || unitDebt(u.id) !== 0)
  const rows = units.map(u => {
    const shares = db.prepare(`SELECT s.id, s.share_amount, i.is_charge, i.is_billing, i.is_opening, i.from_fund, i.project_id
      FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id WHERE s.unit_id=?`).all(u.id)
    let charge = 0, omrani = 0, projectDue = 0, projectBal = 0
    for (const s of shares) {
      if (s.is_billing && s.project_id) {
        const paid = unitProjectPaid(u.id, s.project_id)
        projectDue += ((projBudget[s.project_id] || {})[u.id] || s.share_amount) - paid // تعهدِ مصوبه − پرداختی
        projectBal += ((projFinal[s.project_id] || {})[u.id] || 0) - paid                // مانده نسبت به هزینهٔ واقعی (طلب/بدهی)
      }
      else if (s.is_charge || s.is_opening || s.is_billing) charge += Math.max(0, s.share_amount - shareAllocated(s.id))
      else if (!s.from_fund) omrani += Math.max(0, s.share_amount - shareAllocated(s.id))
    }
    // جمع خالص = بدهیِ قابلِ وصول (شارژ + قبوض + تعهدِ باقی‌ماندهٔ پروژه)؛ طلبِ مازادِ پروژه حساب نمی‌شود (بدون تصمیم هیئت‌مدیره برنمی‌گردد)
    const net = charge + omrani + Math.max(0, projectDue)
    return { id: u.id, number: u.number, resident_name: u.resident_name, charge, omrani, projectDue, projectBal, project: projectBal, net }
  }).sort((a, b) => faToEn(a.number) - faToEn(b.number))
  const total = rows.reduce((a, r) => ({ charge: a.charge + r.charge, omrani: a.omrani + r.omrani, projectDue: a.projectDue + r.projectDue, projectBal: a.projectBal + r.projectBal, project: a.project + r.projectBal, net: a.net + r.net }), { charge: 0, omrani: 0, projectDue: 0, projectBal: 0, project: 0, net: 0 })
  return { rows, total }
}

// صورت‌حسابِ تفکیکیِ یک واحد: سه بخشِ شارژ(جاری) | قبوض و متفرقه | پروژه‌ها، با ریزِ هر ردیف
function unitStatement(unitId) {
  const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId); if (!u) return null
  const shares = db.prepare(`SELECT s.id, s.share_amount, i.title, i.j_date, i.is_charge, i.is_billing, i.is_opening, i.from_fund, i.project_id
    FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id WHERE s.unit_id=? ORDER BY i.g_date, i.id`).all(unitId)
  const charge = [], omrani = [], projects = []
  for (const s of shares) {
    if (s.is_billing && s.project_id) {
      const paid = unitProjectPaid(unitId, s.project_id)
      const p = db.prepare(`SELECT title FROM projects WHERE id=?`).get(s.project_id)
      projects.push({ title: p ? p.title : s.title, j_date: s.j_date, share: s.share_amount, paid, balance: s.share_amount - paid })
    } else {
      const paid = shareAllocated(s.id)
      const row = { title: s.title, j_date: s.j_date, share: s.share_amount, paid, remaining: Math.max(0, s.share_amount - paid) }
      if (s.is_charge || s.is_opening || s.is_billing) charge.push(row)
      else if (!s.from_fund) omrani.push(row)
    }
  }
  return {
    unit: { id: u.id, number: u.number, resident_name: u.resident_name },
    charge: { rows: charge, total: charge.reduce((x, r) => x + r.remaining, 0) },
    omrani: { rows: omrani, total: omrani.reduce((x, r) => x + r.remaining, 0) },
    projects: { rows: projects, total: projects.reduce((x, r) => x + r.balance, 0) },
    buildingName: getSetting('buildingName'), today: (() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })()
  }
}
// گزارشِ یک صندوق: ریزِ ورودی/خروجی + موجودی/کسری + بدهیِ هر واحد به آن صندوق
function fundReport(fundId) {
  const f = db.prepare(`SELECT * FROM funds WHERE id=?`).get(fundId); if (!f) return null
  const txns = db.prepare(`SELECT t.*, i.title inv_title, u.number unit_number, pf.name peer_name FROM fund_txns t
    LEFT JOIN invoices i ON i.id=t.ref_invoice_id LEFT JOIN payments p ON p.id=t.ref_payment_id LEFT JOIN units u ON u.id=p.unit_id
    LEFT JOIN funds pf ON pf.id=t.peer_fund_id WHERE t.fund_id=? ORDER BY t.g_date DESC, t.id DESC`).all(fundId)
  const fl = fundFlowBreakdown(fundId)
  // دستهٔ بدهیِ این صندوق بر اساس نامش: شارژ | قبوض/متفرقه | عمرانی(پروژه‌ها)
  const cat = bucketOfFund(f)
  const faToEn = s => parseInt(String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0
  const unitDebts = unitLedgerReport().rows
    .map(r => ({ id: r.id, number: r.number, resident_name: r.resident_name, debt: cat === 'project' ? r.projectDue : r[cat] }))
    .filter(r => r.debt > 0)
    .sort((a, b) => faToEn(a.number) - faToEn(b.number))
  return {
    fund: { id: f.id, name: f.name, kindFa: FUND_KIND_FA[f.kind] || f.kind, balance: fundBalance(f.id), ...fl, opening: f.opening_balance || 0 },
    txns, unitDebts, category: cat, basis: cat === 'project' ? 'تعهدِ مصوبهٔ باقی‌مانده (همان مبنای گزارش تفکیکی و داشبورد)' : 'سهم‌های پرداخت‌نشده',
    totalUnitDebt: unitDebts.reduce((s, r) => s + r.debt, 0)
  }
}

// ======== دفتر روزنامه / دفتر کل (معین) / برگهٔ سند دوطرفه ========
const jnorm = s => String(s || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/-/g, '/').trim()
// نوعِ ماهیتِ فاکتور
function invKind(i) { return i.from_fund ? 'exp' : i.is_charge ? 'charge' : (i.is_billing && i.project_id) ? 'proj' : 'bill' }
const JKIND_FA = { charge: 'شارژ ماهانه', bill: 'قبوض و متفرقه', proj: 'پروژه (عمرانی)', exp: 'هزینهٔ جاری', pay: 'دریافتی', ci: 'فاکتور پیمانکار', ftxn: 'انتقال/تسویه/تعدیل صندوق' }

// خلاصهٔ یک سمتِ سند (چند حساب → یک برچسب)
function sideLabel(lines) {
  if (!lines.length) return '—'
  if (lines.length === 1) return lines[0].acc
  if (lines.every(l => /^واحد/.test(l.acc))) return 'واحدها (' + faNum(lines.length) + ')'
  return lines[0].acc + ' و ' + faNum(lines.length - 1) + ' حساب دیگر'
}
// دفتر روزنامه: هر سند یک ردیفِ دوطرفهٔ متوازن (طرف‌حسابِ بدهکار / طرف‌حسابِ بستانکار + مبلغِ برابر)
function journalReport(q = {}) {
  const nf = jnorm(q.from), nt = jnorm(q.to), typ = q.type || '', fundId = +q.fundId || 0, unitId = +q.unitId || 0, search = (q.q || '').trim()
  const inR = jd => (!nf || jnorm(jd) >= nf) && (!nt || jnorm(jd) <= nt)
  const omrani = omraniFundId()
  const refs = []
  if (!typ || ['charge', 'bill', 'proj', 'exp'].includes(typ)) {
    for (const i of db.prepare(`SELECT i.*, c.name category FROM invoices i LEFT JOIN expense_categories c ON c.id=i.category_id WHERE i.is_opening=0`).all()) {
      const kind = invKind(i)
      if (typ && typ !== kind) continue
      if (!inR(i.j_date)) continue
      if (fundId && i.fund_id !== fundId) continue
      if (unitId && !db.prepare(`SELECT 1 FROM invoice_shares WHERE invoice_id=? AND unit_id=?`).get(i.id, unitId)) continue
      if (search && !(i.title || '').includes(search)) continue
      refs.push({ g: i.g_date, j: i.j_date, dtype: 'invoice', id: i.id, kind })
    }
  }
  if (!typ || typ === 'pay') {
    for (const p of db.prepare(`SELECT p.*, u.number unit_number FROM payments p LEFT JOIN units u ON u.id=p.unit_id WHERE p.is_opening=0`).all()) {
      if (!inR(p.j_date)) continue
      if (fundId && p.fund_id !== fundId) continue
      if (unitId && p.unit_id !== unitId) continue
      if (search && !('دریافتی واحد ' + p.unit_number + ' ' + (p.note || '')).includes(search)) continue
      refs.push({ g: p.g_date, j: p.j_date, dtype: 'payment', id: p.id, kind: 'pay' })
    }
  }
  if ((!typ || typ === 'ci') && !unitId) {
    for (const c of db.prepare(`SELECT * FROM contractor_invoices`).all()) {
      if (!inR(c.j_date)) continue
      if (fundId && (c.fund_id || omrani) !== fundId) continue
      if (search && !((c.title || '') + ' ' + (c.vendor_name || '')).includes(search)) continue
      refs.push({ g: c.g_date, j: c.j_date, dtype: 'contractor', id: c.id, kind: 'ci' })
    }
  }
  if ((!typ || typ === 'ftxn') && !unitId) {
    for (const t of db.prepare(`SELECT * FROM fund_txns WHERE type IN ('transfer_out','manager_settle','adjust_in','adjust_out')`).all()) {
      if (!inR(t.j_date)) continue
      if (fundId && t.fund_id !== fundId && t.peer_fund_id !== fundId) continue
      if (search && !(t.note || '').includes(search)) continue
      refs.push({ g: t.g_date, j: t.j_date, dtype: 'ftxn', id: t.id, kind: 'ftxn' })
    }
  }
  refs.sort((a, b) => a.g < b.g ? -1 : a.g > b.g ? 1 : a.id - b.id)
  const rows = refs.map((r, k) => {
    const v = voucherOf(r.dtype, r.id)
    if (!v) return null
    return {
      row: k + 1, dtype: r.dtype, id: r.id, kind: r.kind, no: v.head.no, j: v.head.j, title: v.head.title, typeFa: v.head.typeFa,
      debitAcc: sideLabel(v.lines.filter(l => l.debit > 0)), creditAcc: sideLabel(v.lines.filter(l => l.credit > 0)),
      debit: v.totalDebit, credit: v.totalCredit, balanced: v.balanced
    }
  }).filter(Boolean)
  const totalDebit = rows.reduce((s, d) => s + d.debit, 0), totalCredit = rows.reduce((s, d) => s + d.credit, 0)
  // «متوازن» فقط یعنی هر سند دوطرفه است؛ کنترلِ واقعی، تطبیقِ خطوطِ صندوق با موجودیِ واقعی است
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit, kindFa: JKIND_FA, control: journalFundControl() }
}

// برگهٔ سندِ دوطرفه: خطوطِ بدهکار/بستانکار که همیشه متوازن‌اند
function voucherOf(dtype, id) {
  const lines = []
  if (dtype === 'invoice') {
    const i = db.prepare(`SELECT i.*, c.name category, f.name fund_name FROM invoices i LEFT JOIN expense_categories c ON c.id=i.category_id LEFT JOIN funds f ON f.id=i.fund_id WHERE i.id=?`).get(id)
    if (!i) return null
    const kind = invKind(i)
    const head = { no: String(i.id), j: i.j_date, typeFa: JKIND_FA[kind], title: i.title, amount: i.amount, meta: `دسته: ${i.category || '—'} · صندوق: ${i.fund_name || '—'}${i.from_fund ? '' : ' · روش: ' + (METHOD_FA[i.method] || i.method)}` }
    if (i.from_fund || !(i.is_charge || i.is_billing)) {
      // بخشِ هزینه: هزینه در برابرِ پولی که واقعاً از هر صندوق رفته + باقیِ پرداخت‌نشده (به مدیر یا فروشنده)
      if (!i.from_fund) {
        // هزینهٔ تقسیمی: اول سهمِ واحدها در برابرِ «بازیافت هزینه از ساکنین»
        const shares = db.prepare(`SELECT s.share_amount, u.number, u.resident_name FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY CAST(u.number AS INTEGER)`).all(i.id)
        for (const s of shares) lines.push({ acc: 'واحد ' + s.number + (s.resident_name ? ' — ' + s.resident_name : ''), desc: 'سهمِ این سند', debit: s.share_amount, credit: 0 })
        const shTot = shares.reduce((a, s) => a + s.share_amount, 0)
        if (shTot) lines.push({ acc: 'بازیافت هزینه از ساکنین', desc: 'تقسیمِ هزینه بین واحدها', debit: 0, credit: shTot })
      }
      lines.push({ acc: 'هزینه: ' + (i.category || i.title), desc: i.title, debit: i.amount, credit: 0 })
      let fp = 0
      for (const ep of db.prepare(`SELECT ep.fund_id, f.name, SUM(ep.amount) s FROM expense_payments ep LEFT JOIN funds f ON f.id=ep.fund_id WHERE ep.invoice_id=? GROUP BY ep.fund_id`).all(i.id)) {
        fp += ep.s; lines.push({ acc: fundAcc(ep.name), fund: ep.fund_id, desc: 'پرداخت از صندوق', debit: 0, credit: ep.s })
      }
      const un = i.amount - fp
      if (un > 0) lines.push({ acc: i.paid_by_manager ? 'پرداختنی به مدیر' : 'پرداختنی به فروشنده', desc: i.paid_by_manager ? 'مدیر از جیب پرداخته' : 'هنوز پرداخت نشده', debit: 0, credit: un })
    } else {
      const shares = db.prepare(`SELECT s.share_amount, u.number, u.resident_name FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY CAST(u.number AS INTEGER)`).all(i.id)
      for (const s of shares) lines.push({ acc: 'واحد ' + s.number + (s.resident_name ? ' — ' + s.resident_name : ''), desc: 'سهمِ این سند', debit: s.share_amount, credit: 0 })
      const shTot = shares.reduce((a, s) => a + s.share_amount, 0)
      const credAcc = kind === 'charge' ? 'درآمد شارژ ماهانه' : kind === 'proj' ? 'تعهد پروژه (عمرانی)' : 'درآمد: ' + (i.category || i.title)
      lines.push({ acc: credAcc, desc: 'در مقابلِ سهمِ واحدها', debit: 0, credit: shTot })
    }
    return { head, lines, ...balance(lines), raw: i }
  }
  if (dtype === 'payment') {
    const p = db.prepare(`SELECT p.*, u.number, u.resident_name, f.name fund_name FROM payments p LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN funds f ON f.id=p.fund_id WHERE p.id=?`).get(id)
    if (!p) return null
    const head = { no: 'رسید ' + p.id, j: p.j_date, typeFa: 'دریافتی', title: 'دریافتی واحد ' + p.number, amount: p.amount, meta: `صندوق: ${p.fund_name || '—'}${p.method ? ' · روش: ' + p.method : ''}${p.note ? ' · ' + p.note : ''}` }
    lines.push({ acc: fundAcc(p.fund_name), fund: p.fund_id, desc: 'دریافت نقدی به صندوق', debit: p.amount, credit: 0 })
    lines.push({ acc: 'واحد ' + p.number + (p.resident_name ? ' — ' + p.resident_name : ''), desc: 'کسر از بدهیِ واحد', debit: 0, credit: p.amount })
    return { head, lines, ...balance(lines), raw: p }
  }
  if (dtype === 'contractor') {
    const c = db.prepare(`SELECT ci.*, p.title proj FROM contractor_invoices ci LEFT JOIN projects p ON p.id=ci.project_id WHERE ci.id=?`).get(id)
    if (!c) return null
    const fund = db.prepare(`SELECT name FROM funds WHERE id=?`).get(c.fund_id || omraniFundId())
    const paid = c.paid_amount != null ? c.paid_amount : (c.paid ? c.amount : 0), rem = c.amount - paid
    const head = { no: 'ci-' + c.id, j: c.j_date, typeFa: (c.kind === 'sale' ? 'فروش' : 'خرید') + ' پروژه', title: (c.title || '') + ' (' + (c.vendor_name || '') + ')', amount: c.amount, meta: `پروژه: ${c.proj || '—'} · صندوق: ${fund ? fund.name : '—'}` }
    const cps = db.prepare(`SELECT cp.fund_id, f.name, SUM(cp.amount) s FROM contractor_payments cp LEFT JOIN funds f ON f.id=cp.fund_id WHERE cp.cinvoice_id=? GROUP BY cp.fund_id`).all(c.id)
    const cpSum = cps.reduce((a, x) => a + x.s, 0)
    if (c.kind === 'sale') {
      for (const x of cps) lines.push({ acc: fundAcc(x.name), fund: x.fund_id, desc: 'دریافت از فروش', debit: x.s, credit: 0 })
      if (paid > cpSum) lines.push({ acc: fundAcc(fund ? fund.name : ''), desc: 'دریافت از فروش (بی‌قسط)', debit: paid - cpSum, credit: 0 })
      if (rem > 0) lines.push({ acc: 'دریافتنی از ' + (c.vendor_name || 'خریدار'), desc: 'دریافت‌نشده', debit: rem, credit: 0 })
      lines.push({ acc: 'درآمد فروش پروژه', desc: c.title || '', debit: 0, credit: c.amount })
    } else {
      lines.push({ acc: 'هزینهٔ پروژه', desc: c.title || '', debit: c.amount, credit: 0 })
      for (const x of cps) lines.push({ acc: fundAcc(x.name), fund: x.fund_id, desc: 'پرداخت به پیمانکار', debit: 0, credit: x.s })
      if (paid > cpSum) lines.push({ acc: fundAcc(fund ? fund.name : ''), desc: 'پرداخت به پیمانکار (بی‌قسط)', debit: 0, credit: paid - cpSum })
      if (rem > 0) lines.push({ acc: 'پرداختنی به ' + (c.vendor_name || 'پیمانکار'), desc: 'پرداخت‌نشده', debit: 0, credit: rem })
    }
    return { head, lines, ...balance(lines), raw: c }
  }
  if (dtype === 'ftxn') {
    const t = db.prepare(`SELECT t.*, f.name fund_name, pf.name peer_name FROM fund_txns t LEFT JOIN funds f ON f.id=t.fund_id LEFT JOIN funds pf ON pf.id=t.peer_fund_id WHERE t.id=?`).get(id)
    if (!t || !['transfer_out', 'manager_settle', 'adjust_in', 'adjust_out'].includes(t.type)) return null
    const F = { acc: fundAcc(t.fund_name), fund: t.fund_id }
    const head = { no: 'ص-' + t.id, j: t.j_date, typeFa: TXN_LABEL[t.type], title: t.note || TXN_LABEL[t.type], amount: t.amount, meta: 'صندوق: ' + (t.fund_name || '—') + (t.peer_name ? ' → ' + t.peer_name : '') }
    if (t.type === 'transfer_out') { lines.push({ acc: fundAcc(t.peer_name), fund: t.peer_fund_id, desc: 'انتقال ورودی', debit: t.amount, credit: 0 }); lines.push({ ...F, desc: 'انتقال خروجی', debit: 0, credit: t.amount }) }
    else if (t.type === 'manager_settle') { lines.push({ acc: 'پرداختنی به مدیر', desc: 'بازپرداخت به مدیر', debit: t.amount, credit: 0 }); lines.push({ ...F, desc: 'پرداخت از صندوق', debit: 0, credit: t.amount }) }
    else if (t.type === 'adjust_in') { lines.push({ ...F, desc: 'افزایش موجودی', debit: t.amount, credit: 0 }); lines.push({ acc: 'تعدیل صندوق', desc: t.note || '', debit: 0, credit: t.amount }) }
    else { lines.push({ acc: 'تعدیل صندوق', desc: t.note || '', debit: t.amount, credit: 0 }); lines.push({ ...F, desc: 'کاهش موجودی', debit: 0, credit: t.amount }) }
    return { head, lines, ...balance(lines), raw: t }
  }
  return null
}
// کنترلِ واقعیِ دفتر روزنامه: گردشِ خطوطِ «صندوق» در همهٔ اسناد باید با موجودیِ واقعیِ هر صندوق بخواند
function journalFundControl() {
  const net = {}
  const docs = [
    ...db.prepare(`SELECT id FROM invoices WHERE is_opening=0`).all().map(r => ['invoice', r.id]),
    ...db.prepare(`SELECT id FROM payments WHERE is_opening=0`).all().map(r => ['payment', r.id]),
    ...db.prepare(`SELECT id FROM contractor_invoices`).all().map(r => ['contractor', r.id]),
    ...db.prepare(`SELECT id FROM fund_txns WHERE type IN ('transfer_out','manager_settle','adjust_in','adjust_out')`).all().map(r => ['ftxn', r.id])]
  let unmapped = 0
  for (const [t, id] of docs) {
    const v = voucherOf(t, id); if (!v) continue
    for (const l of v.lines) if (l.fund || /^صندوق/.test(l.acc)) { if (l.fund) net[l.fund] = (net[l.fund] || 0) + l.debit - l.credit; else unmapped += l.debit - l.credit }
  }
  const funds = listFunds().map(f => { const journal = (f.opening_balance || 0) + (net[f.id] || 0); return { id: f.id, name: f.name, journal, actual: f.balance, diff: journal - f.balance } })
  return { ok: funds.every(f => f.diff === 0) && unmapped === 0, funds, unmapped }
}
const fundAcc = n => /^صندوق/.test(n || '') ? n : 'صندوق ' + (n || '')
function balance(lines) { const d = lines.reduce((a, l) => a + l.debit, 0), c = lines.reduce((a, l) => a + l.credit, 0); return { totalDebit: d, totalCredit: c, balanced: d === c } }

// فهرستِ حساب‌های قابلِ انتخاب برای دفتر کل
function ledgerAccounts() {
  const faToEn = s => parseInt(String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0
  const units = listUnits().filter(u => u.active).map(u => ({ id: u.id, label: 'واحد ' + u.number + (u.resident_name ? ' — ' + u.resident_name : '') })).sort((a, b) => faToEn(a.label) - faToEn(b.label))
  const funds = listFunds().map(f => ({ id: f.id, label: f.name }))
  const projects = projectsList().map(p => ({ id: p.id, label: p.title }))
  const vend = {}
  for (const c of db.prepare(`SELECT vendor_id, vendor_name FROM contractor_invoices`).all()) { const key = c.vendor_id || ('n:' + (c.vendor_name || '')); vend[key] = vend[key] || { id: c.vendor_id ? String(c.vendor_id) : key, label: c.vendor_name || 'پیمانکار' } }
  return { unit: units, fund: funds, project: projects, contractor: Object.values(vend) }
}

// دفتر کل (معین) یک حساب: ردیف‌های بدهکار/بستانکار با ماندهٔ دونده
function generalLedger(type, id, from, to) {
  const nf = jnorm(from), nt = jnorm(to)
  const inR = jd => (!nf || jnorm(jd) >= nf) && (!nt || jnorm(jd) <= nt)
  let name = '', opening = 0, ent = []
  if (type === 'unit') {
    const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(+id); if (!u) return null
    name = 'واحد ' + u.number + (u.resident_name ? ' — ' + u.resident_name : '')
    for (const s of db.prepare(`SELECT s.share_amount, s.invoice_id, i.title, i.j_date, i.g_date, i.is_opening, c.name category FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id LEFT JOIN expense_categories c ON c.id=i.category_id WHERE s.unit_id=?`).all(+id))
      ent.push({ g: s.g_date, j: s.is_opening ? '—' : s.j_date, no: 'سند ' + s.invoice_id, inv: s.invoice_id, dtype: 'invoice', title: s.title, cat: s.category || '—', debit: s.share_amount, credit: 0, open: s.is_opening })
    for (const p of db.prepare(`SELECT p.id, p.amount, p.j_date, p.g_date, p.is_opening, p.note, f.name fund_name FROM payments p LEFT JOIN funds f ON f.id=p.fund_id WHERE p.unit_id=?`).all(+id))
      ent.push({ g: p.g_date, j: p.is_opening ? '—' : p.j_date, no: 'رسید ' + p.id, dtype: 'payment', pid: p.id, title: 'دریافتی' + (p.fund_name ? ' — ' + p.fund_name : '') + (p.note ? ' · ' + p.note : ''), cat: 'دریافتی', debit: 0, credit: p.amount, open: p.is_opening })
  } else if (type === 'fund') {
    const f = db.prepare(`SELECT * FROM funds WHERE id=?`).get(+id); if (!f) return null
    name = f.name; opening = f.opening_balance || 0
    for (const t of db.prepare(`SELECT t.*, i.title inv_title, u.number unit_number FROM fund_txns t LEFT JOIN invoices i ON i.id=t.ref_invoice_id LEFT JOIN payments p ON p.id=t.ref_payment_id LEFT JOIN units u ON u.id=p.unit_id WHERE t.fund_id=?`).all(+id)) {
      const isin = ['in', 'transfer_in', 'adjust_in'].includes(t.type)
      const no = t.ref_payment_id ? 'رسید ' + t.ref_payment_id : t.ref_invoice_id ? 'سند ' + t.ref_invoice_id : t.ref_cinvoice_id ? 'ci-' + t.ref_cinvoice_id : /transfer/.test(t.type) ? 'انتقال' : '—'
      ent.push({ g: t.g_date, j: t.j_date, no, dtype: t.ref_payment_id ? 'payment' : t.ref_invoice_id ? 'invoice' : t.ref_cinvoice_id ? 'contractor' : '', refid: t.ref_payment_id || t.ref_invoice_id || t.ref_cinvoice_id, title: t.note || t.inv_title || (t.unit_number ? 'واحد ' + t.unit_number : (TXN_LABEL[t.type] || t.type)), cat: TXN_LABEL[t.type] || t.type, debit: isin ? t.amount : 0, credit: isin ? 0 : t.amount })
    }
  } else if (type === 'contractor') {
    const isNum = /^\d+$/.test(String(id))
    const where = isNum ? `ci.vendor_id=${+id}` : `ci.vendor_name=?`
    const args = isNum ? [] : [String(id).replace(/^n:/, '')]
    const rows = db.prepare(`SELECT ci.*, p.title proj FROM contractor_invoices ci LEFT JOIN projects p ON p.id=ci.project_id WHERE ${where}`).all(...args)
    name = (rows[0] && rows[0].vendor_name) || 'پیمانکار'
    for (const c of rows) {
      const sale = c.kind === 'sale', paid = c.paid_amount != null ? c.paid_amount : (c.paid ? c.amount : 0)
      // بستانکار = طلبِ پیمانکار از ما (خرید)؛ بدهکار = پرداختِ ما
      ent.push({ g: c.g_date, j: c.j_date, no: 'ci-' + c.id, dtype: 'contractor', cid: c.id, title: (c.title || '') + (sale ? ' (فروش)' : ''), cat: c.proj || '—', debit: sale ? c.amount : 0, credit: sale ? 0 : c.amount })
      for (const cp of db.prepare(`SELECT * FROM contractor_payments WHERE cinvoice_id=? ORDER BY g_date, id`).all(c.id))
        ent.push({ g: cp.g_date, j: cp.j_date, no: 'ci-' + c.id, dtype: 'contractor', cid: c.id, title: (sale ? 'دریافت از فروش' : 'پرداخت به پیمانکار') + (cp.note ? ' · ' + cp.note : ''), cat: c.proj || '—', debit: sale ? 0 : cp.amount, credit: sale ? cp.amount : 0 })
    }
  } else if (type === 'project') {
    const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(+id); if (!p) return null
    name = p.title
    for (const c of db.prepare(`SELECT * FROM contractor_invoices WHERE project_id=?`).all(+id)) {
      const sale = c.kind === 'sale'
      ent.push({ g: c.g_date, j: c.j_date, no: 'ci-' + c.id, dtype: 'contractor', cid: c.id, title: (c.title || '') + ' (' + (c.vendor_name || '') + ')', cat: sale ? 'فروش' : 'خرید', debit: sale ? 0 : c.amount, credit: sale ? c.amount : 0 })
    }
    for (const pay of db.prepare(`SELECT pay.id, pay.amount, pay.j_date, pay.g_date, u.number FROM payments pay LEFT JOIN units u ON u.id=pay.unit_id WHERE pay.project_id=?`).all(+id))
      ent.push({ g: pay.g_date, j: pay.j_date, no: 'رسید ' + pay.id, dtype: 'payment', pid: pay.id, title: 'دریافتِ پروژه از واحد ' + pay.number, cat: 'دریافتی', debit: 0, credit: pay.amount })
  } else return null
  // بازهٔ تاریخ: ماندهٔ قبل از بازه به‌عنوان «اول دوره»
  let before = opening
  const rows = []
  ent.sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : 0))
  for (const e of ent) { if (nf && jnorm(e.j) !== '—' && jnorm(e.j) < nf) { before += e.debit - e.credit; continue } ; if (inR(e.j) || e.j === '—') rows.push(e) }
  let bal = before
  const out = rows.map(e => { bal += e.debit - e.credit; return { ...e, balance: bal } })
  const totD = rows.reduce((a, e) => a + e.debit, 0), totC = rows.reduce((a, e) => a + e.credit, 0)
  return { type, id, name, opening: before, rows: out, totalDebit: totD, totalCredit: totC, finalBalance: bal }
}

// گزارشِ کاملِ همهٔ صندوق‌ها (از ابتدا تا الان): موجودی اولیه · دریافتی · مخارج · موجودی فعلی · بدهکارِ واحدها
function fundsOverview() {
  const ledger = unitLedgerReport().rows
  const debtField = { charge: 'charge', omrani: 'omrani', project: 'projectDue' }
  const funds = fundStats().map(f => {
    const cat = bucketOfFund(f)
    const unitDebt = ledger.reduce((a, r) => a + Math.max(0, r[debtField[cat]] || 0), 0)
    return { id: f.id, name: f.name, kindFa: f.kindFa, cat, opening: f.opening, received: f.received, spent: f.spent, residents: f.residents, otherIn: f.otherIn, expenses: f.expenses, managerSettle: f.managerSettle, transferNet: f.transferNet, adjust: f.adjust, balance: f.balance, unitDebt }
  })
  const total = funds.reduce((a, f) => ({
    opening: a.opening + f.opening, received: a.received + f.received, spent: a.spent + f.spent, transferNet: a.transferNet + f.transferNet, adjust: a.adjust + f.adjust,
    balance: a.balance + f.balance, unitDebt: a.unitDebt + f.unitDebt
  }), { opening: 0, received: 0, spent: 0, transferNet: 0, adjust: 0, balance: 0, unitDebt: 0 })
  return { funds, total }
}

// ---------- ضریب تأخیر در پرداخت ----------
const gMinusDays = (g, days) => { const d = new Date(Date.parse(g + 'T00:00:00Z') - days * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` }
function lateFeeCategoryId() {
  const c = db.prepare(`SELECT id FROM expense_categories WHERE name='جریمه‌ی تأخیر'`).get()
  if (c) return c.id
  const fund = db.prepare(`SELECT id FROM funds ORDER BY id`).get()
  return Number(db.prepare(`INSERT INTO expense_categories(name,default_method,include_vacant,default_fund_id,active,sort) VALUES(?,?,?,?,0,98)`)
    .run('جریمه‌ی تأخیر', 'custom', 0, fund ? fund.id : null).lastInsertRowid)
}
// بدهیِ معوقِ یک واحد: سهم‌های تسویه‌نشده که تاریخ فاکتورشان از مهلت قدیمی‌تر است
function overdueDebt(unitId, cutoffG) {
  const rows = db.prepare(`SELECT s.id, s.share_amount FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id
    WHERE s.unit_id=? AND i.g_date<=?`).all(unitId, cutoffG)
  let sum = 0
  for (const r of rows) { const rem = r.share_amount - shareAllocated(r.id); if (rem > 0) sum += rem }
  return sum
}
function lateFeePreview(period) {
  const percent = +getSetting('lateFeePercent', '0') || 0
  const grace = +getSetting('lateFeeGraceDays', '30') || 30
  const cutoff = gMinusDays(todayG(), grace)
  const rows = []
  for (const u of eligibleUnits(true)) {
    const base = overdueDebt(u.id, cutoff)
    const fee = Math.round(base * percent / 100)
    if (fee > 0) rows.push({ unit_id: u.id, number: u.number, resident: u.resident_name, base, fee })
  }
  return {
    percent, grace, cutoff, period, periodFa: periodFa(period),
    rows, total: rows.reduce((s, r) => s + r.fee, 0),
    already: !!db.prepare(`SELECT 1 FROM invoices WHERE is_billing=1 AND category_id=? AND charge_period=?`).get(lateFeeCategoryId(), period)
  }
}
function applyLateFees(period, by = null) {
  const pv = lateFeePreview(period)
  if (pv.percent <= 0) return { created: false, reason: 'ضریب تأخیر خاموش است (۰٪)' }
  if (pv.already) return { created: false, reason: 'جریمه‌ی این ماه قبلاً اعمال شده است' }
  if (!pv.rows.length) return { created: false, reason: 'واحد معوقی برای جریمه وجود ندارد' }
  const cat = lateFeeCategoryId()
  const gd = todayG(), t = todayJ(), jd = jStr(t.jy, t.jm, t.jd)
  const fundId = db.prepare(`SELECT id FROM funds ORDER BY id`).get().id
  const invId = Number(db.prepare(`INSERT INTO invoices
    (title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,status,is_billing,charge_period,created_by,created_at)
    VALUES(?,?,?,?,?,'custom',0,?,0,'variable','open',1,?,?,?)`)
    .run(`جریمه‌ی تأخیر ${periodFa(period)} (${faNum(pv.percent)}٪)`, cat, pv.total, gd, jd, fundId, period, by, nowISO()).lastInsertRowid)
  writeShares(invId, pv.rows.map(r => ({ unit_id: r.unit_id, share_amount: r.fee })))
  return { created: true, id: invId, total: pv.total, units: pv.rows.length }
}

// ---------- گزارش‌ها ----------
function dashboard() {
  const funds = listFunds()
  const units = unitsWithBalance()
  const debtors = units.filter(u => u.debt > 0).sort((a, b) => b.debt - a.debt)
  const totalDebt = debtors.reduce((s, u) => s + u.debt, 0)
  const totalCredit = units.reduce((s, u) => s + u.credit, 0)
  const p = curPeriod(), from = periodFirstG(p), to = periodFirstG(shiftPeriod(p, 1))
  // دریافتی و هزینهٔ ماه = تعریفِ واحدِ صورتِ درآمد و هزینه (نقدی)
  const cashM = incomeStatement(from, periodLastG(p))
  const monthIn = cashM.income
  // شارژ ماهانه (تعهد ساکنین) از هزینه‌های واقعی ساختمان جدا حساب می‌شود
  const monthCharge = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE is_opening=0 AND is_charge=1 AND g_date>=? AND g_date<?`).get(from, to).s
  const monthExpense = cashM.expense
  // وصولِ شارژِ این ماه: چند واحد کامل پرداخته‌اند و چقدر وصول شده
  const chInv = db.prepare(`SELECT * FROM invoices WHERE is_charge=1 AND charge_period=?`).get(p)
  let charge = null
  if (chInv) {
    const sh = db.prepare(`SELECT id, share_amount FROM invoice_shares WHERE invoice_id=?`).all(chInv.id)
    const paid = sh.filter(s => shareAllocated(s.id) >= s.share_amount).length
    const collected = sh.reduce((a, s) => a + Math.min(s.share_amount, shareAllocated(s.id)), 0)
    charge = { units: sh.length, paidUnits: paid, committed: chInv.amount, collected, gap: chInv.amount - collected }
  }
  // بدهیِ معوق (+۹۰ روز)
  const overdueRows = debtors.filter(u => u.aging && u.aging.days > 90).map(u => ({ ...u, over: unitAges(u.id, u.debt)['+۹۰'] })).filter(u => u.over > 0)
  const overdue = { count: overdueRows.length, total: overdueRows.reduce((a, u) => a + u.over, 0) }
  // فاکتورهای پیمانکارِ پرداخت‌نشده (خرید)
  const ciOpen = db.prepare(`SELECT * FROM contractor_invoices WHERE kind<>'sale'`).all()
    .map(c => ({ ...c, rem: c.amount - (c.paid_amount != null ? c.paid_amount : (c.paid ? c.amount : 0)) })).filter(c => c.rem > 0)
  const unpaidCI = { count: ciOpen.length, total: ciOpen.reduce((a, c) => a + c.rem, 0) }
  // طلبِ هر صندوق از ساکنین
  const fundsOv = fundsOverview().funds
  // آخرین گردش‌های صندوق
  const recentMoves = db.prepare(`SELECT t.*, f.name fund_name, i.title inv_title, u.number unit_number FROM fund_txns t
    LEFT JOIN funds f ON f.id=t.fund_id LEFT JOIN invoices i ON i.id=t.ref_invoice_id
    LEFT JOIN payments pp ON pp.id=t.ref_payment_id LEFT JOIN units u ON u.id=pp.unit_id
    ORDER BY t.g_date DESC, t.id DESC LIMIT 6`).all()
    .map(t => ({ j: t.j_date, fund: t.fund_name, isIn: ['in', 'transfer_in', 'adjust_in'].includes(t.type), amount: t.amount,
      title: t.note || t.inv_title || (t.unit_number ? 'واحد ' + t.unit_number : (TXN_LABEL[t.type] || t.type)),
      dtype: t.ref_payment_id ? 'payment' : t.ref_invoice_id ? 'invoice' : t.ref_cinvoice_id ? 'contractor' : '', refid: t.ref_payment_id || t.ref_invoice_id || t.ref_cinvoice_id }))
  // آخرین اسنادِ دفتر روزنامه
  const recentDocs = journalReport({}).rows.slice(-6).reverse()
  // هشدارها
  const alerts = []
  for (const f of funds) if (f.balance < 0) alerts.push({ level: 'red', text: `کسریِ ${f.name}: ${f.balance}`, amount: -f.balance, fund: f.id, kind: 'fund' })
  const missing = missingChargePeriods()
  if (missing.length) alerts.push({ level: 'amber', kind: 'charge', text: `شارژِ ${missing.length} ماه صادر نشده` })
  if (unpaidCI.count) alerts.push({ level: 'amber', kind: 'ci', text: `${unpaidCI.count} فاکتور پیمانکارِ پرداخت‌نشده`, amount: unpaidCI.total })
  if (overdue.count) alerts.push({ level: 'amber', kind: 'overdue', text: `${overdue.count} بدهکارِ بالای ۹۰ روز`, amount: overdue.total })
  const unpaidExp = unpaidExpensesTotal()
  if (unpaidExp > 0) alerts.push({ level: 'amber', kind: 'exp', text: 'هزینه‌های پرداخت‌نشده از صندوق', amount: unpaidExp })
  const lb = getSetting('lastBackupAt', '')
  const lbDays = lb ? Math.floor((Date.now() - Date.parse(lb)) / 86400000) : null
  if (lbDays == null || lbDays > 7) alerts.push({ level: lbDays == null ? 'red' : 'amber', kind: 'backup', text: lbDays == null ? 'هنوز هیچ بکاپی گرفته نشده' : `آخرین بکاپ ${lbDays} روز پیش بوده` })
  try { const h = ledgerHealth(); if (!h.ok) alerts.unshift({ level: 'red', kind: 'health', text: 'کنترل سلامت دفاتر ایراد پیدا کرده: ' + h.checks.filter(c => !c.ok).map(c => c.title).join('، ') }) } catch { }
  return {
    funds, fundTotal: funds.reduce((s, f) => s + f.balance, 0),
    totalDebt, totalCredit, managerDebt: managerDebt(),
    monthIn, monthCharge, monthExpense, monthOut: monthExpense, monthFa: periodFa(p),
    unitCount: units.filter(u => u.active).length,
    topDebtors: debtors.slice(0, 5),
    openInvoices: listInvoices({ status: 'open', limit: 8 }),
    missingCharges: missing,
    unpaidExpenses: unpaidExp, interFund: interFundDebts(),
    fundStats: fundStats(), projectSummaries: projectsList().filter(p => projectChargeInvoice(p.id)).map(p => ({ id: p.id, title: p.title, status: p.status, statusFa: p.statusFa, ...projectSummary(p) })),
    charge, overdue, unpaidCI, ciOpen: ciOpen.slice(0, 5).map(c => ({ id: c.id, title: c.title, vendor: c.vendor_name, rem: c.rem, project_id: c.project_id })),
    fundsOv, recentMoves, recentDocs, alerts, lastBackupAt: lb
  }
}
function debtorsReport() {
  const rows = unitsWithBalance().filter(u => u.debt > 0)
    .sort((a, b) => (b.aging ? b.aging.days : 0) - (a.aging ? a.aging.days : 0) || b.debt - a.debt)
  const buckets = { '۰-۳۰': 0, '۳۱-۶۰': 0, '۶۱-۹۰': 0, '+۹۰': 0 }
  for (const r of rows) { r.ages = unitAges(r.id, r.debt); for (const k of AGE_KEYS) buckets[k] += r.ages[k] }
  return { rows, total: rows.reduce((s, r) => s + r.debt, 0), buckets }
}
function managerReport(from, to) {
  from = from || periodFirstG(curPeriod()); to = to || todayG()
  const pays = db.prepare(`SELECT p.*, f.name fund_name FROM payments p LEFT JOIN funds f ON f.id=p.fund_id
    WHERE p.is_opening=0 AND p.g_date>=? AND p.g_date<=?`).all(from, to)
  const byFund = {}
  for (const p of pays) (byFund[p.fund_name || '—'] ||= { name: p.fund_name || '—', amount: 0, count: 0 }),
    byFund[p.fund_name || '—'].amount += p.amount, byFund[p.fund_name || '—'].count++
  // هزینه‌ها فقط هزینه‌ی واقعی ساختمان‌اند؛ شارژ ماهانه و جریمه‌ی تأخیر «صورت‌حساب ساکن»‌اند نه هزینه
  const invs = db.prepare(`SELECT i.*, c.name category FROM invoices i LEFT JOIN expense_categories c ON c.id=i.category_id
    WHERE i.is_opening=0 AND i.is_charge=0 AND i.is_billing=0 AND i.g_date>=? AND i.g_date<=?`).all(from, to)
  const byCat = {}
  for (const i of invs) {
    const k = i.category || '—'
    ;(byCat[k] ||= { name: k, fixed: 0, variable: 0, unexpected: 0, total: 0, count: 0 })
    byCat[k][EXPENSE_KINDS.includes(i.expense_kind) ? i.expense_kind : 'variable'] += i.amount
    byCat[k].total += i.amount; byCat[k].count++
  }
  const fundFlow = listFunds().map(f => {
    const before = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ${FUND_IN} THEN amount ELSE -amount END),0) s
      FROM fund_txns WHERE fund_id=? AND g_date<?`).get(f.id, from).s
    const q = t => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fund_txns WHERE fund_id=? AND type IN ${t} AND g_date>=? AND g_date<=?`).get(f.id, from, to).s
    const inn = q(`('in','adjust_in')`), out = q(`('out','manager_settle','adjust_out')`), trIn = q(`('transfer_in')`), trOut = q(`('transfer_out')`)
    const open = f.opening_balance + before
    return { id: f.id, name: f.name, open, in: inn, out, transfer: trIn - trOut, close: open + inn - out + trIn - trOut }
  })
  const invRows = invs.map(i => { const c = invoiceCollected(i.id); return { id: i.id, title: i.title, j_date: i.j_date, category: i.category, amount: i.amount, collected: c, remaining: i.amount - c, kindFa: EXPENSE_KIND_FA[i.expense_kind] || '' } })
    .sort((a, b) => b.id - a.id)
  return {
    from, to,
    payments: { total: pays.reduce((s, p) => s + p.amount, 0), count: pays.length, byFund: Object.values(byFund) },
    expenses: { total: invs.reduce((s, i) => s + i.amount, 0), count: invs.length, byCategory: Object.values(byCat).sort((a, b) => b.total - a.total) },
    invoices: invRows, fundFlow, managerDebt: managerDebt(), cash: incomeStatement(from, to),
    buildingName: getSetting('buildingName'), managerName: getSetting('managerName', '')
  }
}
// ---------- صورتِ درآمد و هزینه (مبنای نقدی، ماه‌به‌ماه) — تعریفِ واحدِ «دریافتی / هزینه / خالص» در کلِ برنامه ----------
// درآمد = پولی که واقعاً به صندوق‌ها آمد (دریافت از ساکنین به تفکیک سبد، جریمه، فروش)؛ هزینه = پولی که واقعاً از صندوق رفت
// (پرداخت هزینه به تفکیک دسته، پرداخت به پیمانکار، تسویه با مدیر). انتقال بین صندوق‌ها و سند تعدیل جزو درآمد/هزینه نیستند.
function incomeStatement(from, to) {
  from = from || periodFirstG(curPeriod()); to = to || todayG()
  const lf = (db.prepare(`SELECT id FROM expense_categories WHERE name='جریمه‌ی تأخیر'`).get() || {}).id || 0
  const txns = db.prepare(`SELECT t.*, f.name fund_name, f.bucket fbucket, f.kind fkind, p.is_opening p_open,
      i.title inv_title, c.name cat_name, ci.title ci_title, ci.project_id ci_pid, pr.title pr_title, ci.vendor_name
    FROM fund_txns t LEFT JOIN funds f ON f.id=t.fund_id LEFT JOIN payments p ON p.id=t.ref_payment_id
    LEFT JOIN invoices i ON i.id=t.ref_invoice_id LEFT JOIN expense_categories c ON c.id=i.category_id
    LEFT JOIN contractor_invoices ci ON ci.id=t.ref_cinvoice_id LEFT JOIN projects pr ON pr.id=ci.project_id
    WHERE t.g_date>=? AND t.g_date<=? ORDER BY t.g_date, t.id`).all(from, to)
  const periods = []
  { const first = txns.length ? txns[0].g_date : todayG(), lastG = to > todayG() ? todayG() : to
    let p = periodOf(toJalaali(...(from < first ? first : from).split('-').map(Number))), last = periodOf(toJalaali(...(lastG < from ? from : lastG).split('-').map(Number))), n = 0
    while (n++ < 240) { periods.push(p); if (p === last) break; p = shiftPeriod(p, 1) } }
  const lines = {}   // key → { side, group, label, total, byMonth{} }
  const add = (side, group, label, amount, period) => {
    const k = side + '|' + group + '|' + label
    const l = lines[k] ||= { side, group, label, total: 0, byMonth: {} }
    l.total += amount; l.byMonth[period] = (l.byMonth[period] || 0) + amount
  }
  const nonOp = { transferIn: 0, transferOut: 0, adjustIn: 0, adjustOut: 0 }
  for (const t of txns) {
    const per = periodOf(toJalaali(...t.g_date.split('-').map(Number)))
    const b = bucketOfFund({ bucket: t.fbucket, kind: t.fkind, name: t.fund_name })
    if (t.type === 'in') {
      if (t.ref_payment_id) {
        if (t.p_open) continue
        // سهمِ جریمهٔ دیرکرد از این دریافتی (از روی تخصیص‌ها)
        const late = lf ? db.prepare(`SELECT COALESCE(SUM(a.amount),0) s FROM payment_allocations a JOIN invoice_shares s ON s.id=a.share_id
          JOIN invoices i ON i.id=s.invoice_id WHERE a.payment_id=? AND i.category_id=?`).get(t.ref_payment_id, lf).s : 0
        if (late > 0) add('in', 'دریافت از ساکنین', 'جریمهٔ دیرکرد', Math.min(late, t.amount), per)
        if (t.amount - late > 0) add('in', 'دریافت از ساکنین', b === 'charge' ? 'شارژ ماهانه' : b === 'project' ? 'پروژه‌های عمرانی' : 'قبوض و متفرقه', t.amount - late, per)
      } else if (t.ref_cinvoice_id) add('in', 'سایر درآمدها', 'فروش / داغی' + (t.pr_title ? ' — ' + t.pr_title : ''), t.amount, per)
      else add('in', 'سایر درآمدها', t.note || 'سایر واریزها', t.amount, per)
    } else if (t.type === 'out') {
      if (t.ref_cinvoice_id) add('out', 'پروژه‌های عمرانی', t.pr_title || t.vendor_name || 'پیمانکار', t.amount, per)
      else if (t.ref_invoice_id) add('out', 'هزینه‌های ساختمان', t.cat_name || 'بدون دسته', t.amount, per)
      else add('out', 'سایر پرداخت‌ها', t.note || 'پرداخت', t.amount, per)
    } else if (t.type === 'manager_settle') add('out', 'تسویه با مدیر', 'بازپرداختِ هزینه‌هایی که مدیر پرداخته بود', t.amount, per)
    else if (t.type === 'transfer_in') nonOp.transferIn += t.amount
    else if (t.type === 'transfer_out') nonOp.transferOut += t.amount
    else if (t.type === 'adjust_in') nonOp.adjustIn += t.amount
    else if (t.type === 'adjust_out') nonOp.adjustOut += t.amount
  }
  const all = Object.values(lines).sort((a, b) => b.total - a.total)
  const sum = side => all.filter(l => l.side === side).reduce((s, l) => s + l.total, 0)
  const sumM = (side, p) => all.filter(l => l.side === side).reduce((s, l) => s + (l.byMonth[p] || 0), 0)
  const income = sum('in'), expense = sum('out')
  const cashAt = g => listFunds().reduce((s, f) => s + f.opening_balance + db.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ${FUND_IN} THEN amount ELSE -amount END),0) s FROM fund_txns WHERE fund_id=? AND g_date<?`).get(f.id, g).s, 0)
  const nextDay = g => { const d = new Date(Date.parse(g + 'T00:00:00Z') + 86400000); return d.toISOString().slice(0, 10) }
  const openCash = cashAt(from), closeCash = cashAt(nextDay(to))
  // هزینه‌هایی که مدیر از جیب داده و هنوز صندوق به او پس نداده — جزو هزینهٔ نقدیِ صندوق نیست؛ جدا یادداشت می‌شود
  return {
    from, to, fromJ: gToJStr(from), toJ: gToJStr(to), basis: 'نقدی (پولی که واقعاً وارد یا خارج شده)',
    periods: periods.map(p => ({ key: p, fa: periodFa(p), income: sumM('in', p), expense: sumM('out', p), net: sumM('in', p) - sumM('out', p) })),
    lines: all, income, expense, net: income - expense, nonOp,
    openCash, closeCash, check: openCash + income - expense + nonOp.transferIn - nonOp.transferOut + nonOp.adjustIn - nonOp.adjustOut - closeCash,
    managerDebt: managerDebt(), buildingName: getSetting('buildingName')
  }
}
// کنترلِ سلامتِ دفاتر: چند آزمونِ واقعی که اگر یکی خطا بدهد، جایی از دفاتر به هم ریخته است
function ledgerHealth() {
  const checks = []
  const add = (key, title, items, hint) => checks.push({ key, title, ok: items.length === 0, count: items.length, items: items.slice(0, 30), hint })
  // ۱) جمعِ سهم‌های هر فاکتورِ تقسیمی = مبلغِ فاکتور؛ هزینهٔ جاری (از صندوق) سهم ندارد
  const inv = db.prepare(`SELECT i.id, i.title, i.amount, COALESCE(i.from_fund,0) ff, COALESCE((SELECT SUM(share_amount) FROM invoice_shares WHERE invoice_id=i.id),0) sh FROM invoices i`).all()
  add('shares', 'سهم‌های هر فاکتور با مبلغِ فاکتور برابر است',
    inv.filter(i => i.ff ? i.sh !== 0 : (i.sh !== i.amount)).map(i => ({ text: `سند ${i.id} «${i.title}»: مبلغ ${i.amount} · جمعِ سهم‌ها ${i.sh}` })),
    'فاکتور را باز کنید و دوباره ذخیره کنید تا سهم‌ها بازمحاسبه شوند.')
  // ۲) هر دریافتی (غیرانتقالی) دقیقاً یک ورودیِ صندوق به همان مبلغ دارد
  const pays = db.prepare(`SELECT p.id, p.amount, p.fund_id, COALESCE((SELECT SUM(amount) FROM fund_txns WHERE ref_payment_id=p.id AND type IN ('in','transfer_in')),0) fx FROM payments p WHERE COALESCE(p.is_opening,0)=0`).all()
  add('payfund', 'هر دریافتی در صندوقِ خودش ثبت شده است',
    pays.filter(p => p.fx !== p.amount).map(p => ({ text: `رسید ${p.id}: مبلغ ${p.amount} · ورودیِ صندوق ${p.fx}` })),
    'دریافتی را باز کنید و دوباره ذخیره کنید.')
  // ۳) تراکنشِ صندوقِ یتیم (به سندی اشاره می‌کند که دیگر وجود ندارد)
  const orphan = db.prepare(`SELECT t.id, t.type, t.amount FROM fund_txns t
    WHERE (t.ref_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments WHERE id=t.ref_payment_id))
       OR (t.ref_invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices WHERE id=t.ref_invoice_id))
       OR (t.ref_cinvoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contractor_invoices WHERE id=t.ref_cinvoice_id))`).all()
  add('orphan', 'تراکنشِ صندوقِ بی‌سند وجود ندارد', orphan.map(t => ({ text: `تراکنش ${t.id} (${TXN_LABEL[t.type] || t.type}) به مبلغ ${t.amount}` })),
    'این تراکنش‌ها موجودیِ صندوق را بی‌دلیل تغییر داده‌اند؛ با پشتیبانی بررسی شود.')
  // ۴) پرداخت‌های هزینه با خروجی‌های صندوق می‌خوانند
  const ep = db.prepare(`SELECT invoice_id, SUM(amount) s FROM expense_payments GROUP BY invoice_id`).all()
  const epBad = ep.map(r => ({ ...r, fx: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM fund_txns WHERE type='out' AND ref_invoice_id=?`).get(r.invoice_id).s })).filter(r => r.fx !== r.s)
  add('exppay', 'پرداخت‌های هزینه با خروجیِ صندوق‌ها برابر است', epBad.map(r => ({ text: `سند ${r.invoice_id}: پرداخت‌شده ${r.s} · خروجیِ صندوق ${r.fx}` })), '')
  // ۵) هیچ دریافتی یا سهمی بیش از مبلغش تخصیص نخورده
  const overPay = db.prepare(`SELECT p.id, p.amount, SUM(a.amount) s FROM payments p JOIN payment_allocations a ON a.payment_id=p.id GROUP BY p.id HAVING s > p.amount`).all()
  const overShare = db.prepare(`SELECT s.id, s.invoice_id, s.share_amount, SUM(a.amount) x FROM invoice_shares s JOIN payment_allocations a ON a.share_id=s.id GROUP BY s.id HAVING x > s.share_amount`).all()
  add('overalloc', 'هیچ دریافتی یا سهمی بیش از مبلغش تخصیص نخورده',
    [...overPay.map(p => ({ text: `رسید ${p.id}: مبلغ ${p.amount} · تخصیص ${p.s}` })), ...overShare.map(x => ({ text: `سهمِ سند ${x.invoice_id}: ${x.share_amount} · تخصیص ${x.x}` }))], '')
  // ۶) پرداختِ پیمانکار با خروجیِ صندوق می‌خواند
  const ci = db.prepare(`SELECT c.id, c.title, c.amount, c.kind, COALESCE(c.paid_amount, CASE WHEN c.paid=1 THEN c.amount ELSE 0 END) paid,
    COALESCE((SELECT SUM(amount) FROM fund_txns WHERE ref_cinvoice_id=c.id),0) fx FROM contractor_invoices c`).all()
  add('ci', 'پرداخت‌های پیمانکار با صندوق می‌خواند', ci.filter(c => c.paid !== c.fx).map(c => ({ text: `ci-${c.id} «${c.title}»: پرداخت‌شده ${c.paid} · صندوق ${c.fx}` })), '')
  // ۷) اتحادِ اصلی: جمعِ بدهیِ واحدها = جمعِ سهم‌ها − جمعِ دریافتی‌ها
  const units = unitsWithBalance()
  const netDebt = units.reduce((a, u) => a + u.debt, 0)
  const totalShares = db.prepare(`SELECT COALESCE(SUM(share_amount),0) s FROM invoice_shares`).get().s
  const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments`).get().s
  add('identity', 'جمعِ بدهیِ واحدها = جمعِ سهم‌ها منهای جمعِ دریافتی‌ها', netDebt === totalShares - totalPaid ? [] : [{ text: `بدهیِ واحدها ${netDebt} · سهم‌ها − دریافتی‌ها ${totalShares - totalPaid}` }], '')
  try {
    const jc = journalFundControl()
    add('journal', 'دفتر روزنامه با موجودیِ واقعیِ صندوق‌ها می‌خواند', jc.funds.filter(f => f.diff).map(f => `${f.name}: دفتر ${f.journal} / واقعی ${f.actual}`).concat(jc.unmapped ? ['خطوط صندوقِ بی‌شناسه: ' + jc.unmapped] : []), 'جمعِ خطوطِ «صندوق» در همهٔ اسنادِ روزنامه به‌اضافهٔ موجودیِ اول، باید با موجودیِ واقعیِ هر صندوق برابر باشد.')
  } catch { }
  return { ok: checks.every(c => c.ok), checks, totals: { netDebt, totalShares, totalPayments: totalPaid, funds: listFunds().map(f => ({ name: f.name, balance: f.balance })) } }
}
// سازگاری با نامِ قدیمی
const balanceCheck = ledgerHealth

// ---------- CSV ----------
const csvEsc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csv = (head, rows) => '﻿' + [head.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\r\n')

// ---------- پشتیبان‌گیری ----------
function expandPath(p) { p = (p || '').trim(); if (p === '~' || p.startsWith('~/')) p = join(homedir(), p.slice(1)); return p }
function stamp() { const d = new Date(); const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()); return `${j.jy}${pad2(j.jm)}${pad2(j.jd)}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}` }
async function walkUploads(dir = UP_DIR, base = '') {
  const out = []
  for (const name of existsSync(dir) ? await readdir(dir) : []) {
    if (name.startsWith('.')) continue
    const full = join(dir, name), rel = base ? base + '/' + name : name
    const s = await stat(full)
    if (s.isDirectory()) out.push(...await walkUploads(full, rel))
    else out.push({ name: 'uploads/' + rel, data: await readFile(full) })
  }
  return out
}
async function collectFiles() {
  const snap = join(DATA_DIR, `_snap_${Date.now()}.db`)
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`)
  const entries = [{ name: 'data/sakhteman.db', data: await readFile(snap) }]
  await rm(snap, { force: true })
  entries.push(...await walkUploads())
  return entries
}
const DEFAULT_BK_DIR = join(USER_ROOT, 'بکاپ‌ها')
const bkDir = destRaw => expandPath(destRaw) || DEFAULT_BK_DIR
async function backupToFolder(destRaw, tag = '') {
  const dest = bkDir(destRaw)
  await mkdir(dest, { recursive: true })
  const file = join(dest, `sakhteman-backup-${stamp()}${tag ? '-' + tag : ''}.zip`)
  const entries = await collectFiles()
  await writeFile(file, makeZip(entries))
  setSetting('lastBackupAt', nowISO())
  return { folder: file, docs: entries.filter(e => e.name.startsWith('uploads/')).length }
}
async function listBackups(destRaw) {
  const dest = bkDir(destRaw); if (!existsSync(dest)) return []
  const out = []
  for (const n of await readdir(dest)) {
    if (n.startsWith('.') || !/^sakhteman-backup-.+\.zip$/i.test(n)) continue
    const st = n.replace(/^sakhteman-backup-/, '').replace(/\.zip$/i, '')
    out.push({ name: n, stamp: st, auto: /-a$/.test(st), pre: /-pre-restore$/.test(st) })
  }
  return out.sort((a, b) => b.stamp.localeCompare(a.stamp))
}
// چرخشِ بکاپ‌های خودکار: ۱۴ نسخهٔ آخر + یک نسخه از هر ماه تا ۱۲ ماه؛ بکاپ‌های دستی دست نمی‌خورند
async function rotateAutoBackups(destRaw) {
  const list = (await listBackups(destRaw)).filter(b => b.auto)
  const keep = new Set(list.slice(0, 14).map(b => b.name)), months = new Set()
  for (const b of list.slice(14)) { const ym = b.stamp.slice(0, 6); if (!months.has(ym) && months.size < 12) { months.add(ym); keep.add(b.name) } }
  for (const b of list) if (!keep.has(b.name)) await rm(join(bkDir(destRaw), b.name), { force: true })
}
async function runAutoBackup(reason) { return withWriteLock(() => runAutoBackupNow(reason)) }
async function runAutoBackupNow(reason) {
  try {
    const r = await backupToFolder(getSetting('backupPath'), 'a')
    await rotateAutoBackups(getSetting('backupPath'))
    console.log('✓ بکاپ خودکار' + (reason ? ' (' + reason + ')' : '') + ':', r.folder)
  } catch (e) { console.error('✗ بکاپ خودکار ناموفق:', e.message) }
}
// بررسیِ فایلِ بکاپ پیش از بازیابی: سالم بودنِ دیتابیس و خلاصهٔ محتوا (بدون دست زدن به دادهٔ فعلی)
async function inspectBackup(buf) {
  let entries
  try { entries = readZip(buf) } catch { throw new Error('فایل zip خراب است یا قابل خواندن نیست') }
  const dbEntry = entries.find(e => e.name.replace(/\\/g, '/') === 'data/sakhteman.db') || entries.find(e => basename(e.name) === 'sakhteman.db')
  if (!dbEntry) throw new Error('این فایل، بکاپ حسابدار ساختمان توی دید نیست (data/sakhteman.db پیدا نشد)')
  const tmp = join(DATA_DIR, `_restore_check_${Date.now()}.db`)
  await writeFile(tmp, dbEntry.data)
  let info
  try {
    const t = new DatabaseSync(tmp)
    try {
      const ic = t.prepare('PRAGMA integrity_check').get()
      if (!ic || Object.values(ic)[0] !== 'ok') throw new Error('دیتابیسِ داخلِ بکاپ آسیب‌دیده است (integrity_check)')
      const tables = new Set(t.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name))
      for (const need of ['invoices', 'payments', 'units', 'funds']) if (!tables.has(need)) throw new Error(`جدولِ ضروریِ «${need}» در بکاپ نیست`)
      const c = q => t.prepare(q).get().c
      const last = t.prepare('SELECT MAX(g_date) d FROM (SELECT g_date FROM invoices UNION ALL SELECT g_date FROM payments)').get().d
      const lastJ = last ? (() => { const [y, m, d] = last.split('-').map(Number); const j = toJalaali(y, m, d); return jStr(j.jy, j.jm, j.jd) })() : ''
      info = { units: c('SELECT COUNT(*) c FROM units'), invoices: c('SELECT COUNT(*) c FROM invoices'), payments: c('SELECT COUNT(*) c FROM payments'),
        building: (t.prepare("SELECT value v FROM settings WHERE key='buildingName'").get() || {}).v || '', lastDate: lastJ,
        docs: entries.filter(e => e.name.replace(/\\/g, '/').startsWith('uploads/')).length }
    } finally { t.close() }
  } finally { await rm(tmp, { force: true }) }
  const cur = { units: db.prepare('SELECT COUNT(*) c FROM units').get().c, invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c, payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c }
  return { ok: true, backup: info, current: cur, entries, dbEntry }
}
async function restoreBackup(buf) {
  const chk = await inspectBackup(buf)           // اگر خراب باشد همین‌جا متوقف می‌شود و دادهٔ فعلی دست نمی‌خورد
  const pre = await backupToFolder(getSetting('backupPath'), 'pre-restore')   // نسخهٔ پیش از بازیابی برای برگشت
  // اسناد اول در پوشهٔ موقت باز می‌شوند، بعد جابه‌جا
  const tmpUp = UP_DIR + '_restore_tmp', oldUp = UP_DIR + '_restore_old'
  await rm(tmpUp, { recursive: true, force: true }); await mkdir(tmpUp, { recursive: true })
  let count = 0
  for (const e of chk.entries) {
    const name = e.name.replace(/\\/g, '/').replace(/^\.\//, '')
    const parts = name.split('/')
    if (parts[0] !== 'uploads' || name.includes('..')) continue
    const bn = basename(name)
    if (bn.startsWith('._') || bn === '.DS_Store') continue
    const rel = parts.slice(1).join('/'); if (!rel) continue
    const target = join(tmpUp, rel)
    if (!target.startsWith(tmpUp)) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, e.data); count++
  }
  const newDb = join(DATA_DIR, '_restore_new.db')
  await writeFile(newDb, chk.dbEntry.data)
  try { db.close() } catch { }
  await rename(newDb, join(DATA_DIR, 'sakhteman.db'))
  await rm(join(DATA_DIR, 'sakhteman.db-wal'), { force: true })
  await rm(join(DATA_DIR, 'sakhteman.db-shm'), { force: true })
  await rm(oldUp, { recursive: true, force: true })
  if (existsSync(UP_DIR)) await rename(UP_DIR, oldUp)
  await rename(tmpUp, UP_DIR)
  await rm(oldUp, { recursive: true, force: true })
  db = new DatabaseSync(join(DATA_DIR, 'sakhteman.db'))
  ensureSchema(); seedDefaults(); migrateData()
  sessions.clear()
  let health = null; try { health = ledgerHealth() } catch { }
  return { count, preBackup: pre.folder, healthOk: health ? health.ok : null }
}

// ---------- بسته‌ی نصب/آپدیت ----------
let APP_VERSION = 'v1.000'
const sha1 = s => createHash('sha1').update(s).digest('hex')
const verStr = b => 'v1.' + String(b).padStart(3, '0')
const BASE = join(ROOT, '..')
const CORE = basename(ROOT)
const UPD_DIR = join(USER_ROOT, 'اپدیت')
const PKG_SKIP = new Set(['data', 'uploads', 'node_modules', 'اپدیت', 'بکاپ‌ها', '.git', '.claude'])
async function collectCodeFiles(dir = BASE, base = '') {
  const out = []
  for (const name of await readdir(dir)) {
    if (name.startsWith('.') || name.endsWith('.zip')) continue
    if (PKG_SKIP.has(name)) continue
    // هیچ نسخه‌ای از «حسابدار توی دید» نباید داخل بسته‌ی حسابدار ساختمان برود
    if (/toye[\s_-]?did|توی\s*دید/i.test(name) && name !== CORE) continue
    const full = join(dir, name), rel = base ? base + '/' + name : name
    const s = await stat(full)
    if (s.isDirectory()) out.push(...await collectCodeFiles(full, rel))
    else out.push({ name: rel, data: await readFile(full) })
  }
  return out
}
async function refreshPackage() {
  const all = await collectCodeFiles()
  const codeEntries = all.filter(e => basename(e.name) !== 'version.json')
  const sig = sha1(codeEntries.map(e => e.name + ':' + e.data.length).join('|'))
  let vjson = null
  try { vjson = JSON.parse(await readFile(join(ROOT, 'version.json'), 'utf8')) } catch { }
  let build, version, changed = false
  if (vjson && vjson.sig === sig) { build = vjson.build; version = vjson.version }
  else { build = (vjson ? vjson.build : 0) + 1; version = verStr(build); changed = true }
  APP_VERSION = version
  const zipName = `hesabdar sakhteman ${version}.zip`
  await mkdir(UPD_DIR, { recursive: true })
  if (!changed && existsSync(join(UPD_DIR, zipName))) return
  const vObj = { version, build, sig }
  await writeFile(join(ROOT, 'version.json'), JSON.stringify(vObj, null, 2))
  const entries = codeEntries.concat([{ name: CORE + '/version.json', data: Buffer.from(JSON.stringify(vObj, null, 2)) }])
  await writeFile(join(UPD_DIR, zipName), makeZip(entries))
  console.log(`✓ نسخه ${version} — بسته ساخته شد در پوشه‌ی اپدیت: ${zipName}`)
}
async function applyUpdate(buf) {
  const entries = readZip(buf)
  if (!entries.some(e => basename(e.name) === 'server.js'))
    throw new Error('این فایل، بسته‌ی نصب حسابدار ساختمان توی دید نیست (server.js پیدا نشد)')
  const PROTECTED = new Set(['data', 'uploads', 'اپدیت', 'بکاپ‌ها'])
  let count = 0
  for (const e of entries) {
    const name = e.name.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!name || name.startsWith('/') || name.split('/').includes('..')) continue
    const parts = name.split('/')
    if (parts[0] === '__MACOSX' || parts.some(p => PROTECTED.has(p))) continue
    const bn = basename(name)
    if (bn.startsWith('._') || bn === '.DS_Store' || name.endsWith('.zip')) continue
    const target = join(BASE, name)
    if (target !== BASE && !target.startsWith(BASE + '/')) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, e.data)
    if (name.endsWith('.command') || name.endsWith('.sh')) await chmod(target, 0o755)
    count++
  }
  return count
}

// ---------- سرور ----------
// ---------- رویدادها (جلسات/تصمیمات/پیشنهادات) ----------
const EVENT_KINDS = ['meeting', 'decision', 'proposal']
const EVENT_KIND_FA = { meeting: 'جلسه', decision: 'تصمیم/مصوبه', proposal: 'پیشنهاد' }
const EVENT_STATUSES = ['', 'approved', 'rejected', 'pending', 'done']
const EVENT_STATUS_FA = { approved: 'مصوب', rejected: 'رد شده', pending: 'در دست بررسی', done: 'انجام‌شده' }
const listAttachments = (t, id) => db.prepare(`SELECT id, file, display_name FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id`).all(t, id)
function eventsData() {
  const all = db.prepare(`SELECT * FROM events ORDER BY g_date DESC, id DESC`).all()
  const enrich = e => ({ ...e, kindFa: EVENT_KIND_FA[e.kind] || e.kind, statusFa: EVENT_STATUS_FA[e.status] || '', attachments: listAttachments('event', e.id) })
  const meetings = all.filter(e => e.kind === 'meeting').map(m => ({ ...enrich(m), children: all.filter(c => +c.parent_id === m.id).map(enrich) }))
  const orphans = all.filter(e => e.kind !== 'meeting' && !+e.parent_id).map(enrich)
  return { meetings, orphans, counts: {
    meetings: meetings.length,
    decisions: all.filter(e => e.kind === 'decision').length,
    proposals: all.filter(e => e.kind === 'proposal').length
  } }
}

// ---------- پروژه‌ها، پیمانکاران، استعلام‌ها ----------
const PROJECT_STATUSES = ['proposed', 'approved', 'in_progress', 'done', 'canceled']
const PROJECT_STATUS_FA = { proposed: 'پیشنهادی', approved: 'تصویب‌شده', in_progress: 'در حال اجرا', done: 'تمام‌شده', canceled: 'متوقف' }
const listVendors = () => db.prepare(`SELECT * FROM vendors ORDER BY name`).all()
const vendorName = id => (id ? (db.prepare(`SELECT name FROM vendors WHERE id=?`).get(id) || {}).name || '' : '')
function projectQuotes(pid) {
  const rows = db.prepare(`SELECT q.*, v.name vname FROM quotes q LEFT JOIN vendors v ON v.id=q.vendor_id WHERE q.project_id=? ORDER BY q.amount ASC, q.id`).all(pid)
  const min = rows.reduce((m, q) => q.amount > 0 && (m === 0 || q.amount < m) ? q.amount : m, 0)
  return rows.map(q => ({ ...q, vendorLabel: q.vname || q.vendor_name || '—', isCheapest: q.amount > 0 && q.amount === min, attachments: listAttachments('quote', q.id) }))
}
function projectRow(p) {
  const dec = +p.decision_event_id ? db.prepare(`SELECT title, j_date FROM events WHERE id=?`).get(p.decision_event_id) : null
  const q = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(CASE WHEN selected=1 THEN amount ELSE 0 END), 0) sel FROM quotes WHERE project_id=?`).get(p.id)
  return { ...p, statusFa: PROJECT_STATUS_FA[p.status] || p.status, decisionTitle: dec ? dec.title : '', decisionDate: dec ? dec.j_date : '', quoteCount: q.c, selectedAmount: q.sel }
}
const projectsList = () => db.prepare(`SELECT * FROM projects ORDER BY id DESC`).all().map(projectRow)
function projectInvoices(pid) {
  return db.prepare(`SELECT ci.*, v.name vname FROM contractor_invoices ci LEFT JOIN vendors v ON v.id=ci.vendor_id WHERE ci.project_id=? ORDER BY ci.g_date DESC, ci.id DESC`).all(pid)
    .map(ci => ({ ...ci, kind: ci.kind || 'purchase', kindFa: ci.kind === 'sale' ? 'فروش' : 'خرید', vendorLabel: ci.vname || ci.vendor_name || '—', attachments: listAttachments('cinvoice', ci.id) }))
}
// هزینهٔ واقعی خالص پروژه = جمع خریدها − جمع فروش‌ها
function projectNetCost(pid) {
  const r = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='sale' THEN 0 ELSE amount END),0) buy,
    COALESCE(SUM(CASE WHEN kind='sale' THEN amount ELSE 0 END),0) sell,
    COALESCE(SUM(CASE WHEN kind!='sale' AND paid=1 THEN amount ELSE 0 END),0) buyPaid
    FROM contractor_invoices WHERE project_id=?`).get(pid)
  return { net: r.buy - r.sell, purchase: r.buy, sale: r.sell, paid: r.buyPaid, outstanding: r.buy - r.buyPaid }
}
// فاکتور شارژِ ساکنین برای یک پروژه (is_billing=1، لینک‌شده به پروژه)
const projectChargeInvoice = pid => db.prepare(`SELECT * FROM invoices WHERE project_id=? AND is_billing=1 ORDER BY id DESC LIMIT 1`).get(pid)
// خلاصهٔ مالیِ یک پروژه در یک نگاه (برآورد | هزینهٔ واقعی | وصول | بدهی طبق مصوبه | سهم نهایی هر واحد | مازاد/کسری)
function projectSummary(p) {
  const charge = projectChargeInvoice(p.id)
  const nc = projectNetCost(p.id)
  const finalBasis = (p.final_amount || 0) || nc.net
  const shares = charge ? db.prepare(`SELECT unit_id, share_amount FROM invoice_shares WHERE invoice_id=?`).all(charge.id) : []
  const n = shares.length || 1
  const collected = projectCollected(p.id)
  const debt = shares.reduce((a, s) => a + Math.max(0, s.share_amount - unitProjectPaid(s.unit_id, p.id)), 0)
  const obligation = charge ? charge.amount : (p.budget || 0)
  return {
    budget: p.budget || 0, obligation, netCost: nc.net, purchase: nc.purchase, sale: nc.sale, paidToContractor: nc.paid, contractorDue: nc.outstanding,
    collected, debt, perUnitBudget: charge ? Math.round(obligation / n) : (p.budget ? Math.round(p.budget / n) : 0),
    finalCost: finalBasis, perUnitFinal: finalBasis ? Math.round(finalBasis / n) : 0,
    fundBalance: collected - finalBasis, deviation: (finalBasis && p.budget) ? finalBasis - p.budget : 0,
    unitCount: shares.length, hasCharge: !!charge, reconciled: p.status === 'done' && !!charge
  }
}
// آمارِ هر صندوق: موجودی، جمعِ ورودی، جمعِ خروجی
function fundFlowBreakdown(fundId) {
  const r = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='in' AND ref_payment_id IS NOT NULL THEN amount END),0) residents,
      COALESCE(SUM(CASE WHEN type='in' AND ref_payment_id IS NULL THEN amount END),0) otherIn,
      COALESCE(SUM(CASE WHEN type='out' THEN amount END),0) expenses,
      COALESCE(SUM(CASE WHEN type='manager_settle' THEN amount END),0) managerSettle,
      COALESCE(SUM(CASE WHEN type='transfer_in' THEN amount END),0) transferIn,
      COALESCE(SUM(CASE WHEN type='transfer_out' THEN amount END),0) transferOut,
      COALESCE(SUM(CASE WHEN type='adjust_in' THEN amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN type='adjust_out' THEN amount ELSE 0 END),0) adjust
    FROM fund_txns WHERE fund_id=?`).get(fundId)
  // «دریافتی» و «مخارج» فقط پولِ واقعیِ ورودی/خروجی‌اند؛ انتقال بین صندوق‌ها و تعدیل جدا نمایش داده می‌شوند
  return { ...r, received: r.residents + r.otherIn, spent: r.expenses + r.managerSettle, transferNet: r.transferIn - r.transferOut }
}
function fundStats() {
  return listFunds().map(f => ({
    id: f.id, name: f.name, bucket: f.bucket, kindFa: f.kindFa, balance: f.balance, opening: f.opening_balance || 0,
    ...fundFlowBreakdown(f.id)
  }))
}
// پولی که یک واحد بابت یک پروژه پرداخت کرده =
//   آنچه به سهمِ شارژِ پروژه تخصیص خورده  +  مازادِ پرداخت‌های علامت‌خوردهٔ پروژه (روی سهم ننشسته = طلبِ پروژه)
// این هم برای پرداخت‌های ترکیبیِ قدیمی درست است و هم برای پرداختِ اختصاصیِ جدید (مازاد به‌صورت طلب می‌ماند، نه سرریز)
function unitProjectPaid(unitId, pid) {
  if (!pid) return 0
  const inv = projectChargeInvoice(pid); if (!inv) return 0
  const alloc = db.prepare(`SELECT COALESCE(SUM(a.amount),0) t FROM payment_allocations a
    JOIN invoice_shares s ON s.id=a.share_id WHERE s.invoice_id=? AND s.unit_id=?`).get(inv.id, unitId).t
  const emk = db.prepare(`SELECT COALESCE(SUM(amount),0) g FROM payments WHERE unit_id=? AND project_id=?`).get(unitId, pid).g
  const emkAlloc = db.prepare(`SELECT COALESCE(SUM(a.amount),0) t FROM payment_allocations a
    WHERE a.payment_id IN (SELECT id FROM payments WHERE unit_id=? AND project_id=?)`).get(unitId, pid).t
  return alloc + Math.max(0, emk - emkAlloc)
}
// کل وصولِ یک پروژه از ساکنین
function projectCollected(pid) {
  const inv = pid ? projectChargeInvoice(pid) : null; if (!inv) return 0
  return invoiceUnits(inv.id).reduce((a, u) => a + unitProjectPaid(u.id, pid), 0)
}
function projectChargeShares(inv) {
  if (!inv) return []
  const pid = inv.project_id
  return db.prepare(`SELECT s.*, u.number, u.resident_name FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY u.floor, CAST(u.number AS INTEGER), u.id`).all(inv.id)
    .map(s => { const paid = pid ? unitProjectPaid(s.unit_id, pid) : shareAllocated(s.id); return { unit_id: s.unit_id, number: s.number, resident_name: s.resident_name, share: s.share_amount, paid, remaining: s.share_amount - paid } })
}
// صدور یا ویرایش شارژ پروژه (وسط‌کار قابل افزایش) — بدهیِ واحدها بازمحاسبه می‌شود
function setProjectCharge(project, { method, includeVacant, amount, payer, chargeKind, d }, userId) {
  const amt = Math.round(amount)
  if (!(amt > 0)) return { error: 'مبلغ شارژ باید بزرگ‌تر از صفر باشد' }
  if (!METHODS.includes(method) || method === 'custom' || method === 'per_unit_charge') return { error: 'روش تقسیم نامعتبر است' }
  const py = payer === 'owner' ? 'owner' : 'tenant'
  const ck = chargeKind === 'current' ? 'current' : 'operational'
  db.prepare(`UPDATE projects SET charge_kind=? WHERE id=?`).run(ck, project.id)
  const inv = projectChargeInvoice(project.id)
  if (inv) {
    // ویرایش: روی همهٔ واحدهای فعال + واحدهای قبلاً شارژ‌شده بازمحاسبه شود (واحدِ جاافتاده دوباره اضافه می‌شود)
    const units = projectChargeUnits(inv)
    if (!units.length) return { error: 'شارژ این پروژه واحدی ندارد' }
    const shares = computeShares(units, method, amt, {})
    db.prepare(`UPDATE invoices SET amount=?,method=?,payer=?,g_date=?,j_date=? WHERE id=?`).run(amt, method, py, d.g_date, d.j_date, inv.id)
    writeShares(inv.id, shares)
    return { ok: true, invoiceId: inv.id, amount: amt, updated: true }
  }
  const units = eligibleUnits(!!includeVacant)
  if (!units.length) return { error: 'هیچ واحد مشمولی وجود ندارد' }
  const shares = computeShares(units, method, amt, {})
  const id = Number(db.prepare(`INSERT INTO invoices(title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,vendor,note,doc_file,status,is_charge,is_billing,project_id,payer,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'open',0,1,?,?,?,?)`)
    .run(`شارژ پروژه: ${project.title}`, 0, amt, d.g_date, d.j_date, method, includeVacant ? 1 : 0, 0, 0, 'variable', '', '', '', project.id, py, userId, nowISO()).lastInsertRowid)
  writeShares(id, shares)
  return { ok: true, invoiceId: id, amount: amt }
}
// واحدهایی که هم‌اکنون در یک فاکتور سهم دارند (مجموعهٔ ثابتِ همان فاکتور)
const invoiceUnits = invId => db.prepare(`SELECT u.* FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=?`).all(invId)
// مجموعهٔ واحدهای یک شارژ پروژه هنگام ویرایش/تعدیل: همهٔ واحدهای فعال (تگ «خالی» در پروژه‌ها بی‌اثر است)
// به‌علاوهٔ هر واحدی که از قبل در فاکتور سهم دارد (حتی اگر غیرفعال شده) تا هیچ بدهکار/پرداخت‌کننده‌ای حذف نشود.
// این کار واحدهایی را که در نسخه‌های قدیمی اشتباهاً حذف شده بودند دوباره به پروژه اضافه می‌کند.
function projectChargeUnits(inv) {
  const active = eligibleUnits()
  const seen = new Set(active.map(u => u.id))
  const extra = invoiceUnits(inv.id).filter(u => !seen.has(u.id))
  return [...active, ...extra]
}
// اتمام و ثبت کامل هزینه‌ها: شارژِ ساکنین روی هزینهٔ واقعیِ نهایی تنظیم و سهم هر واحد بازمحاسبه می‌شود
// مبنا: مبلغ نهاییِ دستی (اگر وارد شده) وگرنه هزینهٔ خالصِ فاکتورهای پروژه (خرید − فروش)
// مهم: روی همهٔ واحدهای فعال (+ واحدهای قبلاً شارژ‌شده) بازمحاسبه می‌شود؛ هیچ واحدی حذف نمی‌شود و واحدِ جاافتاده دوباره اضافه می‌گردد
// بدهیِ ساکنین بر مبنای «مصوبه (برآورد اولیه)» می‌ماند، نه هزینهٔ نهایی.
// هزینهٔ نهاییِ واقعی جداگانه برای ستونِ «طلب/بدهی طبق مخارج» و مازادِ صندوق است.
function reconcileProjectCharge(project) {
  const inv = projectChargeInvoice(project.id)
  if (!inv) return { error: 'اول شارژ پروژه را صادر کنید' }
  const basis = Math.round(project.budget || 0) || inv.amount
  if (!(basis > 0)) return { error: 'ابتدا «برآورد اولیه (مصوبه)» پروژه را وارد کنید' }
  const units = projectChargeUnits(inv)
  if (!units.length) return { error: 'شارژ این پروژه واحدی ندارد' }
  const shares = computeShares(units, inv.method, basis, {})
  db.prepare(`UPDATE invoices SET amount=? WHERE id=?`).run(basis, inv.id)
  writeShares(inv.id, shares)
  db.prepare(`UPDATE projects SET status='done' WHERE id=?`).run(project.id)
  return { ok: true, amount: basis, finalCost: projectNetCost(project.id).net }
}
function projectDetail(id) {
  const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(id)
  if (!p) return null
  const invoices = projectInvoices(id)
  const charge = projectChargeInvoice(id)
  const chargeCollected = charge ? projectCollected(id) : 0  // وصولِ ناخالصِ علامت‌خوردهٔ پروژه
  const nc = projectNetCost(id)
  const finalBasis = (p.final_amount || 0) || nc.net
  const reconciled = p.status === 'done' && !!charge
  const chargedU = charge ? invoiceUnits(charge.id) : []
  const n = chargedU.length || 1
  // سهم برآوردی و نهاییِ هر واحد (روی همان واحدهای شارژشده)
  const bMap = charge && p.budget ? Object.fromEntries(computeShares(chargedU, charge.method, p.budget, {}).map(s => [s.unit_id, s.share_amount])) : {}
  const fMap = charge && finalBasis ? Object.fromEntries(computeShares(chargedU, charge.method, finalBasis, {}).map(s => [s.unit_id, s.share_amount])) : {}
  const chargeShares = projectChargeShares(charge).map((s, i) => {
    const budgetShare = bMap[s.unit_id] || 0, finalShare = fMap[s.unit_id] || 0
    return { ...s, row: i + 1, budgetShare, finalShare, balByBudget: budgetShare - s.paid, balByFinal: finalShare - s.paid }
  })
  // بدهیِ اصلیِ ساکنین طبق مصوبه (آنچه باید بدهند)؛ طلب/بستانکاری نسبت به مخارجِ واقعی جداست
  const residentDebt = chargeShares.reduce((a, s) => a + Math.max(0, s.balByBudget), 0)
  const residentCreditBudget = chargeShares.reduce((a, s) => a + Math.max(0, -s.balByBudget), 0)
  const residentCredit = chargeShares.reduce((a, s) => a + Math.max(0, -s.balByFinal), 0)
  return {
    project: projectRow(p), quotes: projectQuotes(id), invoices, attachments: listAttachments('project', id),
    invoiceTotal: nc.net, purchaseTotal: nc.purchase, saleTotal: nc.sale, invoicePaid: nc.paid,
    finalAmount: p.final_amount || 0, netCost: nc.net, finalBasis, reconciled,
    deviation: finalBasis && p.budget ? (finalBasis - p.budget) : 0,
    charge: charge ? { id: charge.id, amount: charge.amount, method: charge.method, methodFa: METHOD_FA[charge.method] || charge.method, payer: charge.payer, includeVacant: charge.include_vacant, collected: chargeCollected, remaining: finalBasis - chargeCollected } : null,
    chargeShares,
    // دادهٔ کارت‌ها
    box: {
      estimate: { total: p.budget || 0, perUnit: p.budget ? Math.round(p.budget / n) : 0 },
      collection: { collected: chargeCollected, debt: residentDebt, credit: residentCredit },
      expenses: { total: nc.purchase, paid: nc.paid, outstanding: nc.outstanding, sale: nc.sale },
      final: { total: finalBasis, deviation: finalBasis && p.budget ? finalBasis - p.budget : 0, perUnit: finalBasis ? Math.round(finalBasis / n) : 0 },
      fund: { collected: chargeCollected, finalCost: finalBasis, balance: chargeCollected - finalBasis }
    }
  }
}
// گزارش‌ها: خرجِ هر پروژه و هر پیمانکار (فقط بایگانی — روی صندوق اثری ندارد)
function projectsReport() {
  return projectsList().map(p => {
    const i = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t, COALESCE(SUM(CASE WHEN paid=1 THEN amount ELSE 0 END),0) paid FROM contractor_invoices WHERE project_id=?`).get(p.id)
    return { ...p, invoiceCount: i.c, invoiceTotal: i.t, invoicePaid: i.paid, invoiceUnpaid: i.t - i.paid }
  })
}
function vendorsReport() {
  return listVendors().map(v => {
    const q = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM quotes WHERE vendor_id=?`).get(v.id)
    const i = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t, COALESCE(SUM(CASE WHEN paid=1 THEN amount ELSE 0 END),0) paid FROM contractor_invoices WHERE vendor_id=?`).get(v.id)
    return { id: v.id, name: v.name, field: v.field, phone: v.phone, quoteCount: q.c, quoteTotal: q.t, invoiceCount: i.c, invoiceTotal: i.t, invoicePaid: i.paid, invoiceUnpaid: i.t - i.paid }
  })
}
// گزارش حرفه‌ای هزینه‌کرد — سه حالت: بازه‌ی تاریخ | پروژه | انتخاب فاکتورها
const gToJStr = g => { if (!g) return ''; const [y, m, d] = g.split('-').map(Number); const j = toJalaali(y, m, d); return jStr(j.jy, j.jm, j.jd) }
function expensesReport(opts) {
  let invRows = [], project = null, contractor = null, scopeLabel = '', projInvoices = null, projPid = 0, projBudgetMap = null, projFinalMap = null
  if (opts.mode === 'project' && +opts.projectId) {
    const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(+opts.projectId)
    if (!p) return { error: 'پروژه یافت نشد' }
    const nc = projectNetCost(p.id)
    contractor = { total: nc.purchase, paid: nc.paid, outstanding: nc.outstanding, sale: nc.sale }
    const finalBasis = p.final_amount || nc.net
    project = { title: p.title, budget: p.budget, finalAmount: finalBasis, deviation: finalBasis && p.budget ? (finalBasis - p.budget) : 0 }
    scopeLabel = 'پروژه: ' + p.title
    // ریز فاکتورها در حالت پروژه = فاکتورهای خرید/فروش پیمانکار (هزینه‌های واقعی)
    const ciRows = db.prepare(`SELECT * FROM contractor_invoices WHERE project_id=? ORDER BY id`).all(p.id)
    projInvoices = ciRows.map(c => ({
      id: c.id, title: c.title || (c.kind === 'sale' ? 'فروش' : 'خرید'),
      category: c.vendor_name || (c.kind === 'sale' ? 'فروش/داغی' : 'پیمانکار'),
      j_date: c.j_date, methodFa: c.note ? c.note : (c.kind === 'sale' ? 'درآمد' : 'هزینه'),
      amount: c.amount, collected: c.paid ? c.amount : 0, remaining: c.paid ? 0 : c.amount, isSale: c.kind === 'sale'
    }))
    // تفکیک هر واحد از فاکتور شارژ ساکنین
    const chargeInv = projectChargeInvoice(p.id)
    invRows = chargeInv ? [chargeInv] : []
    projPid = p.id
    // نگاشتِ سهمِ برآوردی (مصوبه) و سهمِ نهایی (هزینهٔ واقعیِ خالص) برای هر واحد — دو ستونِ متفاوت
    if (chargeInv) {
      const cu = invoiceUnits(chargeInv.id)
      projBudgetMap = p.budget ? Object.fromEntries(computeShares(cu, chargeInv.method, p.budget, {}).map(s => [s.unit_id, s.share_amount])) : {}
      projFinalMap = finalBasis ? Object.fromEntries(computeShares(cu, chargeInv.method, finalBasis, {}).map(s => [s.unit_id, s.share_amount])) : {}
    } else { projBudgetMap = {}; projFinalMap = {} }
  } else if (opts.mode === 'invoices' && opts.ids) {
    const ids = String(opts.ids).split(',').map(Number).filter(Boolean)
    invRows = ids.length ? db.prepare(`SELECT * FROM invoices WHERE id IN (${ids.map(() => '?').join(',')}) AND is_opening=0`).all(...ids) : []
    scopeLabel = `${ids.length} فاکتور انتخابی`
  } else {
    const from = opts.from || periodFirstG(curPeriod()), to = opts.to || todayG()
    invRows = db.prepare(`SELECT * FROM invoices WHERE is_opening=0 AND g_date>=? AND g_date<=? ORDER BY g_date, id`).all(from, to)
    scopeLabel = `بازه‌ی ${gToJStr(from)} تا ${gToJStr(to)}`
  }
  const invoices = projInvoices || invRows.map(inv => {
    const collected = invoiceCollected(inv.id)
    const cat = inv.category_id ? ((db.prepare(`SELECT name FROM expense_categories WHERE id=?`).get(inv.category_id) || {}).name || '') : ''
    return { id: inv.id, title: inv.title, category: cat || '—', j_date: inv.j_date, methodFa: METHOD_FA[inv.method] || inv.method, amount: inv.amount, collected, remaining: inv.amount - collected, isBilling: !!inv.is_billing }
  })
  // در حالت پروژه جمعِ ریز فاکتورها = خالص (خرید − فروش)
  const totals = projInvoices
    ? { amount: invoices.reduce((s, i) => s + (i.isSale ? -i.amount : i.amount), 0), collected: invoices.reduce((s, i) => s + (i.isSale ? -i.collected : i.collected), 0), remaining: invoices.reduce((s, i) => s + (i.isSale ? -i.remaining : i.remaining), 0) }
    : { amount: invoices.reduce((s, i) => s + i.amount, 0), collected: invoices.reduce((s, i) => s + i.collected, 0), remaining: invoices.reduce((s, i) => s + i.remaining, 0) }
  const um = {}
  for (const inv of invRows)
    for (const s of db.prepare(`SELECT s.*, u.number, u.resident_name FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=?`).all(inv.id)) {
      const e = um[s.unit_id] || (um[s.unit_id] = { unit_id: s.unit_id, number: s.number, resident_name: s.resident_name, share: 0, paid: 0 })
      e.share += s.share_amount; e.paid += projPid ? unitProjectPaid(s.unit_id, projPid) : shareAllocated(s.id)
    }
  const numOf = s => parseInt(String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0
  const units = Object.values(um).map(e => {
    if (projPid) {
      // دو ستونِ متفاوت: «سهم برآوردی (مصوبه)» و «سهم نهایی (هزینهٔ واقعی)»
      const budgetShare = projBudgetMap[e.unit_id] || 0
      const finalShare = projFinalMap[e.unit_id] || 0
      return { ...e, share: finalShare, budgetShare, balance: finalShare - e.paid, balBudget: budgetShare - e.paid, balExpense: finalShare - e.paid }
    }
    return { ...e, balance: e.share - e.paid, budgetShare: 0, balBudget: e.share - e.paid, balExpense: e.share - e.paid }
  }).sort((a, b) => numOf(a.number) - numOf(b.number))
  return {
    scopeLabel, invoices, totals, units, project, contractor, isProject: !!projPid,
    residentCollected: projInvoices ? units.reduce((s, u) => s + u.paid, 0) : totals.collected,
    // در حالت پروژه: بدهیِ اصلی طبق مصوبه، و «مازاد» = طلب نسبت به هزینهٔ واقعی
    unitDebt: units.reduce((s, u) => s + Math.max(0, projPid ? u.balBudget : u.balance), 0),
    unitCredit: units.reduce((s, u) => s + Math.max(0, -u.balance), 0),
    buildingName: getSetting('buildingName'), today: (() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })()
  }
}

// ---------- صفحات چاپی (تولید PDF) ----------
const hEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const isTomanDisp = () => getSetting('displayUnit', 'toman') !== 'rial'
const pUnitFa = () => isTomanDisp() ? 'تومان' : 'ریال'
const pSep = n => faNum(String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'))
const pMoney = r => pSep(isTomanDisp() ? (r || 0) / 10 : (r || 0))
const printLayout = (title, inner) => `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${hEsc(title)}</title>
<style>
@page{size:A4;margin:13mm}
*{box-sizing:border-box}
body{font-family:Tahoma,'IRANSans','Vazirmatn',system-ui,sans-serif;color:#1a2230;margin:0;font-size:12.5px;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.stmt{max-width:182mm;margin:0 auto}
h1{font-size:19px;margin:0 0 2px;color:#0f2847}
.sub{color:#5b6472;font-size:11.5px;margin:0 0 10px}
.big{font-size:17px;font-weight:800;border:1.5px solid #1d5fa8;border-radius:10px;padding:11px 14px;margin:10px 0;background:#eef4fc}
h3{font-size:13.5px;margin:14px 0 4px}
/* جدول‌ها: استاندارد حسابداری — سرستونِ پررنگ، ردیف‌های یک‌درمیان، ترازِ عددی، جمعِ متمایز */
table{width:100%;border-collapse:collapse;margin:8px 0;border:1px solid #c3cedd;border-radius:8px;overflow:hidden}
th,td{border:1px solid #dbe3ee;padding:7px 9px;text-align:right;font-size:11.5px;vertical-align:middle}
thead th{background:#1d5fa8;color:#fff;font-weight:700;font-size:11.5px;border-color:#1a558f;white-space:nowrap}
tbody tr:nth-child(even){background:#f4f7fb}
tbody tr:nth-child(odd){background:#fff}
tbody tr:hover{background:#eaf1fa}
.num{font-variant-numeric:tabular-nums;text-align:left;direction:ltr;white-space:nowrap}
th.num{text-align:left}
tr.tot td,tr.tot th{font-weight:800;background:#e8eef7;border-top:2px solid #1d5fa8;color:#0f2847}
.amt-out{color:#c0392b}.amt-in{color:#0f8a56}
.foot{margin-top:16px;border-top:1px solid #cbd5e1;padding-top:8px;color:#7a828f;font-size:10.5px;text-align:center}
.sign{display:flex;justify-content:space-between;margin-top:22px;font-size:12px;color:#333}
.kpis{display:flex;flex-wrap:wrap;gap:9px;margin:10px 0}
.kpi{flex:1 1 130px;border:1px solid #d3dce8;border-radius:10px;padding:9px 12px;background:#fbfcfe;box-shadow:0 1px 2px rgba(16,40,71,.05)}
.kpi .k{font-size:10.5px;color:#5b6472}
.kpi .v{font-size:16px;font-weight:800;margin-top:3px;color:#0f2847;direction:ltr;text-align:right}
.kpi .v.ok{color:#0f8a56}.kpi .v.warn{color:#c0392b}
.kpi .s{font-size:9.5px;color:#8a919d;margin-top:1px}
.sech{font-size:13.5px;margin:16px 0 5px;font-weight:800;color:#0f2847;border-right:4px solid #1d5fa8;padding:2px 9px 2px 0;background:#f4f7fb;border-radius:0 6px 6px 0}
.ok{color:#0f8a56}.warn{color:#c0392b}
tr,td,th,.kpi{break-inside:avoid}
thead{display:table-header-group}
</style></head><body><div class="stmt">${inner}</div></body></html>`

// عدد به حروفِ فارسی (برای رسید)
function numToFaWords(n) {
  n = Math.floor(Math.abs(+n || 0)); if (n === 0) return 'صفر'
  const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه']
  const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده']
  const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود']
  const hund = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد']
  const big = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد']
  const three = x => { const p = []; const h = Math.floor(x / 100), r = x % 100
    if (h) p.push(hund[h]); if (r >= 10 && r < 20) p.push(teens[r - 10]); else { if (Math.floor(r / 10)) p.push(tens[Math.floor(r / 10)]); if (r % 10) p.push(ones[r % 10]) }
    return p.join(' و ') }
  const parts = []; let i = 0
  while (n > 0 && i < big.length) { const c = n % 1000; if (c) parts.unshift(three(c) + (big[i] ? ' ' + big[i] : '')); n = Math.floor(n / 1000); i++ }
  return parts.join(' و ')
}
// رسیدِ پرداختِ ساکن
function printPaymentHtml(id) {
  const p = db.prepare(`SELECT p.*, u.number, u.resident_name, u.owner_name, f.name fund_name FROM payments p LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN funds f ON f.id=p.fund_id WHERE p.id=?`).get(id)
  if (!p) return null
  const allocs = db.prepare(`SELECT SUM(a.amount) amount, i.id inv_id, i.title, i.j_date FROM payment_allocations a JOIN invoice_shares s ON s.id=a.share_id JOIN invoices i ON i.id=s.invoice_id WHERE a.payment_id=? GROUP BY i.id ORDER BY i.g_date, i.id`).all(id)
  const used = allocs.reduce((a, x) => a + x.amount, 0), credit = p.amount - used
  const debtAfter = unitDebt(p.unit_id)
  const U = pUnitFa(), amtDisp = isTomanDisp() ? Math.round(p.amount / 10) : p.amount
  const inner = `
    <h1>${hEsc(getSetting('buildingName') || 'ساختمان')}</h1>
    <div class="sub">رسیدِ دریافت وجه · شمارهٔ رسید: <b>${faNum(p.id)}</b> · تاریخ: ${faNum(p.j_date)}</div>
    <div class="big">مبلغ ${pMoney(p.amount)} ${U}<div style="font-size:13px;font-weight:600;margin-top:4px">(به حروف: ${numToFaWords(amtDisp)} ${U})</div></div>
    <table><tbody>
      <tr><th style="width:30%">از</th><td>واحد ${faNum(p.number)}${p.resident_name ? ' — ' + hEsc(p.resident_name) : ''}</td></tr>
      <tr><th>واریز به</th><td>${hEsc(p.fund_name || '—')}${p.method ? ' · روش: ' + hEsc(p.method) : ''}</td></tr>
      ${p.note ? `<tr><th>توضیح</th><td>${hEsc(p.note)}</td></tr>` : ''}
    </tbody></table>
    <div class="sech">بابتِ این بدهی‌ها تسویه شد</div>
    <table><thead><tr><th>سند</th><th>شرح</th><th>تاریخ</th><th>مبلغ</th></tr></thead><tbody>
      ${allocs.length ? allocs.map(a => `<tr><td class="num">${faNum(a.inv_id)}</td><td>${hEsc(a.title)}</td><td class="num">${faNum(a.j_date)}</td><td class="num">${pMoney(a.amount)}</td></tr>`).join('') : '<tr><td colspan="4">— به‌صورت پیش‌پرداخت (علی‌الحساب) ثبت شد —</td></tr>'}
      ${credit > 0 ? `<tr><td></td><td>پیش‌پرداخت (برای بدهی‌های بعدی)</td><td></td><td class="num">${pMoney(credit)}</td></tr>` : ''}
      <tr class="tot"><td colspan="3">جمع</td><td class="num">${pMoney(p.amount)}</td></tr>
    </tbody></table>
    <div class="big" style="font-size:14px;border-width:1px">${debtAfter > 0 ? `ماندهٔ بدهیِ فعلیِ واحد (تا امروز): <b>${pMoney(debtAfter)} ${U}</b>` : debtAfter < 0 ? `پیش‌پرداختِ فعلیِ واحد: <b>${pMoney(-debtAfter)} ${U}</b>` : 'حسابِ واحد تا امروز تسویه است.'}</div>
    <div class="sign"><span>امضای دریافت‌کننده (مدیر ساختمان):</span><span>امضای پرداخت‌کننده:</span></div>
    <div class="foot">صادرشده از «حسابدار ساختمان»</div>`
  return printLayout(`رسید ${p.id} — واحد ${p.number}`, inner)
}
function printUnitHtml(c) {
  const u = c.unit, open = c.shares.filter(s => s.remaining > 0)
  const debtLine = c.debt > 0
    ? `بدهی فعلی: <span class="amt-out">${pMoney(c.debt)} ${pUnitFa()}</span>${c.aging ? ` · قدمت: ${c.aging.days > 9000 ? 'انتقالی' : faNum(c.aging.days) + ' روز'}` : ''}`
    : c.debt < 0 ? `بستانکاری: <span class="amt-in">${pMoney(-c.debt)} ${pUnitFa()}</span>` : 'تسویه‌ی کامل — بدهی ندارید'
  const inner = `
    <h1>${hEsc(c.buildingName || 'ساختمان')}</h1>
    <div class="sub">صورت‌حساب واحد ${faNum(u.number)}${u.resident_name ? ' — ' + hEsc(u.resident_name) : ''} · تاریخ صدور: ${faNum(c.today)}</div>
    <div class="big">${debtLine}</div>
    <h3>ریز بدهکاری‌ها</h3>
    <table><thead><tr><th>شماره سند</th><th>شرح</th><th>دسته</th><th>تاریخ</th><th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
    ${open.length ? open.map(s => `<tr><td class="num">${faNum(s.invoice_id)}</td><td>${hEsc(s.title)}</td><td>${hEsc(s.category || '—')}</td><td class="num">${s.is_opening ? 'انتقالی' : faNum(s.j_date)}</td>
      <td class="num">${pMoney(s.share_amount)}</td><td class="num">${pMoney(s.paid)}</td><td class="num amt-out">${pMoney(s.remaining)}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:#888">بدهیِ بازی ندارید</td></tr>'}
    </tbody></table>
    <h3>دریافتی‌های ثبت‌شده‌ی شما</h3>
    <table><thead><tr><th>تاریخ</th><th>مبلغ</th><th>صندوق</th><th>توضیح</th></tr></thead><tbody>
    ${c.payments.length ? c.payments.map(p => `<tr><td class="num">${p.is_opening ? 'انتقالی' : faNum(p.j_date)}</td><td class="num amt-in">${pMoney(p.amount)}</td>
      <td>${hEsc(p.fund_name || '—')}</td><td>${hEsc(p.note || '')}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#888">پرداختی ثبت نشده</td></tr>'}
    </tbody></table>
    <table><tbody><tr class="tot"><td>جمع سهم‌ها</td><td class="num">${pMoney(c.totalShares)} ${pUnitFa()}</td>
      <td>جمع پرداختی</td><td class="num">${pMoney(c.totalPaid)} ${pUnitFa()}</td></tr></tbody></table>
    <div class="sub" style="margin-top:8px">شارژ ماهانه‌ی این واحد: <b>${pMoney(u.chargeAmount)} ${pUnitFa()}</b></div>
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout(`صورت‌حساب واحد ${u.number}`, inner)
}

// آخرین روز میلادیِ یک دوره‌ی جلالی (برای بازه‌ی گزارش)
function periodLastG(p) {
  const nextFirst = periodFirstG(shiftPeriod(p, 1))
  const d = new Date(nextFirst + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function printSummaryHtml(period, showNames) {
  const p = period || curPeriod()
  const from = periodFirstG(p), to = periodLastG(p)
  const mr = managerReport(from, to)
  const dr = debtorsReport()
  const bc = ledgerHealth()
  const fundTotal = mr.fundFlow.reduce((s, f) => s + f.close, 0)
  const U = pUnitFa()
  const kpi = (k, v, s, cls) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`
  const inner = `
    <h1>${hEsc(mr.buildingName || 'ساختمان')}</h1>
    <div class="sub">خلاصه‌ی ماهانه برای هیئت‌مدیره · دوره‌ی ${faNum(periodFa(p))} · تاریخ صدور: ${faNum((() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })())}${mr.managerName ? ' · مدیر: ' + hEsc(mr.managerName) : ''}</div>
    <div class="kpis">
      ${kpi('موجودی کل صندوق‌ها', pMoney(fundTotal) + ' ' + U, '', fundTotal >= 0 ? 'ok' : 'warn')}
      ${kpi('دریافتی این ماه', pMoney(mr.cash.income) + ' ' + U, 'نقدی')}
      ${kpi('هزینهٔ پرداخت‌شدهٔ این ماه', pMoney(mr.cash.expense) + ' ' + U, 'نقدی')}
      ${kpi('خالص نقدی ماه', (mr.cash.net < 0 ? '−' : '') + pMoney(Math.abs(mr.cash.net)) + ' ' + U, 'دریافتی منهای هزینهٔ پرداخت‌شده', mr.cash.net < 0 ? 'warn' : '')}
      ${kpi('بدهی کل ساکنین', pMoney(dr.total) + ' ' + U, faNum(dr.rows.length) + ' واحد بدهکار', dr.total > 0 ? 'warn' : 'ok')}
      ${kpi('طلب مدیر از صندوق', pMoney(mr.managerDebt) + ' ' + U, mr.managerDebt > 0 ? 'باید تسویه شود' : 'تسویه است', mr.managerDebt > 0 ? 'warn' : 'ok')}
    </div>
    <div class="sech">گردش صندوق‌ها</div>
    <table><thead><tr><th>صندوق</th><th>مانده‌ی ابتدای دوره</th><th>ورودی</th><th>خروجی</th><th>انتقال (±)</th><th>مانده‌ی پایان دوره</th></tr></thead><tbody>
    ${mr.fundFlow.map(f => `<tr><td>${hEsc(f.name)}</td><td class="num">${pMoney(f.open)}</td><td class="num">${pMoney(f.in)}</td>
      <td class="num">${pMoney(f.out)}</td><td class="num">${f.transfer ? (f.transfer < 0 ? '−' : '+') + pMoney(Math.abs(f.transfer)) : '—'}</td><td class="num"><b>${pMoney(f.close)}</b></td></tr>`).join('')}
    <tr class="tot"><td>جمع</td><td class="num">${pMoney(mr.fundFlow.reduce((s, f) => s + f.open, 0))}</td>
      <td class="num">${pMoney(mr.fundFlow.reduce((s, f) => s + f.in, 0))}</td><td class="num">${pMoney(mr.fundFlow.reduce((s, f) => s + f.out, 0))}</td>
      <td class="num">—</td><td class="num">${pMoney(fundTotal)}</td></tr>
    </tbody></table>
    <div class="sech">درآمد و هزینه (نقدی)</div>
    <table><thead><tr><th>گروه</th><th>شرح</th><th>مبلغ</th></tr></thead><tbody>
    ${mr.cash.lines.length ? ['in', 'out'].map(sd => mr.cash.lines.filter(l => l.side === sd).map(l => `<tr><td>${sd === 'in' ? 'درآمد' : 'هزینه'} · ${hEsc(l.group)}</td><td>${hEsc(l.label)}</td><td class="num">${pMoney(l.total)} ${U}</td></tr>`).join('')
      + `<tr class="tot"><td colspan="2">جمع ${sd === 'in' ? 'درآمد' : 'هزینه'}</td><td class="num">${pMoney(sd === 'in' ? mr.cash.income : mr.cash.expense)} ${U}</td></tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#888">گردشی در این دوره نبوده</td></tr>'}
    </tbody></table>
    <div class="sech">وضعیت بدهکاران (بر اساس قدمت)</div>
    <table><thead><tr><th>۰-۳۰ روز</th><th>۳۱-۶۰ روز</th><th>۶۱-۹۰ روز</th><th>بیش از ۹۰ روز</th><th>جمع کل</th></tr></thead><tbody>
    <tr><td class="num">${pMoney(dr.buckets['۰-۳۰'])}</td><td class="num">${pMoney(dr.buckets['۳۱-۶۰'])}</td>
      <td class="num">${pMoney(dr.buckets['۶۱-۹۰'])}</td><td class="num amt-out">${pMoney(dr.buckets['+۹۰'])}</td>
      <td class="num tot"><b>${pMoney(dr.total)} ${U}</b></td></tr>
    </tbody></table>
    ${showNames && dr.rows.length ? `<table style="margin-top:6px"><thead><tr><th>واحد</th><th>ساکن</th><th>بدهی</th><th>قدمت</th></tr></thead><tbody>
      ${dr.rows.map(r => `<tr><td class="num">${faNum(r.number)}</td><td>${hEsc(r.resident_name || '—')}</td>
        <td class="num amt-out">${pMoney(r.debt)} ${U}</td><td class="num">${r.aging ? (r.aging.days > 9000 ? 'انتقالی' : faNum(r.aging.days) + ' روز') : '—'}</td></tr>`).join('')}
      </tbody></table>`
    : dr.rows.length ? `<div class="s" style="color:#777;margin-top:4px">نام بدهکاران برای حفظ حریم خصوصی در این گزارش نمایش داده نشده است.</div>` : ''}
    <div class="sech">صحت دفاتر</div>
    <div class="big" style="font-size:14px">${bc.ok
      ? 'کنترل سلامت دفاتر: همهٔ آزمون‌ها سالم است.'
      : 'کنترل سلامت دفاتر ایراد پیدا کرده — گزارش «کنترل سلامت دفاتر» را در نرم‌افزار بررسی کنید.'}</div>
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout(`خلاصه‌ی ماهانه — ${periodFa(p)}`, inner)
}

// صورت‌ریز تقسیم یک فاکتور (به‌ویژه روش نفرات+مشاعات) برای ارائه به مدیر
function printInvoiceHtml(id) {
  const inv = db.prepare(`SELECT i.*, c.name category FROM invoices i LEFT JOIN expense_categories c ON c.id=i.category_id WHERE i.id=?`).get(id)
  if (!inv) return null
  const combined = inv.method === 'occ_common'
  const shares = db.prepare(`SELECT s.*, u.number, u.resident_name, u.occupants, u.common_units, u.occupied FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY u.floor, CAST(u.number AS INTEGER), u.id`).all(id)
    .map(s => { const oc = s.occupied ? (+s.occupants || 0) : 0, cm = +s.common_units || 0, w = oc + cm; const occShare = w > 0 ? Math.round(s.share_amount * oc / w) : 0; return { ...s, oc, cm, occShare, comShare: s.share_amount - occShare } })
  const U = pUnitFa()
  const head = combined ? `<th>واحد</th><th>ساکن</th><th>نفرات</th><th>مشاعات</th><th>سهم نفرات</th><th>سهم مشاعات</th><th>سهم کل</th>`
    : `<th>واحد</th><th>ساکن</th><th>سهم</th>`
  const rows = shares.map(s => combined
    ? `<tr><td class="num">${faNum(s.number)}</td><td>${hEsc(s.resident_name || '—')}</td><td class="num">${faNum(s.oc)}</td><td class="num">${faNum(s.cm)}</td><td class="num">${pMoney(s.occShare)}</td><td class="num">${pMoney(s.comShare)}</td><td class="num"><b>${pMoney(s.share_amount)}</b></td></tr>`
    : `<tr><td class="num">${faNum(s.number)}</td><td>${hEsc(s.resident_name || '—')}</td><td class="num">${pMoney(s.share_amount)}</td></tr>`).join('')
  const totOcc = shares.reduce((a, s) => a + s.occShare, 0), totCom = shares.reduce((a, s) => a + s.comShare, 0)
  const inner = `
    <h1>${hEsc(getSetting('buildingName') || 'ساختمان')}</h1>
    <div class="sub">صورت‌ریز تقسیم فاکتور: ${hEsc(inv.title)}${inv.category ? ' — ' + hEsc(inv.category) : ''} · شمارهٔ سند: ${faNum(inv.id)} · تاریخ: ${faNum(inv.j_date)} · روش: ${METHOD_FA[inv.method] || inv.method}${inv.doc_no ? ' · سند فیزیکی: ' + faNum(inv.doc_no) : ''}</div>
    <div class="big">مبلغ کل فاکتور: ${pMoney(inv.amount)} ${U}${combined ? ` · جمع سهمِ نفرات: ${pMoney(totOcc)} · جمع سهمِ مشاعات: ${pMoney(totCom)}` : ''}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${rows}
      <tr class="tot">${combined ? `<td colspan="4">جمع</td><td class="num">${pMoney(totOcc)}</td><td class="num">${pMoney(totCom)}</td><td class="num">${pMoney(inv.amount)}</td>` : `<td colspan="2">جمع</td><td class="num">${pMoney(inv.amount)}</td>`}</tr>
    </tbody></table>
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout('صورت‌ریز فاکتور — ' + inv.title, inner)
}

// گزارشِ چاپیِ فاکتوری با ریزِ سهم و بدهیِ هر واحد برای هر فاکتور (برای ارائه به اهالی/هیئت‌مدیره)
const METHOD_EXPLAIN = {
  equal: 'مساوی بین واحدها', area: 'به نسبت متراژ', occupants: 'به نسبت نفرات',
  occ_common: 'نفرات + ۱ سهم مشاعات (سرانه)', per_unit_charge: 'به نسبت شارژ ماهانه', custom: 'دستی'
}
function printInvoicesReportHtml(fundId, status, jFrom, jTo) {
  const U = pUnitFa()
  const kpi = (k, v, s, cls) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`
  const norm = s => String(s || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/-/g, '/').trim()
  const nf = norm(jFrom), nt = norm(jTo)
  let invs = listInvoices(fundId ? { fund_id: fundId } : {})
  const isSettled = i => i.payable ? (i.fundUnpaid <= 0) : (i.remaining <= 0)
  if (status === 'settled') invs = invs.filter(isSettled)
  else if (status === 'open') invs = invs.filter(i => !isSettled(i))
  if (nf) invs = invs.filter(i => norm(i.j_date) >= nf)
  if (nt) invs = invs.filter(i => norm(i.j_date) <= nt)
  const amountSum = invs.reduce((a, i) => a + i.amount, 0)
  const fundPaidSum = invs.reduce((a, i) => a + (i.payable ? i.fundPaid : 0), 0)
  const fundUnpaidSum = invs.reduce((a, i) => a + (i.payable ? i.fundUnpaid : 0), 0)
  const resDue = invs.reduce((a, i) => a + ((i.shareCount > 0 && !i.from_fund) ? Math.max(0, i.remaining) : 0), 0)
  const fund = fundId ? db.prepare(`SELECT name FROM funds WHERE id=?`).get(fundId) : null
  const today = (() => { const t = todayJ(); return jStr(t.jy, t.jm, t.jd) })()
  const statusFa = status === 'settled' ? 'تسویه‌شده' : status === 'open' ? 'تسویه‌نشده' : 'همه'
  // داده‌ها را یک‌بار جمع می‌کنیم تا سه بخش از آن ساخته شود
  const details = invs.map(i => ({
    i, shares: db.prepare(`SELECT s.*, u.number, u.resident_name, u.area, u.occupants, u.common_units, u.occupied
      FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY u.floor, CAST(u.number AS INTEGER), u.id`).all(i.id)
      .map(s => { const paid = shareAllocated(s.id); return { ...s, paid, remaining: s.share_amount - paid } })
  }))
  const statusTxtOf = i => i.payable
    ? (i.fundUnpaid <= 0 ? '<span class="ok">پرداخت‌شده از صندوق</span>' : i.fundPaid > 0 ? '<span class="warn">بخشی پرداخت‌شده</span>' : '<span class="warn">پرداخت‌نشده از صندوق</span>')
    : (i.remaining <= 0 ? '<span class="ok">وصول‌شده</span>' : '<span class="warn">در حال وصول</span>')
  // بخش ۱: فهرست فاکتورها
  const invListTable = `<table><thead><tr><th>شماره سند</th><th>عنوان</th><th>دسته</th><th>تاریخ</th><th>مبلغ</th><th>پرداخت از صندوق</th><th>وصول از ساکنین</th><th>وضعیت</th></tr></thead><tbody>
    ${invs.map(i => `<tr><td class="num">${faNum(i.id)}</td><td>${hEsc(i.title)}</td><td>${hEsc(i.categoryName)}</td><td class="num">${faNum(i.j_date)}</td><td class="num">${pMoney(i.amount)}</td>
      <td class="num">${i.payable ? pMoney(i.fundPaid) : '—'}</td>
      <td class="num">${(i.shareCount > 0 && !i.from_fund) ? pMoney(i.collected) : '—'}</td>
      <td>${statusTxtOf(i)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="4">جمع</td><td class="num">${pMoney(amountSum)}</td><td class="num">${pMoney(fundPaidSum)}</td><td class="num">—</td><td></td></tr>
    </tbody></table>`
  // بخش ۲: بدهیِ هر واحد به این صندوق (مجموعِ ماندهٔ فاکتورهای تسهیمی)
  const byUnit = new Map()
  for (const { shares } of details) for (const s of shares) {
    const u = byUnit.get(s.unit_id) || { number: s.number, name: s.resident_name, share: 0, paid: 0, rem: 0 }
    u.share += s.share_amount; u.paid += s.paid; u.rem += Math.max(0, s.remaining); byUnit.set(s.unit_id, u)
  }
  const faToEn2 = x => parseInt(String(x).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0
  const unitAgg = [...byUnit.values()].sort((a, b) => faToEn2(a.number) - faToEn2(b.number))
  const tAgg = unitAgg.reduce((a, u) => ({ share: a.share + u.share, paid: a.paid + u.paid, rem: a.rem + u.rem }), { share: 0, paid: 0, rem: 0 })
  const unitDebtTable = `<table><thead><tr><th>واحد</th><th>ساکن</th><th>جمع سهم</th><th>پرداخت‌شده</th><th>بدهیِ مانده</th></tr></thead><tbody>
    ${unitAgg.length ? unitAgg.map(u => `<tr><td class="num">${faNum(u.number)}</td><td>${hEsc(u.name || '—')}</td><td class="num">${pMoney(u.share)}</td>
      <td class="num amt-in">${pMoney(u.paid)}</td><td class="num ${u.rem > 0 ? 'amt-out' : ''}">${u.rem > 0 ? pMoney(u.rem) : '۰'}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#888">واحدی نیست</td></tr>'}
    <tr class="tot"><td colspan="2">جمع کل</td><td class="num">${pMoney(tAgg.share)}</td><td class="num">${pMoney(tAgg.paid)}</td><td class="num">${pMoney(tAgg.rem)}</td></tr>
    </tbody></table>`
  // بخش ۳: ریزِ فاکتور‌به‌فاکتور
  const blocks = details.map(({ i, shares }) => {
    const statusTxt = statusTxtOf(i)
    const meta = `دسته: ${hEsc(i.categoryName)} · صندوق: ${hEsc(i.fundName)} · تاریخ: ${faNum(i.j_date)}`
      + (i.payable ? ` · پرداخت از صندوق: ${pMoney(i.fundPaid)}${i.fundUnpaid > 0 ? ` (مانده ${pMoney(i.fundUnpaid)})` : ''}` : '')
    let unitTable = ''
    if (shares.length && !i.from_fund) {
      const totShare = shares.reduce((a, s) => a + s.share_amount, 0)
      const totPaid = shares.reduce((a, s) => a + s.paid, 0)
      const totRem = shares.reduce((a, s) => a + s.remaining, 0)
      // ستون‌های مبنای محاسبه بر اساس روش تسهیم
      const occ = s => s.occupied ? (+s.occupants || 0) : 0, com = s => +s.common_units || 0
      let mHead = '', mCell = () => '', spanExtra = 0
      if (i.method === 'occ_common') { mHead = '<th>نفرات</th><th>مشاعات</th><th>ضریب</th>'; spanExtra = 3; mCell = s => `<td class="num">${faNum(occ(s))}</td><td class="num">${faNum(com(s))}</td><td class="num">${faNum(occ(s) + com(s))}</td>` }
      else if (i.method === 'occupants') { mHead = '<th>نفرات</th>'; spanExtra = 1; mCell = s => `<td class="num">${faNum(occ(s))}</td>` }
      else if (i.method === 'area') { mHead = '<th>متراژ</th>'; spanExtra = 1; mCell = s => `<td class="num">${faNum(s.area || 0)}</td>` }
      unitTable = `<table><thead><tr><th>واحد</th><th>ساکن</th>${mHead}<th>سهم</th><th>پرداخت‌شده</th><th>مانده</th></tr></thead><tbody>
        ${shares.map(s => `<tr><td class="num">${faNum(s.number)}</td><td>${hEsc(s.resident_name || '—')}</td>${mCell(s)}
          <td class="num">${pMoney(s.share_amount)}</td><td class="num amt-in">${pMoney(s.paid)}</td>
          <td class="num ${s.remaining > 0 ? 'amt-out' : ''}">${s.remaining > 0 ? pMoney(s.remaining) : '۰'}</td></tr>`).join('')}
        <tr class="tot"><td colspan="${2 + spanExtra}">جمع</td><td class="num">${pMoney(totShare)}</td><td class="num">${pMoney(totPaid)}</td><td class="num">${pMoney(totRem)}</td></tr>
        </tbody></table>`
    } else if (i.from_fund) {
      unitTable = `<div class="sub">هزینهٔ جاری — از صندوق پرداخت می‌شود و بین واحدها تقسیم نمی‌شود.</div>`
    }
    return `<div style="margin:14px 0;break-inside:avoid">
      <div class="sech">سند ${faNum(i.id)} — ${hEsc(i.title)} — ${pMoney(i.amount)} ${U} · ${statusTxt}</div>
      <div class="sub">${meta}</div>
      <div class="sub">روشِ محاسبه: <b>${METHOD_EXPLAIN[i.method] || i.methodFa || i.method}</b>${shares.length && !i.from_fund ? ` · بین ${faNum(shares.length)} واحد` : ''}</div>
      ${unitTable}</div>`
  }).join('')
  const inner = `
    <h1>${hEsc(getSetting('buildingName') || 'ساختمان')}</h1>
    <div class="sub">گزارش فاکتوری — ریزِ سهم و بدهیِ واحدها · تاریخ گزارش‌گیری: ${faNum(today)}${(nf || nt) ? ' · بازه: ' + faNum(nf || '…') + ' تا ' + faNum(nt || '…') : ''}${fund ? ' · صندوق: ' + hEsc(fund.name) : ' · همهٔ صندوق‌ها'} · وضعیت: ${statusFa}</div>
    <div class="kpis">
      ${kpi('جمع فاکتورها', pMoney(amountSum) + ' ' + U, faNum(invs.length) + ' فاکتور')}
      ${kpi('پرداخت‌شده از صندوق', pMoney(fundPaidSum) + ' ' + U, '', 'ok')}
      ${kpi('بدهی به فروشنده', pMoney(fundUnpaidSum) + ' ' + U, '', fundUnpaidSum > 0 ? 'warn' : 'ok')}
      ${kpi('بدهی ساکنین', pMoney(resDue) + ' ' + U, 'قبوض/پروژهٔ وصول‌نشده', resDue > 0 ? 'warn' : 'ok')}
    </div>
    <div class="sech">۱) فهرست فاکتورها</div>
    ${invListTable}
    <div class="sech">۲) بدهیِ هر واحد به ${fund ? hEsc(fund.name) : 'صندوق‌ها'}</div>
    ${unitDebtTable}
    <div class="sech">۳) ریزِ فاکتور‌به‌فاکتور</div>
    ${blocks || '<div class="sub">فاکتورِ تسهیمی‌ای نیست</div>'}
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout('گزارش فاکتوری ریز — ' + today, inner)
}

function printExpensesHtml(r) {
  const U = pUnitFa()
  const kpi = (k, v, cls) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div></div>`
  const inner = `
    <h1>${hEsc(r.buildingName || 'ساختمان')}</h1>
    <div class="sub">گزارش هزینه‌کرد و شفاف‌سازی · ${hEsc(r.scopeLabel)} · تاریخ صدور: ${faNum(r.today)}</div>
    <div class="kpis">
      ${kpi('جمع هزینه‌ها', pMoney(r.totals.amount) + ' ' + U)}
      ${kpi('وصول از ساکنین', pMoney(r.residentCollected != null ? r.residentCollected : r.totals.collected) + ' ' + U, 'ok')}
      ${kpi(r.isProject ? 'مانده بدهی ساکنین (طبق مصوبه)' : 'مانده بدهی ساکنین', pMoney(r.unitDebt) + ' ' + U, r.unitDebt > 0 ? 'warn' : 'ok')}
      ${r.unitCredit ? kpi(r.isProject ? 'مازاد نسبت به هزینهٔ واقعی' : 'بستانکاری ساکنین', pMoney(r.unitCredit) + ' ' + U, 'ok') : ''}
      ${r.contractor ? kpi('پرداخت به پیمانکار', pMoney(r.contractor.paid) + ' ' + U) : ''}
      ${r.contractor ? kpi('طلب باقی‌ماندهٔ پیمانکار', pMoney(r.contractor.outstanding) + ' ' + U, r.contractor.outstanding > 0 ? 'warn' : 'ok') : ''}
    </div>
    ${r.project ? `<div class="big" style="font-size:13px">مسیر مالی پروژه: برآورد اولیه <b>${pMoney(r.project.budget)}</b> ← مبلغ نهایی <b>${pMoney(r.project.finalAmount)}</b> ${r.project.deviation ? `· انحراف <b class="${r.project.deviation > 0 ? 'amt-out' : 'amt-in'}">${r.project.deviation > 0 ? '+' : '−'}${pMoney(Math.abs(r.project.deviation))}</b>` : ''} ${U}</div>` : ''}
    <div class="sech">ریز فاکتورها — بابت چه چیزی</div>
    <table><thead><tr><th>شرح</th><th>دسته</th><th>تاریخ</th><th>تقسیم</th><th>مبلغ کل</th><th>وصول‌شده</th><th>مانده</th></tr></thead><tbody>
    ${r.invoices.length ? r.invoices.map(i => `<tr><td>${hEsc(i.title)}${i.isSale ? ' <span class="amt-in">(فروش)</span>' : ''}</td><td>${hEsc(i.category)}</td><td class="num">${i.j_date ? faNum(i.j_date) : '—'}</td>
      <td>${hEsc(i.methodFa)}</td><td class="num ${i.isSale ? 'amt-in' : ''}">${i.isSale ? '−' : ''}${pMoney(i.amount)}</td><td class="num amt-in">${pMoney(i.collected)}</td><td class="num amt-out">${pMoney(i.remaining)}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:#888">فاکتوری در این محدوده نیست</td></tr>'}
    <tr class="tot"><td>جمع</td><td></td><td></td><td></td><td class="num">${pMoney(r.totals.amount)}</td><td class="num">${pMoney(r.totals.collected)}</td><td class="num">${pMoney(r.totals.remaining)}</td></tr>
    </tbody></table>
    <div class="sech">تفکیک هر واحد</div>
    ${(() => {
      const bal = (v) => v > 0 ? `<span class="amt-out">بدهکار ${pMoney(v)}</span>` : v < 0 ? `<span class="amt-in">طلبکار ${pMoney(-v)}</span>` : 'تسویه'
      const sum = f => r.units.reduce((a, u) => a + f(u), 0)
      const totBal = key => { const d = sum(u => Math.max(0, u[key])), c = sum(u => Math.max(0, -u[key])); return (d ? `<span class="amt-out">بدهکار ${pMoney(d)}</span>` : '') + (d && c ? ' · ' : '') + (c ? `<span class="amt-in">طلبکار ${pMoney(c)}</span>` : '') || 'تسویه' }
      if (r.isProject) return `<table><thead><tr><th>واحد</th><th>ساکن</th><th>سهم برآوردی (مصوبه)</th><th>سهم نهایی (مخارج)</th><th>پرداختی</th><th>بدهی/طلب طبق مصوبه</th><th>بدهی/طلب طبق مخارج</th></tr></thead><tbody>
      ${r.units.length ? r.units.map(u => `<tr><td class="num">${faNum(u.number)}</td><td>${hEsc(u.resident_name || '—')}</td>
        <td class="num">${pMoney(u.budgetShare)}</td><td class="num">${pMoney(u.share)}</td><td class="num amt-in">${pMoney(u.paid)}</td>
        <td class="num">${bal(u.balBudget)}</td><td class="num">${bal(u.balExpense)}</td></tr>`).join('')
        : '<tr><td colspan="7" style="text-align:center;color:#888">سهمی برای واحدها ثبت نشده</td></tr>'}
      <tr class="tot"><td>جمع</td><td></td><td class="num">${pMoney(sum(u => u.budgetShare))}</td><td class="num">${pMoney(sum(u => u.share))}</td><td class="num">${pMoney(sum(u => u.paid))}</td><td class="num">${totBal('balBudget')}</td><td class="num">${totBal('balExpense')}</td></tr>
      </tbody></table>`
      return `<table><thead><tr><th>واحد</th><th>ساکن</th><th>سهم هر واحد</th><th>پرداختی</th><th>بدهکار / طلبکار</th></tr></thead><tbody>
      ${r.units.length ? r.units.map(u => `<tr><td class="num">${faNum(u.number)}</td><td>${hEsc(u.resident_name || '—')}</td>
        <td class="num">${pMoney(u.share)}</td><td class="num amt-in">${pMoney(u.paid)}</td><td class="num">${bal(u.balance)}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:#888">سهمی برای واحدها ثبت نشده</td></tr>'}
      <tr class="tot"><td>جمع</td><td></td><td class="num">${pMoney(sum(u => u.share))}</td><td class="num">${pMoney(sum(u => u.paid))}</td><td class="num">${totBal('balance')}</td></tr>
      </tbody></table>`
    })()}
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout('گزارش هزینه‌کرد', inner)
}

function printMeetingHtml(id) {
  const m = db.prepare(`SELECT * FROM events WHERE id=? AND kind='meeting'`).get(id)
  if (!m) return null
  const kids = db.prepare(`SELECT * FROM events WHERE parent_id=? ORDER BY id`).all(id)
  const bn = getSetting('buildingName') || 'ساختمان'
  const item = e => `<tr><td>${EVENT_KIND_FA[e.kind] || e.kind}</td><td><b>${hEsc(e.title)}</b>${e.summary ? '<br><span style="color:#555;font-size:11px">' + hEsc(e.summary) + '</span>' : ''}</td>
    <td class="num">${e.status ? (EVENT_STATUS_FA[e.status] || '') : '—'}</td></tr>`
  const inner = `
    <h1>${hEsc(bn)}</h1>
    <div class="sub">صورت‌جلسه رسمی · ${hEsc(m.title)} · تاریخ: ${m.j_date ? faNum(m.j_date) : '—'}</div>
    ${m.attendees ? `<div class="big" style="font-size:13px">👥 حاضرین: ${hEsc(m.attendees)}</div>` : ''}
    ${m.summary ? `<div class="sech">خلاصه‌ی جلسه</div><div style="font-size:13px;line-height:1.9">${hEsc(m.summary).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="sech">مصوبات و پیشنهادات</div>
    <table><thead><tr><th>نوع</th><th>شرح</th><th>وضعیت</th></tr></thead><tbody>
    ${kids.length ? kids.map(item).join('') : '<tr><td colspan="3" style="text-align:center;color:#888">موردی ثبت نشده</td></tr>'}
    </tbody></table>
    <div class="sign"><span>امضای رئیس هیئت‌مدیره: ____________</span><span>امضای مدیر ساختمان: ____________</span></div>
    <div class="foot">صادرشده از «حسابدار ساختمان توی دید» · toyedid.com</div>`
  return printLayout(`صورت‌جلسه — ${m.title}`, inner)
}

const PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/setup',
  '/api/auth/recover', '/api/auth/local-reset', '/api/auth/local-reset/available'])
// ---- قفلِ نوشتن + تراکنش: هر درخواستِ نوشتنی یا کامل ثبت می‌شود یا اصلاً ثبت نمی‌شود ----
// اگر پاسخِ درخواست خطا (کد ۴۰۰ به بالا) باشد، همهٔ تغییراتِ همان درخواست برگردانده می‌شود
let writeChain = Promise.resolve()
const withWriteLock = fn => { const p = writeChain.then(fn, fn); writeChain = p.catch(() => { }); return p }
const NO_TX = new Set(['/api/backup', '/api/backup/restore', '/api/backup/inspect', '/api/update'])
const server = createServer((req, res) => {
  if (getSetting('lanAccess', '1') === '0' && !isLoopback(req)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('دسترسی از شبکه در تنظیمات برنامه خاموش است') }
  let p = ''; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { }
  if (req.method === 'GET' || !p.startsWith('/api/')) return handle(req, res)
  return withWriteLock(async () => {
    if (NO_TX.has(p)) return handle(req, res)
    db.exec('BEGIN IMMEDIATE')
    let ok = false
    const aud = auditBegin(req, p)
    try { await handle(req, res); ok = res.statusCode < 400; if (ok && aud) auditEnd(aud, req, res) }
    finally { try { db.exec(ok ? 'COMMIT' : 'ROLLBACK') } catch (e) { console.error('تراکنش:', e.message) } }
  })
})
// ---- سابقهٔ تغییرات (audit trail): هر ثبت/ویرایش/حذفِ سندِ مالی با وضعیتِ قبل و بعد و کاربر ----
const AUDIT_ENT = [
  [/^\/api\/invoices\/(\d+)$/, 'invoices', 'فاکتور'], [/^\/api\/payments\/(\d+)$/, 'payments', 'دریافتی'],
  [/^\/api\/contractor-invoices\/(\d+)$/, 'contractor_invoices', 'فاکتور پیمانکار'], [/^\/api\/expense-payments\/(\d+)$/, 'expense_payments', 'پرداخت هزینه'],
  [/^\/api\/funds\/(\d+)$/, 'funds', 'صندوق'], [/^\/api\/units\/(\d+)$/, 'units', 'واحد'], [/^\/api\/projects\/(\d+)$/, 'projects', 'پروژه']
]
const AUDIT_CREATE = { '/api/invoices': ['invoices', 'فاکتور'], '/api/payments': ['payments', 'دریافتی'], '/api/payments/bulk': ['payments', 'دریافت گروهی'], '/api/contractor-invoices': ['contractor_invoices', 'فاکتور پیمانکار'], '/api/charge/issue': ['invoices', 'صدور شارژ'] }
function auditSnapshot(table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id); if (!row) return null
  if (table === 'invoices') { row._shares = db.prepare('SELECT unit_id, share_amount FROM invoice_shares WHERE invoice_id=?').all(id); row._fundPaid = invoiceFundPaid(id) }
  if (table === 'payments') row._allocations = db.prepare('SELECT share_id, amount FROM payment_allocations WHERE payment_id=?').all(id)
  return row
}
function auditBegin(req, p) {
  const m = req.method
  for (const [re, table, label] of AUDIT_ENT) {
    const mm = re.exec(p); if (!mm) continue
    return { table, label, id: +mm[1], action: m === 'DELETE' ? 'حذف' : 'ویرایش', before: auditSnapshot(table, +mm[1]), path: p }
  }
  const pay = /^\/api\/invoices\/(\d+)\/pay$/.exec(p); if (pay) return { table: 'invoices', label: 'پرداخت از صندوق', id: +pay[1], action: 'پرداخت', before: auditSnapshot('invoices', +pay[1]), path: p }
  const cip = /^\/api\/contractor-invoices\/(\d+)\/payments$/.exec(p); if (cip && m === 'POST') return { table: 'contractor_invoices', label: 'پرداخت به پیمانکار', id: +cip[1], action: 'پرداخت', before: auditSnapshot('contractor_invoices', +cip[1]), path: p }
  const cpd = /^\/api\/contractor-payments\/(\d+)$/.exec(p); if (cpd) return { table: 'contractor_payments', label: 'پرداخت پیمانکار', id: +cpd[1], action: 'حذف', before: auditSnapshot('contractor_payments', +cpd[1]), path: p }
  const adj = /^\/api\/funds\/(\d+)\/adjust$/.exec(p); if (adj) return { table: 'funds', label: 'سند تعدیل', id: +adj[1], action: 'تعدیل', before: null, path: p }
  if (m === 'POST' && AUDIT_CREATE[p]) return { table: AUDIT_CREATE[p][0], label: AUDIT_CREATE[p][1], id: null, action: 'ثبت', before: null, path: p }
  return null
}
function auditEnd(a, req, res) {
  try {
    const u = authUser(req)
    const after = a.id && a.action !== 'حذف' ? auditSnapshot(a.table, a.id) : null
    let body = req._body ? { ...req._body } : null
    if (body) { delete body.doc; delete body.dataUrl; delete body.password; delete body.newPassword }
    let id = a.id
    if (!id && res._json && res._json.id) id = res._json.id
    const reason = (req._body && req._body.reason) || new URL(req.url, 'http://x').searchParams.get('reason') || ''
    db.prepare(`INSERT INTO audit_log(at,user_id,user_name,action,entity,entity_id,label,reason,before_json,after_json,body_json,path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nowISO(), u ? u.id : null, u ? u.display_name : '', a.action, a.table, id || null, a.label, String(reason).slice(0, 300),
        a.before ? JSON.stringify(a.before) : null, after ? JSON.stringify(after) : null, body ? JSON.stringify(body).slice(0, 20000) : null, a.path)
  } catch (e) { console.error('سابقه:', e.message) }
}
async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const path = decodeURIComponent(url.pathname)
    const Q = Object.fromEntries(url.searchParams)
    const M = req.method
    const user = authUser(req)
    const noUsers = db.prepare(`SELECT COUNT(*) c FROM users`).get().c === 0

    // ---- احراز هویت ----
    if (path === '/api/auth/status' && M === 'GET')
      return sendJSON(res, 200, {
        needsSetup: noUsers, user: userPublic(user), version: APP_VERSION, lanUrl: lanUrl(), buildingName: getSetting('buildingName'),
        needsRecoveryCode: !!(user && user.role === 'admin' && !user.recovery_hash)
      })

    if (path === '/api/auth/setup' && M === 'POST') {
      if (!noUsers) return sendJSON(res, 400, { error: 'مدیر قبلاً ساخته شده است' })
      const b = await jbody(req)
      if (!b.username || !b.password || !b.displayName) return sendJSON(res, 400, { error: 'همه‌ی فیلدها لازم است' })
      if (String(b.password).length < PW_MIN) return sendJSON(res, 400, { error: PW_MIN_MSG })
      const { hash, salt } = hashPw(b.password)
      const uid = Number(db.prepare(`INSERT INTO users(username,display_name,role,pass_hash,pass_salt,created_at) VALUES(?,?,?,?,?,?)`)
        .run(b.username.trim(), b.displayName.trim(), 'admin', hash, salt, nowISO()).lastInsertRowid)
      if ((b.buildingName || '').trim()) setSetting('buildingName', b.buildingName.trim())
      const recoveryCode = setRecoveryCode(uid)
      logSecurity('recovery_generated', b.username.trim(), 'setup', clientIp(req))
      return sendJSON(res, 200, { ok: true, recoveryCode })
    }

    if (path === '/api/auth/login' && M === 'POST') {
      const b = await jbody(req)
      const uname = (b.username || '').trim(), ip = clientIp(req)
      const lockMin = Math.max(loginLockedMin('u:' + uname), loginLockedMin('ip:' + ip))
      if (lockMin) return sendJSON(res, 429, { error: `به‌خاطر چند تلاشِ ناموفق، ورود ${faNum(lockMin)} دقیقه قفل است` })
      const u = db.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(uname)
      if (!u || !verifyPw(b.password || '', u.pass_hash, u.pass_salt)) {
        const locked = loginFail('u:' + uname, 5) | loginFail('ip:' + ip, 20)
        await delay(400)
        if (locked) { setImmediate(() => { try { logSecurity('login_locked', uname, '', ip) } catch { } }) }
        return sendJSON(res, 401, { error: locked ? 'به‌خاطر چند تلاشِ ناموفق، ورود ۱۵ دقیقه قفل شد' : 'نام کاربری یا رمز اشتباه است' })
      }
      loginFails.delete('u:' + uname)
      const token = newSession(u.id)
      return sendJSON(res, 200, { ok: true, user: userPublic(u) },
        { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` })
    }
    if (path === '/api/auth/logout' && M === 'POST') {
      const sid = getCookie(req, 'sid'); if (sid) sessions.delete(sid)
      return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' })
    }

    // ---- بازیابی رمز با کد بازیابی (عمومی) ----
    if (path === '/api/auth/recover' && M === 'POST') {
      const b = await jbody(req)
      const username = (b.username || '').trim(), ip = clientIp(req)
      const lock = rcLockedMin(username)
      if (lock > 0) { await delay(500); return sendJSON(res, 429, { error: `تعداد تلاش زیاد است. ${faNum(lock)} دقیقه بعد دوباره امتحان کنید` }) }
      const u = db.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(username)
      const ok = u && u.recovery_hash && verifyPw(normalizeCode(b.code), u.recovery_hash, u.recovery_salt)
      if (!ok) { rcFail(username); logSecurity('recovery_failed', username, '', ip); await delay(500); return sendJSON(res, 401, { error: 'نام کاربری یا کد بازیابی اشتباه است' }) }
      if (String(b.newPassword || '').length < PW_MIN) return sendJSON(res, 400, { error: PW_MIN_MSG })
      const { hash, salt } = hashPw(b.newPassword)
      db.prepare(`UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?`).run(hash, salt, u.id)
      const newRecoveryCode = setRecoveryCode(u.id)   // کد قدیمی باطل، کد جدید یک‌بار
      rcClear(username); sessions.clear(); logSecurity('recovery_used', username, '', ip)
      return sendJSON(res, 200, { ok: true, newRecoveryCode })
    }
    // ---- ریست محلی: فقط از روی همین کامپیوتر (loopback) + فایل درخواستِ تازه ----
    if (path === '/api/auth/local-reset/available' && M === 'GET')
      return sendJSON(res, 200, { available: isLoopback(req) && await resetRequestFresh() })
    if (path === '/api/auth/local-reset' && M === 'POST') {
      if (!isLoopback(req)) { await delay(500); logSecurity('recovery_failed', '', 'local-reset non-loopback', clientIp(req)); return sendJSON(res, 403, { error: 'ریست فقط از روی همین کامپیوتر ممکن است' }) }
      if (!(await resetRequestFresh())) return sendJSON(res, 403, { error: 'درخواستِ ریست معتبر نیست یا منقضی شده' })
      const b = await jbody(req)
      const username = (b.username || '').trim()
      const u = db.prepare(`SELECT * FROM users WHERE username=? AND role='admin'`).get(username)
      if (!u) return sendJSON(res, 400, { error: 'کاربر مدیر با این نام یافت نشد' })
      if (String(b.newPassword || '').length < PW_MIN) return sendJSON(res, 400, { error: PW_MIN_MSG })
      const { hash, salt } = hashPw(b.newPassword)
      db.prepare(`UPDATE users SET pass_hash=?, pass_salt=?, active=1 WHERE id=?`).run(hash, salt, u.id)
      const newRecoveryCode = setRecoveryCode(u.id)
      await rm(join(USER_ROOT, 'reset.request'), { force: true })
      rcClear(username); sessions.clear(); logSecurity('local_reset', username, '', clientIp(req))
      return sendJSON(res, 200, { ok: true, newRecoveryCode })
    }

    // ---- گیت ورود ----
    if (path.startsWith('/api/') && !PUBLIC_PATHS.has(path)) {
      if (!user) return sendJSON(res, 401, { error: 'لطفاً وارد شوید' })
    }
    const isAdmin = user && user.role === 'admin'
    // نقش‌های نظارتی (board/inspector) فقط مشاهده‌گرند — گیت سمت سرور، نه فقط رابط کاربری
    if (path.startsWith('/api/') && M !== 'GET' && path !== '/api/auth/logout' && !isAdmin)
      return sendJSON(res, 403, { error: 'شما دسترسی فقط-مشاهده دارید' })

    // ---- تولید مجددِ کد بازیابی (فقط مدیر؛ گیتِ بالا نقش‌های نظارتی را رد کرده) ----
    if (path === '/api/auth/recovery/regenerate' && M === 'POST') {
      const b = await jbody(req)
      const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(+b.userId || user.id)
      if (!target) return sendJSON(res, 404, { error: 'کاربر یافت نشد' })
      const code = setRecoveryCode(target.id)
      logSecurity('recovery_generated', target.username, 'by:' + user.username, clientIp(req))
      return sendJSON(res, 200, { ok: true, code })
    }
    if (path === '/api/security-log' && M === 'GET') {
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      const FA = { recovery_generated: 'ساخت کد بازیابی', recovery_used: 'استفاده از کد بازیابی', local_reset: 'ریست محلی', recovery_failed: 'تلاش ناموفق', login_locked: 'قفل ورود پس از چند رمز اشتباه' }
      return sendJSON(res, 200, db.prepare(`SELECT * FROM security_log ORDER BY id DESC LIMIT 20`).all()
        .map(r => ({ ...r, eventFa: FA[r.event] || r.event })))
    }

    // ---- دفترچه‌ی مخاطبان گزارش (هیئت‌مدیره) ----
    if (path === '/api/report-contacts' && M === 'GET')
      return sendJSON(res, 200, db.prepare(`SELECT * FROM report_contacts ORDER BY id`).all())
    if (path === '/api/report-contacts' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.name || '').trim()) return sendJSON(res, 400, { error: 'نام مخاطب لازم است' })
      const id = Number(db.prepare(`INSERT INTO report_contacts(name,phone,role,created_at) VALUES(?,?,?,?)`)
        .run(b.name.trim(), (b.phone || '').trim(), (b.role || '').trim(), nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const rcM = /^\/api\/report-contacts\/(\d+)$/.exec(path)
    if (rcM && M === 'DELETE') {
      db.prepare(`DELETE FROM report_contacts WHERE id=?`).run(+rcM[1])
      return sendJSON(res, 200, { ok: true })
    }

    // ---- رویدادها: جلسات، تصمیمات، پیشنهادات (نوشتن فقط مدیر؛ خواندن برای همه) ----
    if (path === '/api/events' && M === 'GET') return sendJSON(res, 200, eventsData())
    if (path === '/api/events' && M === 'POST') {
      const b = await jbody(req)
      if (!EVENT_KINDS.includes(b.kind)) return sendJSON(res, 400, { error: 'نوع رویداد نامعتبر است' })
      if (!(b.title || '').trim()) return sendJSON(res, 400, { error: 'عنوان لازم است' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const status = EVENT_STATUSES.includes(b.status) ? b.status : ''
      const id = Number(db.prepare(`INSERT INTO events(kind,title,g_date,j_date,summary,attendees,status,parent_id,project_id,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(b.kind, b.title.trim(), d.g_date, d.j_date, (b.summary || '').trim(),
          (b.attendees || '').trim(), status, +b.parentId || 0, +b.projectId || 0, user.id, nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const evM = /^\/api\/events\/(\d+)$/.exec(path)
    if (evM && M === 'PUT') {
      const id = +evM[1], cur = db.prepare(`SELECT * FROM events WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'رویداد یافت نشد' })
      const b = await jbody(req)
      const d = (b.jy || b.jm || b.jd) ? jDates(b) : { g_date: cur.g_date, j_date: cur.j_date }
      if (d.error) return sendJSON(res, 400, d)
      const status = EVENT_STATUSES.includes(b.status) ? b.status : cur.status
      db.prepare(`UPDATE events SET title=?,g_date=?,j_date=?,summary=?,attendees=?,status=? WHERE id=?`)
        .run((b.title ?? cur.title).trim(), d.g_date, d.j_date, (b.summary ?? cur.summary).trim(),
          (b.attendees ?? cur.attendees).trim(), status, id)
      return sendJSON(res, 200, { ok: true })
    }
    if (evM && M === 'DELETE') {
      const id = +evM[1]
      for (const a of listAttachments('event', id)) await rm(join(UP_DIR, a.file), { force: true })
      db.prepare(`DELETE FROM attachments WHERE entity_type='event' AND entity_id=?`).run(id)
      db.prepare(`UPDATE events SET parent_id=0 WHERE parent_id=?`).run(id)   // مصوبات ذیل، مستقل شوند
      db.prepare(`DELETE FROM events WHERE id=?`).run(id)
      return sendJSON(res, 200, { ok: true })
    }

    // ---- اسناد پیوست (عمومی برای هر موجودیت) ----
    const atAddM = /^\/api\/attachments\/([a-z_]+)\/(\d+)$/.exec(path)
    if (atAddM && M === 'POST') {
      const b = await jbody(req)
      if (!b.doc || !b.doc.dataUrl) return sendJSON(res, 400, { error: 'فایلی انتخاب نشد' })
      const file = await saveDoc(b.doc, 'رویدادها')
      if (!file) return sendJSON(res, 400, { error: 'ذخیره‌ی سند ناموفق بود' })
      const id = Number(db.prepare(`INSERT INTO attachments(entity_type,entity_id,file,display_name,created_at) VALUES(?,?,?,?,?)`)
        .run(atAddM[1], +atAddM[2], file, (b.doc.name || '').slice(0, 120), nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id, file, name: b.doc.name || '' })
    }
    const atDelM = /^\/api\/attachments\/(\d+)$/.exec(path)
    if (atDelM && M === 'DELETE') {
      const a = db.prepare(`SELECT * FROM attachments WHERE id=?`).get(+atDelM[1])
      if (a) { await rm(join(UP_DIR, a.file), { force: true }); db.prepare(`DELETE FROM attachments WHERE id=?`).run(a.id) }
      return sendJSON(res, 200, { ok: true })
    }

    // ---- پیمانکاران / تأمین‌کنندگان ----
    if (path === '/api/vendors' && M === 'GET') return sendJSON(res, 200, listVendors())
    if (path === '/api/vendors' && M === 'POST') {
      const b = await jbody(req); if (!(b.name || '').trim()) return sendJSON(res, 400, { error: 'نام پیمانکار لازم است' })
      const id = Number(db.prepare(`INSERT INTO vendors(name,phone,field,note,created_at) VALUES(?,?,?,?,?)`)
        .run(b.name.trim(), (b.phone || '').trim(), (b.field || '').trim(), (b.note || '').trim(), nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const vnM = /^\/api\/vendors\/(\d+)$/.exec(path)
    if (vnM && M === 'PUT') {
      const cur = db.prepare(`SELECT * FROM vendors WHERE id=?`).get(+vnM[1]); if (!cur) return sendJSON(res, 404, { error: 'یافت نشد' })
      const b = await jbody(req)
      db.prepare(`UPDATE vendors SET name=?,phone=?,field=?,note=? WHERE id=?`)
        .run((b.name ?? cur.name).trim(), (b.phone ?? cur.phone).trim(), (b.field ?? cur.field).trim(), (b.note ?? cur.note).trim(), +vnM[1])
      return sendJSON(res, 200, { ok: true })
    }
    if (vnM && M === 'DELETE') { db.prepare(`DELETE FROM vendors WHERE id=?`).run(+vnM[1]); return sendJSON(res, 200, { ok: true }) }

    // ---- پروژه‌ها ----
    if (path === '/api/projects' && M === 'GET') return sendJSON(res, 200, projectsList().map(p => ({ ...p, summary: projectSummary(p) })))
    if (path === '/api/projects' && M === 'POST') {
      const b = await jbody(req); if (!(b.title || '').trim()) return sendJSON(res, 400, { error: 'عنوان پروژه لازم است' })
      const status = PROJECT_STATUSES.includes(b.status) ? b.status : 'approved'
      const id = Number(db.prepare(`INSERT INTO projects(title,status,budget,decision_event_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(b.title.trim(), status, Math.round(+b.budget) || 0, +b.decisionEventId || 0, (b.note || '').trim(), user.id, nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const prM = /^\/api\/projects\/(\d+)$/.exec(path)
    if (prM && M === 'GET') { const d = projectDetail(+prM[1]); return d ? sendJSON(res, 200, d) : sendJSON(res, 404, { error: 'پروژه یافت نشد' }) }
    if (prM && M === 'PUT') {
      const cur = db.prepare(`SELECT * FROM projects WHERE id=?`).get(+prM[1]); if (!cur) return sendJSON(res, 404, { error: 'یافت نشد' })
      const b = await jbody(req); const status = PROJECT_STATUSES.includes(b.status) ? b.status : cur.status
      db.prepare(`UPDATE projects SET title=?,status=?,budget=?,final_amount=?,decision_event_id=?,note=? WHERE id=?`)
        .run((b.title ?? cur.title).trim(), status, b.budget != null ? Math.round(+b.budget) : cur.budget,
          b.finalAmount != null ? Math.round(+b.finalAmount) : cur.final_amount,
          b.decisionEventId != null ? +b.decisionEventId : cur.decision_event_id, (b.note ?? cur.note).trim(), +prM[1])
      return sendJSON(res, 200, { ok: true })
    }
    // صدور/ویرایش شارژ پروژه از ساکنین
    const prChargeM = /^\/api\/projects\/(\d+)\/charge$/.exec(path)
    if (prChargeM && M === 'POST') {
      const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(+prChargeM[1]); if (!p) return sendJSON(res, 404, { error: 'پروژه یافت نشد' })
      const b = await jbody(req); const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const r = setProjectCharge(p, { method: b.method, includeVacant: b.includeVacant, amount: b.amount != null ? +b.amount : p.budget, payer: b.payer, chargeKind: b.chargeKind, d }, user.id)
      return r.error ? sendJSON(res, 400, r) : sendJSON(res, 200, r)
    }
    // تعدیل نهایی: شارژ ساکنین را روی مبلغ نهاییِ حسابرسی‌شده تنظیم می‌کند
    const prRecM = /^\/api\/projects\/(\d+)\/reconcile$/.exec(path)
    if (prRecM && M === 'POST') {
      const p = db.prepare(`SELECT * FROM projects WHERE id=?`).get(+prRecM[1]); if (!p) return sendJSON(res, 404, { error: 'پروژه یافت نشد' })
      const r = reconcileProjectCharge(p)
      return r.error ? sendJSON(res, 400, r) : sendJSON(res, 200, r)
    }
    if (prM && M === 'DELETE') {
      const pid = +prM[1]
      // پروژه‌ای که سندِ مالی دارد حذف نمی‌شود (پول ساکنین و پیمانکار یتیم می‌ماند)؛ اول اسنادش را تعیین تکلیف کنید
      const ciN = db.prepare(`SELECT COUNT(*) c FROM contractor_invoices WHERE project_id=?`).get(pid).c
      const payN = db.prepare(`SELECT COUNT(*) c FROM payments WHERE project_id=?`).get(pid).c
      const chg0 = projectChargeInvoice(pid)
      const allocN = chg0 ? db.prepare(`SELECT COUNT(*) c FROM payment_allocations a JOIN invoice_shares s ON s.id=a.share_id WHERE s.invoice_id=?`).get(chg0.id).c : 0
      if (ciN || payN || allocN) return sendJSON(res, 400, { error: `این پروژه سندِ مالی دارد (${ciN} فاکتور پیمانکار، ${payN + allocN} دریافتی) و حذفش پول ساکنین را بلاتکلیف می‌کند. اگر پروژه منتفی شده، وضعیتش را «لغوشده» کنید.` })
      for (const q of db.prepare(`SELECT id FROM quotes WHERE project_id=?`).all(pid)) {
        for (const a of listAttachments('quote', q.id)) await rm(join(UP_DIR, a.file), { force: true })
        db.prepare(`DELETE FROM attachments WHERE entity_type='quote' AND entity_id=?`).run(q.id)
      }
      for (const a of listAttachments('project', pid)) await rm(join(UP_DIR, a.file), { force: true })
      db.prepare(`DELETE FROM attachments WHERE entity_type='project' AND entity_id=?`).run(pid)
      db.prepare(`DELETE FROM quotes WHERE project_id=?`).run(pid)
      const chg = projectChargeInvoice(pid); if (chg) deleteInvoice(chg.id)   // شارژ ساکنین و تخصیص‌هایش هم پاک شود
      db.prepare(`DELETE FROM projects WHERE id=?`).run(pid)
      return sendJSON(res, 200, { ok: true })
    }

    // ---- استعلام‌ها ----
    if (path === '/api/quotes' && M === 'POST') {
      const b = await jbody(req)
      if (!+b.projectId || !db.prepare(`SELECT 1 FROM projects WHERE id=?`).get(+b.projectId)) return sendJSON(res, 400, { error: 'پروژه نامعتبر است' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const vname = +b.vendorId ? vendorName(+b.vendorId) : (b.vendorName || '').trim()
      const id = Number(db.prepare(`INSERT INTO quotes(project_id,vendor_id,vendor_name,amount,g_date,j_date,note,selected,created_at) VALUES(?,?,?,?,?,?,?,0,?)`)
        .run(+b.projectId, +b.vendorId || 0, vname, Math.round(+b.amount) || 0, d.g_date, d.j_date, (b.note || '').trim(), nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const qtM = /^\/api\/quotes\/(\d+)$/.exec(path)
    if (qtM && M === 'PUT') {
      const cur = db.prepare(`SELECT * FROM quotes WHERE id=?`).get(+qtM[1]); if (!cur) return sendJSON(res, 404, { error: 'یافت نشد' })
      const b = await jbody(req); const d = (b.jy || b.jm || b.jd) ? jDates(b) : { g_date: cur.g_date, j_date: cur.j_date }; if (d.error) return sendJSON(res, 400, d)
      const vname = b.vendorId != null ? (+b.vendorId ? vendorName(+b.vendorId) : (b.vendorName || '').trim()) : cur.vendor_name
      db.prepare(`UPDATE quotes SET vendor_id=?,vendor_name=?,amount=?,g_date=?,j_date=?,note=? WHERE id=?`)
        .run(b.vendorId != null ? +b.vendorId : cur.vendor_id, vname, b.amount != null ? Math.round(+b.amount) : cur.amount, d.g_date, d.j_date, (b.note ?? cur.note).trim(), +qtM[1])
      return sendJSON(res, 200, { ok: true })
    }
    if (qtM && M === 'DELETE') {
      for (const a of listAttachments('quote', +qtM[1])) await rm(join(UP_DIR, a.file), { force: true })
      db.prepare(`DELETE FROM attachments WHERE entity_type='quote' AND entity_id=?`).run(+qtM[1])
      db.prepare(`DELETE FROM quotes WHERE id=?`).run(+qtM[1])
      return sendJSON(res, 200, { ok: true })
    }
    const qsM = /^\/api\/quotes\/(\d+)\/select$/.exec(path)
    if (qsM && M === 'POST') {
      const q = db.prepare(`SELECT project_id FROM quotes WHERE id=?`).get(+qsM[1]); if (!q) return sendJSON(res, 404, { error: 'یافت نشد' })
      const b = await jbody(req)
      db.prepare(`UPDATE quotes SET selected=0 WHERE project_id=?`).run(q.project_id)
      if (b.selected !== false) db.prepare(`UPDATE quotes SET selected=1 WHERE id=?`).run(+qsM[1])
      return sendJSON(res, 200, { ok: true })
    }

    // ---- فاکتورهای پیمانکار (خریدِ پرداخت‌شده از صندوق کم و فروشِ دریافت‌شده به صندوق اضافه می‌شود) ----
    if (path === '/api/contractor-invoices' && M === 'POST') {
      const b = await jbody(req)
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      if (!(+b.amount > 0)) return sendJSON(res, 400, { error: 'مبلغ فاکتور لازم است' })
      const vname = +b.vendorId ? vendorName(+b.vendorId) : (b.vendorName || '').trim()
      const kind = b.kind === 'sale' ? 'sale' : 'purchase'
      const amt = Math.round(+b.amount)
      // مبلغِ پرداختی: اگر آمده همان؛ وگرنه از تیکِ «تسویه‌شده» (کل یا صفر)؛ سقف = مبلغ فاکتور
      const paidAmt = Math.max(0, Math.min(amt, b.paidAmount != null ? Math.round(+b.paidAmount) : (b.paid ? amt : 0)))
      const fundId = +b.fundId && db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(+b.fundId) ? +b.fundId : omraniFundId()
      const id = Number(db.prepare(`INSERT INTO contractor_invoices(project_id,vendor_id,vendor_name,title,amount,g_date,j_date,paid,paid_amount,note,kind,fund_id,created_at) VALUES(?,?,?,?,?,?,?,0,0,?,?,?,?)`)
        .run(+b.projectId || 0, +b.vendorId || 0, vname, (b.title || '').trim(), amt, d.g_date, d.j_date, (b.note || '').trim(), kind, fundId, nowISO()).lastInsertRowid)
      if (paidAmt > 0) addCiPayment(db.prepare(`SELECT * FROM contractor_invoices WHERE id=?`).get(id), paidAmt, d, fundId, 'پرداخت هنگام ثبت', user.id)
      return sendJSON(res, 200, { ok: true, id })
    }
    const ciM = /^\/api\/contractor-invoices\/(\d+)$/.exec(path)
    if (ciM && M === 'PUT') {
      const cur = db.prepare(`SELECT * FROM contractor_invoices WHERE id=?`).get(+ciM[1]); if (!cur) return sendJSON(res, 404, { error: 'یافت نشد' })
      const b = await jbody(req); const d = (b.jy || b.jm || b.jd) ? jDates(b) : { g_date: cur.g_date, j_date: cur.j_date }; if (d.error) return sendJSON(res, 400, d)
      const vname = b.vendorId != null ? (+b.vendorId ? vendorName(+b.vendorId) : (b.vendorName || '').trim()) : cur.vendor_name
      const amt = b.amount != null ? Math.round(+b.amount) : cur.amount
      if (!(amt > 0)) return sendJSON(res, 400, { error: 'مبلغ فاکتور باید بزرگ‌تر از صفر باشد' })
      // مبلغِ پرداختی: اگر paidAmount آمده همان؛ وگرنه از تیکِ paid؛ وگرنه مقدارِ فعلی (با سقفِ مبلغ)
      const paidAmt = Math.max(0, Math.min(amt,
        b.paidAmount != null ? Math.round(+b.paidAmount)
          : b.paid != null ? (b.paid ? amt : 0)
            : (cur.paid_amount != null ? cur.paid_amount : (cur.paid ? cur.amount : 0))))
      if (amt < ciPaidSum(cur.id) && b.paidAmount == null) return sendJSON(res, 400, { error: 'مبلغ فاکتور از جمعِ پرداخت‌هایش کمتر می‌شود؛ اول پرداخت‌ها را اصلاح کنید.' })
      if ((b.kind && b.kind !== cur.kind) && ciPaidSum(cur.id) > 0) return sendJSON(res, 400, { error: 'نوعِ (خرید/فروش) فاکتوری که پرداخت دارد قابل تغییر نیست.' })
      db.prepare(`UPDATE contractor_invoices SET vendor_id=?,vendor_name=?,title=?,amount=?,g_date=?,j_date=?,note=?,kind=? WHERE id=?`)
        .run(b.vendorId != null ? +b.vendorId : cur.vendor_id, vname, (b.title ?? cur.title).trim(),
          amt, d.g_date, d.j_date, (b.note ?? cur.note).trim(),
          b.kind ? (b.kind === 'sale' ? 'sale' : 'purchase') : cur.kind, +ciM[1])
      const ciNow = db.prepare(`SELECT * FROM contractor_invoices WHERE id=?`).get(+ciM[1])
      if (b.paidAmount != null || b.paid != null) {
        const today = (() => { const t = todayJ(); return jDates({ jy: t.jy, jm: t.jm, jd: t.jd }) })()
        setCiPaidTarget(ciNow, paidAmt, b.payJy ? jDates({ jy: b.payJy, jm: b.payJm, jd: b.payJd }) : today, user.id)
      }
      refreshCiPaid(ciNow.id)
      return sendJSON(res, 200, { ok: true })
    }
    const ciPayM = /^\/api\/contractor-invoices\/(\d+)\/payments$/.exec(path)
    if (ciPayM && M === 'GET') return sendJSON(res, 200, db.prepare(`SELECT cp.*, f.name fund_name FROM contractor_payments cp LEFT JOIN funds f ON f.id=cp.fund_id WHERE cp.cinvoice_id=? ORDER BY cp.g_date, cp.id`).all(+ciPayM[1]))
    if (ciPayM && M === 'POST') {
      const ci = db.prepare(`SELECT * FROM contractor_invoices WHERE id=?`).get(+ciPayM[1]); if (!ci) return sendJSON(res, 404, { error: 'فاکتور یافت نشد' })
      const b = await jbody(req); const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const id = addCiPayment(ci, b.amount, d, +b.fundId || null, (b.note || '').trim(), user.id)
      return sendJSON(res, 200, { ok: true, id })
    }
    const cpM = /^\/api\/contractor-payments\/(\d+)$/.exec(path)
    if (cpM && M === 'DELETE') { deleteCiPayment(+cpM[1]); return sendJSON(res, 200, { ok: true }) }
    if (ciM && M === 'DELETE') {
      for (const a of listAttachments('cinvoice', +ciM[1])) await rm(join(UP_DIR, a.file), { force: true })
      db.prepare(`DELETE FROM attachments WHERE entity_type='cinvoice' AND entity_id=?`).run(+ciM[1])
      db.prepare(`DELETE FROM fund_txns WHERE ref_cinvoice_id=?`).run(+ciM[1]) // اثر صندوقِ این فاکتور هم حذف شود
      db.prepare(`DELETE FROM contractor_payments WHERE cinvoice_id=?`).run(+ciM[1])
      db.prepare(`DELETE FROM contractor_invoices WHERE id=?`).run(+ciM[1])
      return sendJSON(res, 200, { ok: true })
    }

    // ---- گزارش‌های پروژه/پیمانکار ----
    if (path === '/api/report/projects' && M === 'GET') return sendJSON(res, 200, projectsReport())
    if (path === '/api/report/vendors' && M === 'GET') return sendJSON(res, 200, vendorsReport())
    if (path === '/api/report/expenses' && M === 'GET') {
      const r = expensesReport({ mode: Q.mode, from: Q.from, to: Q.to, projectId: Q.projectId, ids: Q.ids })
      return r.error ? sendJSON(res, 400, r) : sendJSON(res, 200, r)
    }

    // ---- متادیتا ----
    if (path === '/api/meta' && M === 'GET') {
      return sendJSON(res, 200, {
        units: unitsWithBalance(), funds: listFunds(),
        categories: db.prepare(`SELECT * FROM expense_categories WHERE active=1 ORDER BY sort, id`).all(),
        methods: METHODS.map(m => ({ value: m, fa: METHOD_FA[m] })),
        expenseKinds: EXPENSE_KINDS.map(k => ({ value: k, fa: EXPENSE_KIND_FA[k] })),
        fundKinds: FUND_KINDS.map(k => ({ value: k, fa: FUND_KIND_FA[k] })), fundBuckets: FUND_BUCKETS.map(k => ({ value: k, fa: FUND_BUCKET_FA[k] })),
        payMethods: PAY_METHODS, roles: ROLES.map(r => ({ value: r, fa: ROLE_FA[r] })),
        periodKinds: PERIOD_KINDS.map(k => ({ value: k, fa: PERIOD_KIND_FA[k] })),
        buildingName: getSetting('buildingName'), displayUnit: getSetting('displayUnit', 'toman'),
        totalUnits: +getSetting('totalUnits', '0') || 0,
        chargeAmount: chargeAmountAt(curPeriod()), curPeriod: curPeriod(), curPeriodFa: periodFa(curPeriod()),
        missingCharges: missingChargePeriods(), today: todayJ(), isAdmin
      })
    }

    // ---- واحدها ----
    if (path === '/api/units' && M === 'GET') return sendJSON(res, 200, unitsWithBalance())
    if (path === '/api/units' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.number || '').trim()) return sendJSON(res, 400, { error: 'شماره/نام واحد لازم است' })
      const id = Number(db.prepare(`INSERT INTO units(number,floor,area,occupants,common_units,resident_name,owner_name,phone,occupied,monthly_charge,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.number.trim(), +b.floor || 0, +b.area || 0, +b.occupants || 0, +b.commonUnits || 0,
          (b.residentName || '').trim(), (b.ownerName || '').trim(), (b.phone || '').trim(), b.occupied === false ? 0 : 1,
          b.monthlyCharge != null && b.monthlyCharge !== '' ? Math.round(+b.monthlyCharge) : null,
          (b.note || '').trim(), nowISO()).lastInsertRowid)
      const total = +getSetting('totalUnits', '0') || 0
      const activeCount = db.prepare(`SELECT COUNT(*) c FROM units WHERE active=1`).get().c
      const warning = total > 0 && activeCount > total
        ? `تعداد واحدهای فعال (${activeCount}) از تعداد تعیین‌شده‌ی ساختمان (${total}) بیشتر شد` : ''
      return sendJSON(res, 200, { ok: true, id, warning, activeCount, totalUnits: total })
    }
    const unitM = /^\/api\/units\/(\d+)$/.exec(path)
    if (unitM && M === 'PATCH') {
      const id = +unitM[1], b = await jbody(req)
      const cur = db.prepare(`SELECT * FROM units WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'واحد یافت نشد' })
      db.prepare(`UPDATE units SET number=?,floor=?,area=?,occupants=?,common_units=?,resident_name=?,owner_name=?,phone=?,occupied=?,monthly_charge=?,active=?,note=? WHERE id=?`)
        .run((b.number ?? cur.number).trim(), b.floor != null ? +b.floor : cur.floor, b.area != null ? +b.area : cur.area,
          b.occupants != null ? +b.occupants : cur.occupants, b.commonUnits != null ? +b.commonUnits : cur.common_units, b.residentName ?? cur.resident_name, b.ownerName ?? cur.owner_name, b.phone ?? cur.phone,
          b.occupied != null ? (b.occupied ? 1 : 0) : cur.occupied,
          b.monthlyCharge !== undefined ? (b.monthlyCharge === '' || b.monthlyCharge == null ? null : Math.round(+b.monthlyCharge)) : cur.monthly_charge,
          b.active != null ? (b.active ? 1 : 0) : cur.active, b.note ?? cur.note, id)
      return sendJSON(res, 200, { ok: true })
    }
    if (unitM && M === 'DELETE') {
      const id = +unitM[1]
      const used = db.prepare(`SELECT COUNT(*) c FROM invoice_shares WHERE unit_id=?`).get(id).c
        + db.prepare(`SELECT COUNT(*) c FROM payments WHERE unit_id=?`).get(id).c
      if (used > 0) return sendJSON(res, 400, { error: `این واحد ${used} سابقه‌ی مالی دارد؛ به‌جای حذف، آن را بایگانی کنید` })
      db.prepare(`DELETE FROM units WHERE id=?`).run(id)
      return sendJSON(res, 200, { ok: true })
    }
    const unitCardM = /^\/api\/unit\/(\d+)$/.exec(path)
    if (unitCardM && M === 'GET') {
      const c = unitCard(+unitCardM[1])
      return c ? sendJSON(res, 200, c) : sendJSON(res, 404, { error: 'واحد یافت نشد' })
    }

    // ---- دسته‌های هزینه ----
    if (path === '/api/categories' && M === 'GET')
      return sendJSON(res, 200, db.prepare(`SELECT * FROM expense_categories ORDER BY sort, id`).all()
        .map(c => ({ ...c, methodFa: METHOD_FA[c.default_method] || c.default_method })))
    if (path === '/api/categories' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.name || '').trim()) return sendJSON(res, 400, { error: 'نام دسته لازم است' })
      if (!METHODS.includes(b.defaultMethod)) return sendJSON(res, 400, { error: 'روش تسهیم نامعتبر است' })
      const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0) s FROM expense_categories`).get().s) + 1
      const id = Number(db.prepare(`INSERT INTO expense_categories(name,default_method,include_vacant,default_fund_id,sort) VALUES(?,?,?,?,?)`)
        .run(b.name.trim(), b.defaultMethod, b.includeVacant ? 1 : 0, +b.defaultFundId || null, sort).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const catM = /^\/api\/categories\/(\d+)$/.exec(path)
    if (catM && M === 'PATCH') {
      const id = +catM[1], b = await jbody(req)
      const cur = db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'دسته یافت نشد' })
      db.prepare(`UPDATE expense_categories SET name=?,default_method=?,include_vacant=?,default_fund_id=?,active=? WHERE id=?`)
        .run((b.name ?? cur.name).trim(), METHODS.includes(b.defaultMethod) ? b.defaultMethod : cur.default_method,
          b.includeVacant != null ? (b.includeVacant ? 1 : 0) : cur.include_vacant,
          b.defaultFundId != null ? +b.defaultFundId : cur.default_fund_id,
          b.active != null ? (b.active ? 1 : 0) : cur.active, id)
      return sendJSON(res, 200, { ok: true })
    }
    if (catM && M === 'DELETE') {
      const id = +catM[1]
      const c = db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(id)
      if (!c) return sendJSON(res, 404, { error: 'دسته یافت نشد' })
      if (c.is_charge_cat) return sendJSON(res, 400, { error: 'دسته‌ی شارژ ماهانه حذف نمی‌شود (می‌توانید تنظیماتش را تغییر دهید)' })
      const used = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE category_id=?`).get(id).c
      if (used > 0) return sendJSON(res, 400, { error: `این دسته در ${used} فاکتور استفاده شده؛ می‌توانید غیرفعالش کنید` })
      db.prepare(`DELETE FROM expense_categories WHERE id=?`).run(id)
      return sendJSON(res, 200, { ok: true })
    }

    // ---- صندوق‌ها ----
    if (path === '/api/funds' && M === 'GET') return sendJSON(res, 200, listFunds())
    if (path === '/api/funds' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.name || '').trim()) return sendJSON(res, 400, { error: 'نام صندوق لازم است' })
      const id = Number(db.prepare(`INSERT INTO funds(name,kind,bucket,opening_balance,created_at) VALUES(?,?,?,?,?)`)
        .run(b.name.trim(), FUND_KINDS.includes(b.kind) ? b.kind : 'custom', FUND_BUCKETS.includes(b.bucket) ? b.bucket : 'charge', Math.round(+b.openingBalance) || 0, nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const fundM = /^\/api\/funds\/(\d+)$/.exec(path)
    if (fundM && M === 'PATCH') {
      const id = +fundM[1], b = await jbody(req)
      const cur = db.prepare(`SELECT * FROM funds WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'صندوق یافت نشد' })
      const hasTxn = db.prepare(`SELECT COUNT(*) c FROM fund_txns WHERE fund_id=?`).get(id).c > 0
      const newOpen = b.openingBalance != null ? Math.round(+b.openingBalance) : cur.opening_balance
      const newBucket = FUND_BUCKETS.includes(b.bucket) ? b.bucket : cur.bucket
      if (hasTxn && newOpen !== cur.opening_balance) return sendJSON(res, 400, { error: 'موجودی اولیه پس از ثبت اولین گردشِ صندوق قفل است. برای اصلاح، «سند تعدیل» ثبت کنید.' })
      if (hasTxn && newBucket !== cur.bucket) return sendJSON(res, 400, { error: 'نقشِ صندوقی که گردش دارد قابل تغییر نیست؛ تغییرش پرداخت‌ها و بدهی‌ها را جابه‌جا می‌کند.' })
      db.prepare(`UPDATE funds SET name=?,kind=?,bucket=?,opening_balance=? WHERE id=?`)
        .run((b.name ?? cur.name).trim(), FUND_KINDS.includes(b.kind) ? b.kind : cur.kind, newBucket, newOpen, id)
      return sendJSON(res, 200, { ok: true })
    }
    // سند تعدیلِ صندوق: تنها راهِ اصلاحِ موجودی پس از شروعِ کار (با سابقه و شرح)
    const fundAdjM = /^\/api\/funds\/(\d+)\/adjust$/.exec(path)
    if (fundAdjM && M === 'POST') {
      const id = +fundAdjM[1], b = await jbody(req)
      if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(id)) return sendJSON(res, 404, { error: 'صندوق یافت نشد' })
      const amt = Math.round(+b.amount); if (!amt) return sendJSON(res, 400, { error: 'مبلغ تعدیل لازم است (مثبت = افزایش، منفی = کاهش)' })
      if (!(b.note || '').trim()) return sendJSON(res, 400, { error: 'علتِ تعدیل را بنویسید' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      addFundTxn(id, amt > 0 ? 'adjust_in' : 'adjust_out', Math.abs(amt), { ...d, note: 'سند تعدیل: ' + b.note.trim(), by: user.id })
      return sendJSON(res, 200, { ok: true })
    }
    if (fundM && M === 'DELETE') {
      const id = +fundM[1]
      if (db.prepare(`SELECT COUNT(*) c FROM funds`).get().c <= 1) return sendJSON(res, 400, { error: 'حداقل یک صندوق باید بماند' })
      const used = db.prepare(`SELECT COUNT(*) c FROM fund_txns WHERE fund_id=?`).get(id).c
        + db.prepare(`SELECT COUNT(*) c FROM invoices WHERE fund_id=?`).get(id).c
        + db.prepare(`SELECT COUNT(*) c FROM payments WHERE fund_id=?`).get(id).c
      if (used > 0) return sendJSON(res, 400, { error: `این صندوق ${used} سابقه دارد و قابل حذف نیست` })
      db.prepare(`DELETE FROM funds WHERE id=?`).run(id)
      return sendJSON(res, 200, { ok: true })
    }
    const fundTxM = /^\/api\/funds\/(\d+)\/txns$/.exec(path)
    if (fundTxM && M === 'GET') {
      const id = +fundTxM[1]
      const rows = db.prepare(`SELECT t.*, i.title inv_title, u.number unit_number FROM fund_txns t
        LEFT JOIN invoices i ON i.id=t.ref_invoice_id
        LEFT JOIN payments p ON p.id=t.ref_payment_id LEFT JOIN units u ON u.id=p.unit_id
        WHERE t.fund_id=? ORDER BY t.g_date DESC, t.id DESC`).all(id)
      const f = db.prepare(`SELECT * FROM funds WHERE id=?`).get(id)
      if (!f) return sendJSON(res, 404, { error: 'صندوق یافت نشد' })
      return sendJSON(res, 200, { fund: { ...f, balance: fundBalance(id), kindFa: FUND_KIND_FA[f.kind] }, rows })
    }
    if (path === '/api/funds/transfer' && M === 'POST') {
      const b = await jbody(req)
      const from = +b.fromId, to = +b.toId, amount = Math.round(+b.amount)
      if (!from || !to || from === to) return sendJSON(res, 400, { error: 'صندوق مبدأ و مقصد را درست انتخاب کنید' })
      if (!(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ باید بزرگ‌تر از صفر باشد' })
      const fF = db.prepare(`SELECT name FROM funds WHERE id=?`).get(from), fT = db.prepare(`SELECT name FROM funds WHERE id=?`).get(to)
      if (!fF || !fT) return sendJSON(res, 400, { error: 'صندوق نامعتبر است' })
      const d = jDates(b)
      addFundTxn(from, 'transfer_out', amount, { ...d, peer: to, note: b.note ? b.note : `انتقال به ${fT.name}`, by: user.id })
      addFundTxn(to, 'transfer_in', amount, { ...d, peer: from, note: b.note ? b.note : `انتقال از ${fF.name}`, by: user.id })
      return sendJSON(res, 200, { ok: true })
    }
    if (path === '/api/manager/settle' && M === 'POST') {
      const b = await jbody(req)
      const amount = Math.round(+b.amount), fundId = +b.fundId
      if (!(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ تسویه را وارد کنید' })
      if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) return sendJSON(res, 400, { error: 'صندوق نامعتبر است' })
      const debt = managerDebt()
      if (amount > debt) return sendJSON(res, 400, { error: `طلب مدیر ${debt} ریال است؛ مبلغ بیشتر قابل تسویه نیست` })
      addFundTxn(fundId, 'manager_settle', amount, { ...jDates(b), note: b.note || 'تسویه با مدیر', by: user.id })
      return sendJSON(res, 200, { ok: true, managerDebt: managerDebt() })
    }

    // ---- فاکتورها ----
    if (path === '/api/invoices' && M === 'GET') return sendJSON(res, 200, listInvoices(Q))
    if (path === '/api/invoices/preview' && M === 'POST') {
      const b = await jbody(req)
      const includeVacant = !!b.includeVacant
      const units = eligibleUnits(includeVacant)
      const method = METHODS.includes(b.method) ? b.method : 'equal'
      let amount = Math.round(+b.amount) || 0
      const shares = computeShares(units, method, amount, { custom: b.custom, period: b.period || curPeriod() })
      if (method === 'per_unit_charge' || method === 'custom') amount = sumShares(shares)
      const uMap = {}; for (const u of units) uMap[u.id] = u
      return sendJSON(res, 200, {
        amount, total: sumShares(shares),
        rows: shares.map(s => ({ ...s, number: uMap[s.unit_id].number, resident: uMap[s.unit_id].resident_name, area: uMap[s.unit_id].area, occupants: uMap[s.unit_id].occupants, common_units: uMap[s.unit_id].common_units, occupied: uMap[s.unit_id].occupied }))
      })
    }
    if (path === '/api/invoices' && M === 'POST') {
      const b = await jbody(req)
      const r = await saveInvoice(null, b, user)
      return r.error ? sendJSON(res, 400, r) : sendJSON(res, 200, r)
    }
    // ثبت گروهی هزینه‌ها (فرم صندوق‌دار) — هر ردیف یک فاکتور با روش پیش‌فرضِ دسته‌اش
    if (path === '/api/invoices/batch' && M === 'POST') {
      const b = await jbody(req)
      const rows = Array.isArray(b.rows) ? b.rows : []
      const out = []
      for (const row of rows) {
        if (!(row && (row.title || '').trim() && +row.amount > 0)) continue
        const r = await saveInvoice(null, {
          title: row.title, categoryId: +row.categoryId, amount: +row.amount,
          jy: row.jy, jm: row.jm, jd: row.jd, docNo: row.docNo, note: row.note, doc: row.doc
        }, user)
        out.push(r.error ? { error: r.error, title: row.title } : { ok: true, id: r.id, title: row.title })
      }
      const okN = out.filter(x => x.ok).length
      if (!okN) return sendJSON(res, 400, { error: 'هیچ ردیف معتبری ثبت نشد', results: out })
      return sendJSON(res, 200, { ok: true, count: okN, fail: out.length - okN, results: out })
    }
    const invM = /^\/api\/invoices\/(\d+)$/.exec(path)
    if (invM && M === 'PUT') {
      const b = await jbody(req)
      const r = await saveInvoice(+invM[1], b, user)
      return r.error ? sendJSON(res, 400, r) : sendJSON(res, 200, r)
    }
    if (invM && M === 'DELETE') {
      const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(+invM[1])
      if (!inv) return sendJSON(res, 404, { error: 'فاکتور یافت نشد' })
      if (inv.is_opening) return sendJSON(res, 400, { error: 'مانده‌ی اولیه از منوی «مانده اولیه» صفر شود' })
      deleteInvoice(inv.id)
      return sendJSON(res, 200, { ok: true })
    }
    const invGetM = /^\/api\/invoice\/(\d+)$/.exec(path)
    if (invGetM && M === 'GET') {
      const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(+invGetM[1])
      if (!inv) return sendJSON(res, 404, { error: 'فاکتور یافت نشد' })
      const shares = db.prepare(`SELECT s.*, u.number, u.resident_name, u.area, u.occupants, u.common_units, u.occupied
        FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=? ORDER BY u.floor, CAST(u.number AS INTEGER), u.id`).all(inv.id)
        .map(s => {
          const paid = shareAllocated(s.id)
          const pays = db.prepare(`SELECT a.amount, p.j_date, p.id pid FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.share_id=? ORDER BY p.g_date, p.id`).all(s.id)
          return { ...s, paid, remaining: s.share_amount - paid, payments: pays }
        })
      return sendJSON(res, 200, {
        invoice: invoiceRow(inv), shares, debtors: shares.filter(s => s.remaining > 0),
        fundPayments: invoiceFundPayments(inv.id), funds: listFunds()
      })
    }
    // پرداخت هزینه/فاکتور از صندوق
    const invPayM = /^\/api\/invoices\/(\d+)\/pay$/.exec(path)
    if (invPayM && M === 'POST') {
      const b = await jbody(req)
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      try {
        const r = payExpense(+invPayM[1], +b.fundId, b.amount, d, (b.note || '').trim(), user.id)
        return sendJSON(res, 200, { ok: true, ...r })
      } catch (e) { return sendJSON(res, 400, { error: e.message }) }
    }
    const epDelM = /^\/api\/expense-payments\/(\d+)$/.exec(path)
    if (epDelM && M === 'DELETE') {
      deleteExpensePayment(+epDelM[1])
      return sendJSON(res, 200, { ok: true })
    }

    // ---- دریافتی‌ها ----
    if (path === '/api/payments' && M === 'GET') {
      const w = ['p.is_opening=0'], a = []
      if (Q.unit_id) { w.push('p.unit_id=?'); a.push(+Q.unit_id) }
      if (Q.fund_id) { w.push('p.fund_id=?'); a.push(+Q.fund_id) }
      if (Q.from) { w.push('p.g_date>=?'); a.push(Q.from) }
      if (Q.to) { w.push('p.g_date<=?'); a.push(Q.to) }
      const rows = db.prepare(`SELECT p.*, u.number, u.resident_name, f.name fund_name FROM payments p
        JOIN units u ON u.id=p.unit_id LEFT JOIN funds f ON f.id=p.fund_id
        WHERE ${w.join(' AND ')} ORDER BY p.g_date DESC, p.id DESC ${Q.limit ? 'LIMIT ' + Number(Q.limit) : ''}`).all(...a)
      return sendJSON(res, 200, rows.map(p => ({ ...p, allocated: paymentAllocated(p.id), leftover: p.amount - paymentAllocated(p.id) })))
    }
    if (path === '/api/payments' && M === 'POST') {
      const b = await jbody(req)
      const unitId = +b.unitId, amount = Math.round(+b.amount), fundId = +b.fundId
      if (!db.prepare(`SELECT 1 FROM units WHERE id=?`).get(unitId)) return sendJSON(res, 400, { error: 'واحد را انتخاب کنید' })
      if (!(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ باید بزرگ‌تر از صفر باشد' })
      if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) return sendJSON(res, 400, { error: 'صندوق مقصد را انتخاب کنید' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId)
      const docFile = await saveDoc(b.doc, `واحد ${safeFolder(u.number)}`)
      const projectId = +b.projectId || 0
      const id = Number(db.prepare(`INSERT INTO payments(unit_id,amount,g_date,j_date,fund_id,method,doc_file,note,project_id,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(unitId, amount, d.g_date, d.j_date, fundId, b.method || '', docFile, (b.note || '').trim(), projectId, user.id, nowISO()).lastInsertRowid)
      addFundTxn(fundId, 'in', amount, { ...d, payId: id, note: (projectId ? 'دریافتیِ پروژه — واحد ' : 'دریافتی واحد ') + u.number, by: user.id })
      const targets = Array.isArray(b.invoiceIds) ? b.invoiceIds.map(Number).filter(Boolean) : null
      const allocated = allocatePayment(id, targets)
      return sendJSON(res, 200, { ok: true, id, allocated, credit: amount - allocated })
    }
    // پرداخت از محل طلبِ واحد — بدون ورود نقدینگی به صندوق؛ بستانکاریِ موجود روی بدهیِ هدف می‌نشیند
    if (path === '/api/pay-from-credit' && M === 'POST') {
      const b = await jbody(req)
      const unitId = +b.unitId
      const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId)
      if (!u) return sendJSON(res, 400, { error: 'واحد را انتخاب کنید' })
      const avail = unitCredit(unitId)
      if (!(avail > 0)) return sendJSON(res, 400, { error: 'این واحد طلبی (بستانکاری) ندارد' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      let ids = Array.isArray(b.invoiceIds) ? b.invoiceIds.map(Number).filter(Boolean) : null
      if ((!ids || !ids.length) && +b.projectId) { const inv = projectChargeInvoice(+b.projectId); if (inv) ids = [inv.id] }
      const shares = ids && ids.length ? openSharesOfUnit(unitId, ids) : openSharesOfUnit(unitId)
      if (!shares.length) return sendJSON(res, 400, { error: 'بدهیِ بازی برای این واحد نیست' })
      const cap = b.amount != null ? Math.min(Math.round(+b.amount), avail) : avail
      const used = useCreditForShares(unitId, shares, cap)
      if (!(used > 0)) return sendJSON(res, 400, { error: 'مبلغی از طلب قابل استفاده نبود' })
      db.prepare(`INSERT INTO credit_uses(unit_id,invoice_id,amount,g_date,j_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(unitId, ids && ids.length ? ids[0] : 0, used, d.g_date, d.j_date, (b.note || '').trim(), user.id, nowISO())
      return sendJSON(res, 200, { ok: true, used, creditLeft: unitCredit(unitId) })
    }
    // ثبت گروهی دریافتی — چند واحد با هم، بابت یک فاکتور مشخص یا بدهی کلی (FIFO)
    if (path === '/api/payments/bulk' && M === 'POST') {
      const b = await jbody(req)
      const fundId = +b.fundId
      if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) return sendJSON(res, 400, { error: 'صندوق مقصد را انتخاب کنید' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      const note = (b.note || '').trim()
      // بابتِ یک فاکتورِ مشخص → strict روی همان؛ بابتِ «کلی» → auto آگاه‌به‌صندوق، فقط روی سبدِ همان صندوقِ مقصد
      const targets = +b.invoiceId ? [+b.invoiceId] : null
      const strict = !!+b.invoiceId
      let count = 0, total = 0
      for (const it of (Array.isArray(b.items) ? b.items : [])) {
        const unitId = +it.unitId, amount = Math.round(+it.amount)
        if (!(amount > 0)) continue
        const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId); if (!u) continue
        const id = Number(db.prepare(`INSERT INTO payments(unit_id,amount,g_date,j_date,fund_id,method,doc_file,note,created_by,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(unitId, amount, d.g_date, d.j_date, fundId, b.method || '', '', note || 'دریافت گروهی', user.id, nowISO()).lastInsertRowid)
        addFundTxn(fundId, 'in', amount, { ...d, payId: id, note: `دریافتی واحد ${u.number}`, by: user.id })
        allocatePayment(id, targets, strict)
        count++; total += amount
      }
      if (!count) return sendJSON(res, 400, { error: 'هیچ واحدی با مبلغ معتبر انتخاب نشد' })
      return sendJSON(res, 200, { ok: true, count, total })
    }
    const payM = /^\/api\/payments\/(\d+)$/.exec(path)
    if (payM && M === 'DELETE') {
      const p = db.prepare(`SELECT * FROM payments WHERE id=?`).get(+payM[1])
      if (!p) return sendJSON(res, 404, { error: 'دریافتی یافت نشد' })
      if (p.is_opening) return sendJSON(res, 400, { error: 'بستانکاری اولیه از منوی «مانده اولیه» صفر شود' })
      if (p.doc_file) await rm(join(UP_DIR, p.doc_file), { force: true })
      deletePayment(p.id)
      return sendJSON(res, 200, { ok: true })
    }
    if (payM && M === 'PUT') {
      const id = +payM[1], b = await jbody(req)
      const cur = db.prepare(`SELECT * FROM payments WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'دریافتی یافت نشد' })
      if (cur.is_opening) return sendJSON(res, 400, { error: 'بستانکاری اولیه از منوی «مانده اولیه» ویرایش شود' })
      const amount = Math.round(+b.amount) || cur.amount
      if (!(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ باید بزرگ‌تر از صفر باشد' })
      const fundId = +b.fundId || cur.fund_id
      const d = b.jy ? jDates(b) : { g_date: cur.g_date, j_date: cur.j_date }
      if (d.error) return sendJSON(res, 400, d)
      const unitId = +b.unitId || cur.unit_id
      let docFile = cur.doc_file
      if (b.doc && b.doc.dataUrl) {
        const u = db.prepare(`SELECT * FROM units WHERE id=?`).get(unitId)
        docFile = await saveDoc(b.doc, `واحد ${safeFolder(u.number)}`)
      }
      if (!db.prepare(`SELECT 1 FROM units WHERE id=?`).get(unitId)) return sendJSON(res, 400, { error: 'واحد نامعتبر است' })
      if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) return sendJSON(res, 400, { error: 'صندوق نامعتبر است' })
      const u = db.prepare(`SELECT number FROM units WHERE id=?`).get(unitId)
      const moneyChanged = amount !== cur.amount || unitId !== cur.unit_id || fundId !== cur.fund_id
      db.prepare(`UPDATE payments SET unit_id=?,amount=?,g_date=?,j_date=?,fund_id=?,method=?,doc_file=?,note=? WHERE id=?`)
        .run(unitId, amount, d.g_date, d.j_date, fundId, b.method ?? cur.method, docFile, b.note ?? cur.note, id)
      if (!moneyChanged) {
        // فقط تاریخ/روش/توضیح/سند عوض شده: تخصیص‌ها و صورت‌حسابِ ساکن دست نمی‌خورد
        db.prepare(`UPDATE fund_txns SET g_date=?, j_date=? WHERE ref_payment_id=?`).run(d.g_date, d.j_date, id)
        return sendJSON(res, 200, { ok: true, reallocated: false })
      }
      // مبلغ/واحد/صندوق عوض شده: اول همان بدهی‌هایی که قبلاً تسویه می‌کرد، بعد بقیهٔ همان سبد
      const oldInvs = db.prepare(`SELECT DISTINCT s.invoice_id i FROM payment_allocations a JOIN invoice_shares s ON s.id=a.share_id WHERE a.payment_id=?`).all(id).map(r => r.i)
      db.prepare(`DELETE FROM payment_allocations WHERE payment_id=?`).run(id)
      db.prepare(`DELETE FROM fund_txns WHERE ref_payment_id=?`).run(id)
      addFundTxn(fundId, 'in', amount, { ...d, payId: id, note: `دریافتی واحد ${u.number}`, by: user.id })
      allocatePayment(id, unitId === cur.unit_id ? oldInvs : null)
      applyCreditsOfUnit(cur.unit_id); if (unitId !== cur.unit_id) applyCreditsOfUnit(unitId)
      for (const i of oldInvs) refreshInvoiceStatus(i)
      return sendJSON(res, 200, { ok: true, reallocated: true })
    }
    // بدهی‌های باز یک واحد (برای تخصیص دستی موقع ثبت دریافتی)
    const openM = /^\/api\/unit\/(\d+)\/open$/.exec(path)
    if (openM && M === 'GET') {
      const rows = db.prepare(`SELECT s.id share_id, s.invoice_id, s.share_amount, i.title, i.j_date, i.g_date, i.is_opening
        FROM invoice_shares s JOIN invoices i ON i.id=s.invoice_id WHERE s.unit_id=? ORDER BY i.g_date, i.id`).all(+openM[1])
        .map(r => ({ ...r, paid: shareAllocated(r.share_id), remaining: r.share_amount - shareAllocated(r.share_id) }))
        .filter(r => r.remaining > 0)
      return sendJSON(res, 200, { rows, credit: unitCredit(+openM[1]) })
    }

    // ---- شارژ ماهانه ----
    if (path === '/api/charge/amount' && M === 'GET')
      return sendJSON(res, 200, {
        current: chargeAmountAt(curPeriod()),
        history: db.prepare(`SELECT * FROM charge_history ORDER BY effective_j DESC, id DESC`).all().map(h => ({ ...h, fa: periodFa(h.effective_j) }))
      })
    if (path === '/api/charge/amount' && M === 'POST') {
      const b = await jbody(req)
      const amount = Math.round(+b.amount)
      if (!(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ شارژ باید بزرگ‌تر از صفر باشد' })
      const eff = /^\d{4}\/\d{2}$/.test(b.effective || '') ? b.effective : curPeriod()
      db.prepare(`INSERT INTO charge_history(amount,effective_j,created_at) VALUES(?,?,?)`).run(amount, eff, nowISO())
      return sendJSON(res, 200, { ok: true, note: 'شارژهای صادرشده‌ی قبلی تغییر نمی‌کنند' })
    }
    const chDelM = /^\/api\/charge\/amount\/(\d+)$/.exec(path)
    if (chDelM && M === 'DELETE') {
      if (db.prepare(`SELECT COUNT(*) c FROM charge_history`).get().c <= 1) return sendJSON(res, 400, { error: 'حداقل یک مبلغ شارژ باید بماند' })
      db.prepare(`DELETE FROM charge_history WHERE id=?`).run(+chDelM[1])
      return sendJSON(res, 200, { ok: true })
    }
    if (path === '/api/charge/periods' && M === 'GET')
      return sendJSON(res, 200, { missing: missingChargePeriods(), current: curPeriod(), currentFa: periodFa(curPeriod()) })

    // ---- ضریب تأخیر ----
    if (path === '/api/latefee' && M === 'GET') return sendJSON(res, 200, lateFeePreview(Q.period || curPeriod()))
    if (path === '/api/latefee/apply' && M === 'POST') {
      const b = await jbody(req)
      const r = applyLateFees(b.period || curPeriod(), user.id)
      if (!r.created) return sendJSON(res, 400, { error: r.reason })
      return sendJSON(res, 200, { ok: true, ...r })
    }
    if (path === '/api/charge/issue' && M === 'POST') {
      const b = await jbody(req)
      const r = issueCharge(b.period || curPeriod(), user.id)
      if (!r.created) return sendJSON(res, 400, { error: r.reason || 'شارژ این ماه قبلاً صادر شده است' })
      return sendJSON(res, 200, { ok: true, ...r })
    }

    // ---- هزینه‌های دوره‌ای ----
    if (path === '/api/recurring' && M === 'GET') return sendJSON(res, 200, listRecurring())
    if (path === '/api/recurring' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.title || '').trim()) return sendJSON(res, 400, { error: 'عنوان هزینه لازم است' })
      const cat = db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(+b.categoryId)
      if (!cat) return sendJSON(res, 400, { error: 'دسته‌ی هزینه را انتخاب کنید' })
      const method = METHODS.includes(b.method) && b.method !== 'custom' ? b.method : cat.default_method
      const kind = PERIOD_KINDS.includes(b.periodKind) ? b.periodKind : 'monthly'
      const fundId = +b.fundId || cat.default_fund_id
      const amount = Math.round(+b.amount) || 0
      if (method !== 'per_unit_charge' && !(amount > 0)) return sendJSON(res, 400, { error: 'مبلغ هزینه را وارد کنید' })
      const id = Number(db.prepare(`INSERT INTO recurring_expenses(title,amount,period_kind,category_id,method,include_vacant,fund_id,expense_kind,auto,active,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,?)`).run(b.title.trim(), amount, kind, cat.id, method,
          b.includeVacant ? 1 : (b.includeVacant === false ? 0 : cat.include_vacant), fundId,
          EXPENSE_KINDS.includes(b.expenseKind) ? b.expenseKind : 'fixed', b.auto === false ? 0 : 1, nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const recM = /^\/api\/recurring\/(\d+)$/.exec(path)
    if (recM && M === 'PATCH') {
      const id = +recM[1], b = await jbody(req)
      const cur = db.prepare(`SELECT * FROM recurring_expenses WHERE id=?`).get(id)
      if (!cur) return sendJSON(res, 404, { error: 'قالب یافت نشد' })
      const method = b.method != null ? (METHODS.includes(b.method) && b.method !== 'custom' ? b.method : cur.method) : cur.method
      db.prepare(`UPDATE recurring_expenses SET title=?,amount=?,period_kind=?,category_id=?,method=?,include_vacant=?,fund_id=?,expense_kind=?,auto=?,active=? WHERE id=?`)
        .run((b.title ?? cur.title).trim(), b.amount != null ? Math.round(+b.amount) : cur.amount,
          PERIOD_KINDS.includes(b.periodKind) ? b.periodKind : cur.period_kind,
          +b.categoryId || cur.category_id, method,
          b.includeVacant != null ? (b.includeVacant ? 1 : 0) : cur.include_vacant,
          +b.fundId || cur.fund_id, EXPENSE_KINDS.includes(b.expenseKind) ? b.expenseKind : cur.expense_kind,
          b.auto != null ? (b.auto ? 1 : 0) : cur.auto, b.active != null ? (b.active ? 1 : 0) : cur.active, id)
      return sendJSON(res, 200, { ok: true })
    }
    if (recM && M === 'DELETE') {
      const id = +recM[1]
      db.prepare(`UPDATE invoices SET recur_id=0 WHERE recur_id=?`).run(id)   // فاکتورهای صادرشده باقی می‌مانند
      db.prepare(`DELETE FROM recurring_expenses WHERE id=?`).run(id)
      return sendJSON(res, 200, { ok: true })
    }
    const recIssueM = /^\/api\/recurring\/(\d+)\/issue$/.exec(path)
    if (recIssueM && M === 'POST') {
      const rec = db.prepare(`SELECT * FROM recurring_expenses WHERE id=?`).get(+recIssueM[1])
      if (!rec) return sendJSON(res, 404, { error: 'قالب یافت نشد' })
      const r = issueRecurring(rec, recurPeriodKey(rec.period_kind), user.id)
      if (!r.created) return sendJSON(res, 400, { error: r.reason || 'هزینهٔ این دوره قبلاً صادر شده است' })
      return sendJSON(res, 200, { ok: true, ...r })
    }

    // ---- مانده‌ی اولیه ----
    if (path === '/api/openings' && M === 'GET') {
      const rows = listUnits().map(u => {
        const o = db.prepare(`SELECT * FROM opening_balances WHERE unit_id=?`).get(u.id)
        return { unit_id: u.id, number: u.number, resident_name: u.resident_name, active: u.active, amount: o ? o.amount : 0, note: o ? o.note : '' }
      })
      return sendJSON(res, 200, { units: rows, funds: listFunds(), managerOpening: +getSetting('managerOpening', '0') || 0 })
    }
    if (path === '/api/openings' && M === 'POST') {
      const b = await jbody(req)
      for (const r of (Array.isArray(b.units) ? b.units : []))
        setOpeningBalance(+r.unitId, r.amount, r.note, user.id)
      for (const f of (Array.isArray(b.funds) ? b.funds : []))
      {
        const cur = db.prepare(`SELECT * FROM funds WHERE id=?`).get(+f.fundId); if (!cur) continue
        const nv = Math.round(+f.amount) || 0
        if (nv !== cur.opening_balance && db.prepare(`SELECT COUNT(*) c FROM fund_txns WHERE fund_id=?`).get(cur.id).c > 0)
          return sendJSON(res, 400, { error: `موجودی اولیهٔ «${cur.name}» پس از ثبت اولین گردش قفل است. برای اصلاح از «سند تعدیل» در صفحهٔ صندوق‌ها استفاده کنید.` })
        db.prepare(`UPDATE funds SET opening_balance=? WHERE id=?`).run(nv, cur.id)
      }
      if (b.managerOpening != null) setSetting('managerOpening', Math.round(+b.managerOpening) || 0)
      return sendJSON(res, 200, { ok: true })
    }

    // ---- تحویل مدیریت مالی ----
    if (path === '/api/handovers' && M === 'GET')
      return sendJSON(res, 200, {
        current: getSetting('managerName', ''), managerDebt: managerDebt(), funds: listFunds(),
        rows: db.prepare(`SELECT * FROM manager_handovers ORDER BY g_date DESC, id DESC`).all()
      })
    if (path === '/api/handovers' && M === 'POST') {
      const b = await jbody(req)
      if (!(b.incomingName || '').trim()) return sendJSON(res, 400, { error: 'نام مدیر جدید لازم است' })
      const d = jDates(b); if (d.error) return sendJSON(res, 400, d)
      let settled = 0
      const amt = Math.round(+b.settleAmount) || 0
      if (amt > 0) {
        if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(+b.fundId)) return sendJSON(res, 400, { error: 'صندوق تسویه را انتخاب کنید' })
        const debt = managerDebt()
        if (amt > debt) return sendJSON(res, 400, { error: `طلب مدیر ${debt} ریال است؛ بیشتر قابل تسویه نیست` })
        addFundTxn(+b.fundId, 'manager_settle', amt, { ...d, note: `تسویه‌ی مدیر هنگام تحویل به ${b.incomingName.trim()}`, by: user.id })
        settled = amt
      }
      const outgoing = getSetting('managerName', '') || (b.outgoingName || '').trim()
      db.prepare(`INSERT INTO manager_handovers(outgoing_name,incoming_name,j_date,g_date,settled_amount,note,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(outgoing, b.incomingName.trim(), d.j_date, d.g_date, settled, (b.note || '').trim(), nowISO())
      setSetting('managerName', b.incomingName.trim())
      return sendJSON(res, 200, { ok: true, remainingDebt: managerDebt() })
    }
    if (path === '/api/manager/name' && M === 'POST') {
      const b = await jbody(req); setSetting('managerName', (b.name || '').trim())
      return sendJSON(res, 200, { ok: true })
    }

    // ---- گزارش‌ها ----
    if (path === '/api/report/dashboard' && M === 'GET') return sendJSON(res, 200, dashboard())
    if (path === '/api/report/debtors' && M === 'GET') return sendJSON(res, 200, debtorsReport())
    if (path === '/api/report/unit-ledger' && M === 'GET') return sendJSON(res, 200, unitLedgerReport())
    if (path === '/api/report/unit-statement' && M === 'GET') { const r = unitStatement(+Q.unitId); return r ? sendJSON(res, 200, r) : sendJSON(res, 404, { error: 'واحد یافت نشد' }) }
    if (path === '/api/report/fund' && M === 'GET') { const r = fundReport(+Q.fundId); return r ? sendJSON(res, 200, r) : sendJSON(res, 404, { error: 'صندوق یافت نشد' }) }
    if (path === '/api/report/income' && M === 'GET') return sendJSON(res, 200, incomeStatement(Q.from, Q.to))
    if (path === '/api/report/funds-overview' && M === 'GET') return sendJSON(res, 200, fundsOverview())
    if (path === '/api/report/journal' && M === 'GET') return sendJSON(res, 200, journalReport(Q))
    if (path === '/api/audit' && M === 'GET') {
      const w = [], a = []
      if (Q.entity) { w.push('entity=?'); a.push(Q.entity) }
      if (Q.entityId) { w.push('entity_id=?'); a.push(+Q.entityId) }
      if (Q.action) { w.push('action=?'); a.push(Q.action) }
      const rows = db.prepare(`SELECT * FROM audit_log ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(500, +Q.limit || 200)}`).all(...a)
      return sendJSON(res, 200, rows.map(r => ({ ...r, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, body: r.body_json ? JSON.parse(r.body_json) : null, before_json: undefined, after_json: undefined, body_json: undefined })))
    }
    if (path === '/api/report/ledger-accounts' && M === 'GET') return sendJSON(res, 200, ledgerAccounts())
    if (path === '/api/report/ledger' && M === 'GET') { const r = generalLedger(Q.type, Q.id, Q.from || '', Q.to || ''); return r ? sendJSON(res, 200, r) : sendJSON(res, 404, { error: 'حساب یافت نشد' }) }
    if (path === '/api/report/voucher' && M === 'GET') { const r = voucherOf(Q.dtype, +Q.id); return r ? sendJSON(res, 200, r) : sendJSON(res, 404, { error: 'سند یافت نشد' }) }
    if (path === '/api/report/manager' && M === 'GET') return sendJSON(res, 200, managerReport(Q.from, Q.to))
    if (path === '/api/report/balance' && M === 'GET') return sendJSON(res, 200, balanceCheck())
    if (path === '/api/report/fundpay' && M === 'GET') return sendJSON(res, 200, fundPaymentsReport(Q.from, Q.to))
    if (path === '/api/report/periods' && M === 'GET') {
      const out = []; let p = curPeriod()
      for (let i = 0; i < 24; i++) { out.push({ period: p, fa: periodFa(p), from: periodFirstG(p), to: periodFirstG(shiftPeriod(p, 1)) }); p = shiftPeriod(p, -1) }
      return sendJSON(res, 200, out)
    }

    // ---- خروجی CSV ----
    if (path.startsWith('/api/export/') && M === 'GET') {
      const kind = path.slice('/api/export/'.length)
      let name = 'export.csv', body = ''
      if (kind === 'invoices') {
        name = 'faktorha.csv'
        body = csv(['ردیف', 'عنوان', 'دسته', 'تاریخ', 'مبلغ (ریال)', 'روش تسهیم', 'نوع هزینه', 'صندوق', 'وصول‌شده', 'مانده', 'وضعیت'],
          listInvoices(Q).map(i => [i.id, i.title, i.categoryName, i.j_date, i.amount, i.methodFa, i.kindFa, i.fundName, i.collected, i.remaining, i.status === 'settled' ? 'تسویه' : 'باز']))
      } else if (kind === 'payments') {
        name = 'daryafti-ha.csv'
        const rows = db.prepare(`SELECT p.*, u.number, u.resident_name, f.name fund_name FROM payments p
          JOIN units u ON u.id=p.unit_id LEFT JOIN funds f ON f.id=p.fund_id WHERE p.is_opening=0 ORDER BY p.g_date DESC, p.id DESC`).all()
        body = csv(['ردیف', 'واحد', 'ساکن', 'تاریخ', 'مبلغ (ریال)', 'صندوق', 'روش', 'توضیح'],
          rows.map(p => [p.id, p.number, p.resident_name, p.j_date, p.amount, p.fund_name, p.method, p.note]))
      } else if (kind === 'debtors') {
        name = 'bedehkaran.csv'
        body = csv(['واحد', 'ساکن', 'تلفن', 'بدهی (ریال)', 'قدمت (روز)', 'باکت'],
          debtorsReport().rows.map(r => [r.number, r.resident_name, r.phone, r.debt, r.aging ? r.aging.days : '', r.aging ? r.aging.bucket : '']))
      } else if (kind === 'units') {
        name = 'vahedha.csv'
        body = csv(['شماره', 'طبقه', 'متراژ', 'نفرات', 'ساکن', 'تلفن', 'وضعیت', 'شارژ ماهانه', 'بدهی (ریال)'],
          unitsWithBalance().map(u => [u.number, u.floor, u.area, u.occupants, u.resident_name, u.phone, u.occupied ? 'پر' : 'خالی', unitChargeAt(u, curPeriod()), u.debt]))
      } else if (kind === 'unit') {
        const c = unitCard(+Q.id); if (!c) return sendJSON(res, 404, { error: 'واحد یافت نشد' })
        name = `vahed-${c.unit.number}.csv`
        body = csv(['نوع', 'تاریخ', 'شرح', 'مبلغ (ریال)', 'پرداخت‌شده', 'مانده'],
          [...c.shares.map(s => ['سهم', s.j_date, s.title, s.share_amount, s.paid, s.remaining]),
          ...c.payments.map(p => ['دریافتی', p.j_date, p.note || p.fund_name || '', p.amount, '', ''])])
      } else if (kind === 'manager') {
        const r = managerReport(Q.from, Q.to)
        name = 'gozaresh-modir.csv'
        body = csv(['بخش', 'شرح', 'مبلغ (ریال)', 'جزئیات'], [
          ...r.payments.byFund.map(f => ['دریافتی', f.name, f.amount, `${f.count} فقره`]),
          ['دریافتی', 'جمع کل', r.payments.total, ''],
          ...r.expenses.byCategory.map(c => ['هزینه', c.name, c.total, `ثابت ${c.fixed} · متغیر ${c.variable} · پیش‌بینی‌نشده ${c.unexpected}`]),
          ['هزینه', 'جمع کل', r.expenses.total, ''],
          ...r.fundFlow.map(f => ['صندوق', f.name, f.close, `اول ${f.open} · ورودی ${f.in} · خروجی ${f.out} · انتقال ${f.transfer}`]),
          ['مدیر', 'طلب مدیر از صندوق', r.managerDebt, '']
        ])
      } else if (kind === 'invoice') {
        const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(+Q.id)
        if (!inv) return sendJSON(res, 404, { error: 'فاکتور یافت نشد' })
        const shares = db.prepare(`SELECT s.*, u.number, u.resident_name FROM invoice_shares s JOIN units u ON u.id=s.unit_id WHERE s.invoice_id=?`).all(inv.id)
        name = `faktor-${inv.id}.csv`
        body = csv(['واحد', 'ساکن', 'سهم (ریال)', 'پرداخت‌شده', 'مانده'],
          shares.map(s => { const p = shareAllocated(s.id); return [s.number, s.resident_name, s.share_amount, p, s.share_amount - p] }))
      } else return sendJSON(res, 404, { error: 'خروجی یافت نشد' })
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` })
      return res.end(body)
    }

    // ---- کاربران ----
    if (path === '/api/users' && M === 'GET') {
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      return sendJSON(res, 200, db.prepare(`SELECT id,username,display_name,role,active,recovery_set_at FROM users ORDER BY id`).all()
        .map(r => ({ ...r, roleFa: ROLE_FA[r.role], hasRecovery: !!r.recovery_set_at })))
    }
    if (path === '/api/users' && M === 'POST') {
      const b = await jbody(req)
      if (!b.username || !b.displayName || !b.password || !ROLES.includes(b.role))
        return sendJSON(res, 400, { error: 'نام، نام کاربری، رمز و نقش لازم است' })
      if (String(b.password).length < PW_MIN) return sendJSON(res, 400, { error: PW_MIN_MSG })
      if (db.prepare(`SELECT 1 FROM users WHERE username=?`).get(b.username.trim()))
        return sendJSON(res, 400, { error: 'این نام کاربری قبلاً وجود دارد' })
      const { hash, salt } = hashPw(b.password)
      const id = Number(db.prepare(`INSERT INTO users(username,display_name,role,pass_hash,pass_salt,created_at) VALUES(?,?,?,?,?,?)`)
        .run(b.username.trim(), b.displayName.trim(), b.role, hash, salt, nowISO()).lastInsertRowid)
      return sendJSON(res, 200, { ok: true, id })
    }
    const userM = /^\/api\/users\/(\d+)$/.exec(path)
    if (userM && (M === 'PATCH' || M === 'DELETE')) {
      const uid = +userM[1]
      if (M === 'DELETE') {
        if (uid === user.id) return sendJSON(res, 400, { error: 'نمی‌توانید خودتان را حذف کنید' })
        db.prepare(`DELETE FROM users WHERE id=?`).run(uid); killSessionsOf(uid)
        return sendJSON(res, 200, { ok: true })
      }
      const b = await jbody(req)
      if (b.password != null) {
        if (String(b.password).length < PW_MIN) return sendJSON(res, 400, { error: PW_MIN_MSG })
        const { hash, salt } = hashPw(b.password); db.prepare(`UPDATE users SET pass_hash=?,pass_salt=? WHERE id=?`).run(hash, salt, uid)
        killSessionsOf(uid, uid === user.id ? getCookie(req, 'sid') : null)   // بقیهٔ دستگاه‌ها باید دوباره وارد شوند
      }
      if (b.active != null) {
        if (uid === user.id && !b.active) return sendJSON(res, 400, { error: 'نمی‌توانید حساب خودتان را غیرفعال کنید' })
        db.prepare(`UPDATE users SET active=? WHERE id=?`).run(b.active ? 1 : 0, uid); if (!b.active) killSessionsOf(uid)
      }
      if (b.displayName) db.prepare(`UPDATE users SET display_name=? WHERE id=?`).run(b.displayName.trim(), uid)
      if (b.username && b.username.trim()) {
        const un = b.username.trim()
        if (db.prepare(`SELECT 1 FROM users WHERE username=? AND id!=?`).get(un, uid)) return sendJSON(res, 400, { error: 'این نام کاربری قبلاً وجود دارد' })
        db.prepare(`UPDATE users SET username=? WHERE id=?`).run(un, uid)
      }
      if (b.role && ROLES.includes(b.role)) {
        if (uid === user.id && b.role !== 'admin') return sendJSON(res, 400, { error: 'نقش خودتان را نمی‌توانید از مدیر بردارید' })
        db.prepare(`UPDATE users SET role=? WHERE id=?`).run(b.role, uid)
      }
      return sendJSON(res, 200, { ok: true })
    }

    // ---- تنظیمات ----
    if (path === '/api/settings' && M === 'GET')
      return sendJSON(res, 200, {
        buildingName: getSetting('buildingName'), displayUnit: getSetting('displayUnit', 'toman'),
        totalUnits: +getSetting('totalUnits', '0') || 0,
        lateFeePercent: +getSetting('lateFeePercent', '0') || 0, lateFeeGraceDays: +getSetting('lateFeeGraceDays', '30') || 30,
        ...(isAdmin ? { lanAccess: getSetting('lanAccess', '1') === '1', backupPath: getSetting('backupPath'), defaultBackupDir: DEFAULT_BK_DIR, autoBackup: getSetting('autoBackup') === '1', lastBackupAt: getSetting('lastBackupAt', '') } : {})
      })
    if (path === '/api/settings' && M === 'POST') {
      const b = await jbody(req)
      if (b.buildingName != null) setSetting('buildingName', b.buildingName.trim())
      if (b.displayUnit != null) setSetting('displayUnit', b.displayUnit === 'rial' ? 'rial' : 'toman')
      if (b.totalUnits != null) setSetting('totalUnits', Math.max(0, Math.round(+b.totalUnits) || 0))
      if (b.lateFeePercent != null) setSetting('lateFeePercent', Math.max(0, +b.lateFeePercent || 0))
      if (b.lateFeeGraceDays != null) setSetting('lateFeeGraceDays', Math.max(0, Math.round(+b.lateFeeGraceDays) || 0))
      if (b.backupPath != null) setSetting('backupPath', b.backupPath.trim())
      if (b.autoBackup != null) setSetting('autoBackup', b.autoBackup ? '1' : '0')
      if (b.lanAccess != null && isAdmin) setSetting('lanAccess', b.lanAccess ? '1' : '0')
      return sendJSON(res, 200, { ok: true })
    }
    if (path === '/api/fs/dirs' && M === 'GET') {
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      let p = expandPath(Q.path || '') || homedir()
      try { if (!(await stat(p)).isDirectory()) p = dirname(p) } catch { p = homedir() }
      let dirs = []
      try {
        for (const n of await readdir(p)) {
          if (n.startsWith('.')) continue
          try { if ((await stat(join(p, n))).isDirectory()) dirs.push(n) } catch { }
        }
      } catch { return sendJSON(res, 400, { error: 'این پوشه قابل باز شدن نیست' }) }
      dirs.sort((a, b) => a.localeCompare(b, 'fa'))
      const parent = dirname(p)
      return sendJSON(res, 200, { path: p, parent: parent === p ? null : parent, home: homedir(), dirs })
    }

    // ---- پشتیبان و آپدیت ----
    if (path === '/api/backup' && M === 'POST') {
      const b = await jbody(req)
      return sendJSON(res, 200, { ok: true, ...(await backupToFolder((b.path || '').trim() || getSetting('backupPath'))) })
    }
    if (path === '/api/backups' && M === 'GET') {
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      return sendJSON(res, 200, await listBackups(Q.path || getSetting('backupPath')))
    }
    if ((path === '/api/backup/restore' || path === '/api/backup/inspect') && M === 'POST') {
      const b = await jbody(req)
      const m = /^data:[^;]*;base64,(.+)$/s.exec(b.dataUrl || '')
      if (!m) return sendJSON(res, 400, { error: 'فایل بکاپ ارسال نشد' })
      const buf = Buffer.from(m[1], 'base64')
      if (path === '/api/backup/inspect') { const r = await inspectBackup(buf); return sendJSON(res, 200, { ok: true, backup: r.backup, current: r.current }) }
      return sendJSON(res, 200, { ok: true, ...(await restoreBackup(buf)) })
    }
    if (path === '/api/backup/download' && M === 'GET') {
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="sakhteman-backup-${stamp()}.zip"` })
      return res.end(makeZip(await collectFiles()))
    }
    if (path === '/api/update/package' && M === 'GET') {
      if (PACKAGED) return sendJSON(res, 400, { error: 'در نسخه‌ی نصبی، آپدیت خودکار انجام می‌شود' })
      if (!isAdmin) return sendJSON(res, 403, { error: 'دسترسی ندارید' })
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="hesabdar sakhteman ${APP_VERSION}.zip"` })
      return res.end(makeZip(await collectCodeFiles()))
    }
    if (path === '/api/update' && M === 'POST') {
      if (PACKAGED) return sendJSON(res, 400, { error: 'در نسخه‌ی نصبی، آپدیت خودکار انجام می‌شود' })
      const b = await jbody(req)
      const m = /^data:[^;]*;base64,(.+)$/s.exec(b.dataUrl || '')
      if (!m) return sendJSON(res, 400, { error: 'فایل آپدیت ارسال نشد' })
      return sendJSON(res, 200, { ok: true, count: await applyUpdate(Buffer.from(m[1], 'base64')) })
    }

    // ---- صفحات چاپی (تولید PDF) — نیازمند ورود، همه‌ی نقش‌ها ----
    if (path.startsWith('/print/') && M === 'GET') {
      if (!user) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">نیاز به ورود</p>') }
      const um = /^\/print\/unit\/(\d+)$/.exec(path)
      if (um) {
        const c = unitCard(+um[1])
        if (!c) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">واحد یافت نشد</p>') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(printUnitHtml(c))
      }
      if (path === '/print/summary') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(printSummaryHtml(Q.period, Q.names === '1'))
      }
      if (path === '/print/expenses') {
        const r = expensesReport({ mode: Q.mode, from: Q.from, to: Q.to, projectId: Q.projectId, ids: Q.ids })
        if (r.error) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">داده‌ای نیست</p>') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(printExpensesHtml(r))
      }
      if (path === '/print/report/invoices') {
        let html = printInvoicesReportHtml(+Q.fund || 0, Q.status || '', Q.from || '', Q.to || '')
        if (Q.print === '1') html = html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body>')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(html)
      }
      const ppM = /^\/print\/payment\/(\d+)$/.exec(path)
      if (ppM) {
        const html = printPaymentHtml(+ppM[1])
        if (!html) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">رسید یافت نشد</p>') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(Q.print === '1' ? html.replace('</body>', '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body>') : html)
      }
      const piM = /^\/print\/invoice\/(\d+)$/.exec(path)
      if (piM) {
        const html = printInvoiceHtml(+piM[1])
        if (!html) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">فاکتور یافت نشد</p>') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(html)
      }
      const mtM = /^\/print\/meeting\/(\d+)$/.exec(path)
      if (mtM) {
        const html = printMeetingHtml(+mtM[1])
        if (!html) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p style="font-family:Tahoma;direction:rtl">جلسه یافت نشد</p>') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(html)
      }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('یافت نشد')
    }

    // ---- اسناد ----
    if (path.startsWith('/uploads/') && M === 'GET') {
      if (!user) { res.writeHead(401); return res.end('نیاز به ورود') }
      const rel = path.slice('/uploads/'.length)
      if (rel.includes('..')) { res.writeHead(400); return res.end('نامعتبر') }
      const fp = join(UP_DIR, rel)
      if (!fp.startsWith(UP_DIR) || !existsSync(fp)) { res.writeHead(404); return res.end('سند یافت نشد') }
      res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' })
      return res.end(await readFile(fp))
    }

    // ---- استاتیک ----
    const file = path === '/' ? '/index.html' : path
    const safe = join(PUB_DIR, '.' + file)
    if (existsSync(safe) && safe.startsWith(PUB_DIR) && M === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME[extname(safe).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
      return res.end(await readFile(safe))
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('صفحه یافت نشد')
  } catch (err) {
    console.error('خطا:', err); if (!res.headersSent) sendJSON(res, 500, { error: err.message || 'خطای سرور' })
  }
}

// تاریخ ورودی فرم → {g_date, j_date}
function jDates(b) {
  let jy = +b.jy, jm = +b.jm, jd = +b.jd
  if (!jy || !jm || !jd) { const t = todayJ(); jy = t.jy; jm = t.jm; jd = t.jd }
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1) return { error: 'تاریخ نامعتبر است' }
  // سقفِ روزِ هر ماهِ شمسی: ۶ ماهِ اول ۳۱، بعدی‌ها ۳۰، اسفند ۲۹ (و در سالِ کبیسه ۳۰)
  const maxD = jm <= 6 ? 31 : jm <= 11 ? 30 : (() => { const g = toGregorian(jy, 12, 30); const back = toJalaali(g.gy, g.gm, g.gd); return back.jm === 12 && back.jd === 30 ? 30 : 29 })()
  if (jd > maxD) return { error: `ماهِ ${faNum(jm)} سالِ ${faNum(jy)} فقط ${faNum(maxD)} روز دارد` }
  return { g_date: gDateStr(jy, jm, jd), j_date: jStr(jy, jm, jd) }
}

// ثبت یا ویرایش فاکتور با تسهیم کامل
async function saveInvoice(id, b, user) {
  const cur = id ? db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id) : null
  if (id && !cur) return { error: 'فاکتور یافت نشد' }
  if (cur && cur.is_opening) return { error: 'مانده‌ی اولیه از منوی «مانده اولیه» ویرایش شود' }
  const title = (b.title || '').trim() || (cur ? cur.title : '')
  if (!title) return { error: 'عنوان فاکتور لازم است' }
  const catId = +b.categoryId || (cur ? cur.category_id : 0)
  const cat = db.prepare(`SELECT * FROM expense_categories WHERE id=?`).get(catId)
  if (!cat) return { error: 'دسته‌ی هزینه را انتخاب کنید' }
  const method = METHODS.includes(b.method) ? b.method : (cur ? cur.method : cat.default_method)
  const includeVacant = b.includeVacant != null ? (b.includeVacant ? 1 : 0) : (cur ? cur.include_vacant : cat.include_vacant)
  const fundId = +b.fundId || (cur ? cur.fund_id : cat.default_fund_id)
  if (!db.prepare(`SELECT 1 FROM funds WHERE id=?`).get(fundId)) return { error: 'صندوق را انتخاب کنید' }
  // تاریخ خالی موقع ثبت ⇒ امروز؛ موقع ویرایش ⇒ تاریخ قبلی حفظ می‌شود
  const d = (b.jy || !cur) ? jDates(b) : { g_date: cur.g_date, j_date: cur.j_date }
  if (d.error) return d
  const fromFund = b.fromFund != null ? (b.fromFund ? 1 : 0) : (cur ? (cur.from_fund || 0) : 0)
  let amount = Math.round(+b.amount) || (cur && b.amount == null ? cur.amount : 0)
  if (cur && amount > 0) {
    const fp = invoiceFundPaid(cur.id)
    if (amount < fp && !(b.paidNow != null && Math.round(+b.paidNow) <= amount)) return { error: `مبلغ فاکتور نمی‌تواند کمتر از مبلغی باشد که از صندوق پرداخت شده (${pMoney(fp)} ${pUnitFa()}). اول پرداخت را اصلاح کنید.` }
  }
  let shares = []
  if (fromFund) {
    // هزینهٔ جاری از صندوق: فقط از صندوق کسر می‌شود و بین واحدها تقسیم/بدهکار نمی‌شود
    if (!(amount > 0)) return { error: 'مبلغ فاکتور باید بزرگ‌تر از صفر باشد' }
  } else {
    // در روش «نفرات+مشاعات»، واحدهای خالی هم وارد می‌شوند (سهمِ مشاعات می‌دهند؛ نفراتشان صفر)
    const units = eligibleUnits(!!includeVacant || method === 'occ_common')
    if (!units.length) return { error: 'هیچ واحد مشمولی وجود ندارد (ابتدا واحدها را وارد کنید)' }
    if (method === 'custom') {
      shares = computeShares(units, 'custom', amount, { custom: b.custom || {} })
      const total = sumShares(shares)
      if (amount > 0 && total !== amount) return { error: `جمع سهم‌ها (${total}) با مبلغ فاکتور (${amount}) برابر نیست` }
      amount = total
    } else if (method === 'per_unit_charge') {
      shares = computeShares(units, method, 0, { period: b.period || curPeriod() })
      amount = sumShares(shares)
    } else {
      if (!(amount > 0)) return { error: 'مبلغ فاکتور باید بزرگ‌تر از صفر باشد' }
      shares = computeShares(units, method, amount, {})
    }
    if (!(amount > 0)) return { error: 'مبلغ فاکتور باید بزرگ‌تر از صفر باشد' }
  }

  const kind = EXPENSE_KINDS.includes(b.expenseKind) ? b.expenseKind : (cur ? cur.expense_kind : 'variable')
  const paidByManager = b.paidByManager != null ? (b.paidByManager ? 1 : 0) : (cur ? cur.paid_by_manager : 0)
  let docFile = cur ? cur.doc_file : ''
  if (b.doc && b.doc.dataUrl) docFile = await saveDoc(b.doc, 'فاکتورها/' + safeFolder(cat.name))

  const docNo = b.docNo != null ? String(b.docNo).trim() : (cur ? cur.doc_no : '')
  let invId
  if (cur) {
    db.prepare(`UPDATE invoices SET title=?,category_id=?,amount=?,g_date=?,j_date=?,method=?,include_vacant=?,fund_id=?,
      paid_by_manager=?,expense_kind=?,vendor=?,note=?,doc_file=?,doc_no=?,from_fund=? WHERE id=?`)
      .run(title, catId, amount, d.g_date, d.j_date, method, includeVacant, fundId, paidByManager, kind,
        b.vendor ?? cur.vendor, b.note ?? cur.note, docFile, docNo, fromFund, id)
    invId = id
  } else {
    invId = Number(db.prepare(`INSERT INTO invoices
      (title,category_id,amount,g_date,j_date,method,include_vacant,fund_id,paid_by_manager,expense_kind,vendor,note,doc_file,doc_no,from_fund,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`)
      .run(title, catId, amount, d.g_date, d.j_date, method, includeVacant, fundId, paidByManager, kind,
        (b.vendor || '').trim(), (b.note || '').trim(), docFile, docNo, fromFund, user.id, nowISO()).lastInsertRowid)
  }
  // دو مدل:
  // • تقسیمی: ثبت فاکتور فقط تعهد است (سهمِ واحدها)؛ پرداخت از صندوق جداگانه انجام می‌شود.
  // • از صندوق (جاری): بین واحدها تقسیم نمی‌شود؛ مبلغ مستقیم از صندوق جاری کسر می‌گردد.
  writeShares(invId, shares) // در حالت از صندوق، shares خالی است → سهمی ساخته نمی‌شود
  // پرداختِ از صندوق (ثبت و ویرایش، هر دو حالت): «چقدر از صندوق پرداخت شد» را به مقدارِ هدف تنظیم می‌کند
  if (!paidByManager && b.paidNow != null) setFundPaid(invId, fundId, b.paidNow, d, user.id)
  return { ok: true, id: invId, amount, shareCount: shares.length, fromFund: !!fromFund, fundPaidNow: invoiceFundPaid(invId) }
}

// اگر پورت اشغال بود، پورت بعدی امتحان می‌شود (تا ۱۵ بار)
function listenWithFallback(port, tries = 15) {
  server.once('error', err => {
    if (err && err.code === 'EADDRINUSE' && tries > 0) return listenWithFallback(port + 1, tries - 1)
    console.error('اجرای سرور ناموفق:', err && err.message)
    if (process.send) { try { process.send({ type: 'error', message: String(err && err.message || err) }) } catch { } }
    else process.exit(1)
  })
  server.listen(port, () => {
    const a = server.address()
    PORT = (a && typeof a === 'object' && a.port) ? a.port : port
    console.log(`حسابدار ساختمان توی دید روی http://localhost:${PORT} بالا آمد`)
    if (process.send) { try { process.send({ type: 'ready', port: PORT }) } catch { } }
  })
}
try { backfillContractorFundTxns() } catch (e) { console.error('backfill صندوق پیمانکار ناموفق:', e.message) }
try { backfillProjectPayments() } catch (e) { console.error('backfill پرداخت پروژه ناموفق:', e.message) }
listenWithFallback(PORT)

if (process.env.NO_PKG !== '1' && !PACKAGED) { try { await refreshPackage() } catch (e) { console.error('ساخت بسته ناموفق:', e.message) } }
else { try { APP_VERSION = JSON.parse(await readFile(join(ROOT, 'version.json'), 'utf8')).version } catch { } }
// در اپ نصبی، نسخه‌ی واقعیِ نصب‌کننده (از Electron) مرجع است تا بررسیِ آپدیت درست کار کند
if (process.env.HS_APP_VERSION) APP_VERSION = 'v' + String(process.env.HS_APP_VERSION).replace(/^v/, '')

// بکاپِ خودکار: پیش‌فرض روشن (اگر کاربر صریحاً خاموش نکرده باشد)، پیش از هر تغییرِ خودکار، و روزانه
if (getSetting('autoBackup', '') === '') setSetting('autoBackup', '1')
const backupDue = () => { const l = getSetting('lastBackupAt', ''); return !l || (Date.now() - Date.parse(l)) > 20 * 3600 * 1000 }
if (getSetting('autoBackup') === '1' && backupDue()) await runAutoBackup('شروع برنامه')
setInterval(() => { if (getSetting('autoBackup') === '1' && backupDue()) runAutoBackup('روزانه') }, 3600 * 1000).unref()

autoIssueCurrentCharge()
autoIssueRecurring()
// هم‌سان‌سازیِ وضعیتِ همهٔ فاکتورها (پس از هر تغییرِ منطق) و کنترلِ سلامتِ دفاتر هنگام شروع
for (const r of db.prepare('SELECT id FROM invoices').all()) refreshInvoiceStatus(r.id)
try { const h = ledgerHealth(); console.log(h.ok ? '✓ کنترل سلامت دفاتر: سالم' : '⚠ کنترل سلامت دفاتر: ' + h.checks.filter(c => !c.ok).map(c => c.title + ' (' + c.count + ')').join('، ')) } catch (e) { console.error('کنترل سلامت:', e.message) }
