const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// ─── Encryption (AES-256-GCM) ───────────────────────────────────
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function encrypt(text) {
    if (!ENCRYPTION_KEY || !text) return text;
    try {
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let enc = cipher.update(String(text), 'utf8', 'hex');
        enc += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `enc:${iv.toString('hex')}:${tag}:${enc}`;
    } catch { return text; }
}

function decrypt(text) {
    if (!ENCRYPTION_KEY || !text || !String(text).startsWith('enc:')) return text;
    try {
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const parts = String(text).split(':');
        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const enc = parts[3];
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch { return text; }
}

function decryptRow(r) {
    return { ...r, id_number: decrypt(r.id_number), birth_date: decrypt(r.birth_date), phone: decrypt(r.phone), vehicle_plate: decrypt(r.vehicle_plate) };
}

// ─── Storage Layer ───────────────────────────────────────────────
const USE_PG = !!process.env.DATABASE_URL;
let pool;

// JSON fallback (local dev)
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'submissions.json');
const analyticsFile = path.join(dataDir, 'analytics.json');

if (!USE_PG) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ nextId: 1, submissions: [] }, null, 2));
    if (!fs.existsSync(analyticsFile)) fs.writeFileSync(analyticsFile, JSON.stringify({ nextId: 1, visits: [] }, null, 2));
}

function readDB() { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); }
function writeDB(data) { fs.writeFileSync(dbFile, JSON.stringify(data, null, 2)); }
function readAnalytics() { return JSON.parse(fs.readFileSync(analyticsFile, 'utf8')); }
function writeAnalytics(data) { fs.writeFileSync(analyticsFile, JSON.stringify(data, null, 2)); }

async function initStorage() {
    if (USE_PG) {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        await pool.query(`
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                first_name TEXT DEFAULT '',
                last_name TEXT DEFAULT '',
                id_number TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                city TEXT DEFAULT '',
                region TEXT DEFAULT '',
                vehicle_type TEXT DEFAULT '',
                vehicle_plate TEXT DEFAULT '',
                birth_date TEXT DEFAULT '',
                occupation TEXT DEFAULT '',
                rescue_tools TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                terms_agreed INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS visits (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                page TEXT DEFAULT '',
                title TEXT DEFAULT '',
                referrer TEXT DEFAULT '',
                ip TEXT DEFAULT '',
                browser TEXT DEFAULT '',
                device TEXT DEFAULT '',
                os TEXT DEFAULT '',
                vid TEXT
            );
        `);
        console.log('✅ PostgreSQL connected');
    } else {
        console.log('📁 Using JSON file storage (local dev)');
    }
}

// ─── Storage functions ──────────────────────────────────────────

async function dbAddSubmission(data) {
    if (USE_PG) {
        const res = await pool.query(
            `INSERT INTO submissions (first_name, last_name, id_number, gender, phone, city, region, vehicle_type, vehicle_plate, birth_date, occupation, rescue_tools, notes, terms_agreed)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [data.first_name, data.last_name, data.id_number, data.gender, data.phone,
             data.city, data.region, data.vehicle_type, data.vehicle_plate, data.birth_date,
             data.occupation, data.rescue_tools, data.notes, data.terms_agreed]
        );
        return res.rows[0].id;
    } else {
        const db = readDB();
        const id = db.nextId++;
        db.submissions.push({ id, created_at: new Date().toISOString(), ...data });
        writeDB(db);
        return id;
    }
}

async function dbGetSubmissions(query) {
    if (USE_PG) {
        if (query) {
            const res = await pool.query(
                `SELECT * FROM submissions WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1 OR city ILIKE $1 OR id_number ILIKE $1 ORDER BY created_at DESC`,
                [`%${query}%`]
            );
            return res.rows.map(decryptRow);
        }
        const res = await pool.query('SELECT * FROM submissions ORDER BY created_at DESC');
        return res.rows.map(decryptRow);
    } else {
        const db = readDB();
        let rows = [...db.submissions].reverse().map(decryptRow);
        if (query) {
            const q = query.toLowerCase();
            rows = rows.filter(r =>
                (r.first_name || '').toLowerCase().includes(q) ||
                (r.last_name || '').toLowerCase().includes(q) ||
                (r.phone || '').includes(q) ||
                (r.city || '').toLowerCase().includes(q) ||
                (r.id_number || '').includes(q)
            );
        }
        return rows;
    }
}

async function dbDeleteSubmission(id) {
    if (USE_PG) {
        await pool.query('DELETE FROM submissions WHERE id = $1', [id]);
    } else {
        const db = readDB();
        db.submissions = db.submissions.filter(r => r.id !== id);
        writeDB(db);
    }
}

async function dbGetStats() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = todayStr.slice(0, 7);
    if (USE_PG) {
        const [tot, tod, mon] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM submissions'),
            pool.query('SELECT COUNT(*) FROM submissions WHERE created_at::date = CURRENT_DATE'),
            pool.query("SELECT COUNT(*) FROM submissions WHERE TO_CHAR(created_at, 'YYYY-MM') = $1", [monthStr])
        ]);
        return { total: +tot.rows[0].count, today: +tod.rows[0].count, thisMonth: +mon.rows[0].count };
    } else {
        const db = readDB();
        return {
            total: db.submissions.length,
            today: db.submissions.filter(r => (r.created_at || '').startsWith(todayStr)).length,
            thisMonth: db.submissions.filter(r => (r.created_at || '').startsWith(monthStr)).length
        };
    }
}

async function dbAddVisit(data) {
    if (USE_PG) {
        await pool.query(
            `INSERT INTO visits (page, title, referrer, ip, browser, device, os, vid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [data.page, data.title, data.referrer, data.ip, data.browser, data.device, data.os, data.vid || null]
        );
    } else {
        const analytics = readAnalytics();
        analytics.visits.push({ id: analytics.nextId++, timestamp: new Date().toISOString(), ...data });
        if (analytics.visits.length > 10000) analytics.visits = analytics.visits.slice(-10000);
        writeAnalytics(analytics);
    }
}

async function dbGetAnalytics() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthStr = todayStr.slice(0, 7);

    let visits;
    if (USE_PG) {
        const res = await pool.query('SELECT * FROM visits ORDER BY timestamp DESC LIMIT 10000');
        visits = res.rows.map(v => ({ ...v, timestamp: v.timestamp.toISOString() }));
    } else {
        visits = [...readAnalytics().visits].reverse();
    }

    const todayVisits   = visits.filter(v => v.timestamp.startsWith(todayStr)).length;
    const weekVisits    = visits.filter(v => new Date(v.timestamp) >= weekAgo).length;
    const monthVisits   = visits.filter(v => v.timestamp.startsWith(monthStr)).length;
    const totalVisits   = visits.length;
    const weekAgoStr    = weekAgo.toISOString();

    const uniqueTotal = new Set(visits.filter(v => v.vid).map(v => v.vid)).size;
    const uniqueToday = new Set(visits.filter(v => v.vid && v.timestamp.startsWith(todayStr)).map(v => v.vid)).size;
    const uniqueWeek  = new Set(visits.filter(v => v.vid && v.timestamp >= weekAgoStr).map(v => v.vid)).size;
    const uniqueMonth = new Set(visits.filter(v => v.vid && v.timestamp.startsWith(monthStr)).map(v => v.vid)).size;

    const pageMap = {};
    visits.forEach(v => {
        const p = v.page || 'index.html';
        if (!pageMap[p]) pageMap[p] = { page: p, visits: 0, today: 0 };
        pageMap[p].visits++;
        if (v.timestamp.startsWith(todayStr)) pageMap[p].today++;
    });

    const browserMap = {};
    const deviceMap = {};
    visits.forEach(v => {
        const b = v.browser || 'אחר'; browserMap[b] = (browserMap[b] || 0) + 1;
        const d = v.device || 'מחשב'; deviceMap[d] = (deviceMap[d] || 0) + 1;
    });

    return {
        stats: { today: todayVisits, week: weekVisits, month: monthVisits, total: totalVisits,
                 uniqueToday, uniqueWeek, uniqueMonth, uniqueTotal },
        pages: Object.values(pageMap).sort((a, b) => b.visits - a.visits),
        browsers: browserMap,
        devices: deviceMap,
        recent: visits.slice(0, 100)
    };
}

// ─── Express Setup ───────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3335;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tofaat2024';

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'tofaat-dev-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true }
}));
app.use(express.static(__dirname));

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
           req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
}

function parseUserAgent(ua) {
    if (!ua) return { browser: 'unknown', device: 'unknown', os: 'unknown' };
    let browser = 'אחר', device = 'מחשב', os = 'אחר';
    if (/mobile|android|iphone|ipad/i.test(ua)) device = 'נייד';
    else if (/tablet/i.test(ua)) device = 'טאבלט';
    if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'Chrome';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
    else if (/edge/i.test(ua)) browser = 'Edge';
    if (/windows/i.test(ua)) os = 'Windows';
    else if (/mac os/i.test(ua)) os = 'Mac';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad/i.test(ua)) os = 'iOS';
    else if (/linux/i.test(ua)) os = 'Linux';
    return { browser, device, os };
}

// ─── Routes ─────────────────────────────────────────────────────

app.post('/api/track', async (req, res) => {
    try {
        const { page, referrer, title, vid } = req.body;
        if (!page || page.includes('admin')) return res.json({ ok: true });
        const ua = req.headers['user-agent'] || '';
        const { browser, device, os } = parseUserAgent(ua);
        await dbAddVisit({
            page: page.replace(/^\//, '') || 'index.html',
            title: title || '', referrer: referrer || '',
            ip: getClientIp(req), browser, device, os, vid: vid || null
        });
        res.json({ ok: true });
    } catch (e) { res.json({ ok: true }); }
});

app.post('/api/submit', async (req, res) => {
    try {
        const d = req.body;
        if (!d.first_name || !d.last_name || !d.phone)
            return res.status(400).json({ success: false, message: 'שדות חובה חסרים' });

        const rescueTools = Array.isArray(d.rescue_tools)
            ? d.rescue_tools.join(', ') : (d.rescue_tools || '');

        await dbAddSubmission({
            first_name: d.first_name || '', last_name: d.last_name || '',
            id_number: encrypt(d.id_number || ''), gender: d.gender || '',
            phone: encrypt(d.phone || ''), city: d.city || '', region: d.region || '',
            vehicle_type: d.vehicle_type || '', vehicle_plate: encrypt(d.vehicle_plate || ''),
            birth_date: encrypt(d.birth_date || ''), occupation: d.occupation || '',
            rescue_tools: rescueTools, notes: d.notes || '',
            terms_agreed: d.terms_agreed ? 1 : 0
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Submit error:', err);
        res.status(500).json({ success: false, message: 'שגיאת שרת' });
    }
});

app.get('/api/admin/check', (req, res) => res.json({ loggedIn: !!req.session.adminLoggedIn }));

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.adminLoggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'שם משתמש או סיסמא שגויים' });
    }
});

app.post('/api/admin/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });

const requireAdmin = (req, res, next) => {
    if (!req.session.adminLoggedIn) return res.status(401).json({ error: 'Unauthorized' });
    next();
};

app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
    try {
        const rows = await dbGetSubmissions((req.query.q || '').toLowerCase() || null);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try { res.json(await dbGetStats()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
    try {
        await dbDeleteSubmission(parseInt(req.params.id));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    try { res.json(await dbGetAnalytics()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/member-stats', requireAdmin, async (req, res) => {
    try {
        const rows = await dbGetSubmissions(null);
        const stats = { gender: {}, city: {}, region: {}, vehicle_type: {}, rescue_tools: {}, occupation: {}, birth_year: {} };
        rows.forEach(r => {
            if (r.gender) stats.gender[r.gender] = (stats.gender[r.gender] || 0) + 1;
            if (r.city) stats.city[r.city] = (stats.city[r.city] || 0) + 1;
            if (r.region) stats.region[r.region] = (stats.region[r.region] || 0) + 1;
            if (r.vehicle_type) stats.vehicle_type[r.vehicle_type] = (stats.vehicle_type[r.vehicle_type] || 0) + 1;
            if (r.occupation) stats.occupation[r.occupation] = (stats.occupation[r.occupation] || 0) + 1;
            // Rescue tools - split by comma
            if (r.rescue_tools) {
                r.rescue_tools.split(',').map(t => t.trim()).filter(Boolean).forEach(tool => {
                    stats.rescue_tools[tool] = (stats.rescue_tools[tool] || 0) + 1;
                });
            }
            // Birth year
            if (r.birth_date) {
                const match = r.birth_date.match(/(\d{4})/);
                if (match) {
                    const year = match[1];
                    stats.birth_year[year] = (stats.birth_year[year] || 0) + 1;
                }
            }
        });
        res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
    try {
        const rows = await dbGetSubmissions(null);
        const headers = ['מזהה', 'תאריך הצטרפות', 'שם פרטי', 'שם משפחה', 'תעודת זהות', 'מין', 'טלפון', 'עיר', 'איזור', 'סוג רכב', 'מספר רכב', 'תאריך לידה', 'תחום עיסוק', 'כלי חילוץ', 'הערות'];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="tofaat-teva-${new Date().toISOString().split('T')[0]}.xlsx"`);

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
        workbook.creator = 'תופעת טבע';

        const sheet = workbook.addWorksheet('חברים', {
            views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
            properties: { defaultRowHeight: 22 }
        });

        const colWidths = [8, 18, 14, 14, 14, 8, 14, 14, 12, 12, 12, 14, 14, 16, 20];
        const colKeys = ['id','created_at','first_name','last_name','id_number','gender','phone','city','region','vehicle_type','vehicle_plate','birth_date','occupation','rescue_tools','notes'];
        sheet.columns = headers.map((h, i) => ({ header: h, key: colKeys[i], width: colWidths[i] }));

        // Reusable styles
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
        const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12, name: 'Arial' };
        const rtlAlign = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
        const headerBorder = { top: { style: 'thin', color: { argb: 'FF1B5E20' } }, bottom: { style: 'medium', color: { argb: 'FF1B5E20' } }, left: { style: 'thin', color: { argb: 'FF1B5E20' } }, right: { style: 'thin', color: { argb: 'FF1B5E20' } } };
        const dataBorder = { top: { style: 'thin', color: { argb: 'FFE0E0E0' } }, bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }, left: { style: 'thin', color: { argb: 'FFE0E0E0' } }, right: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
        const dataFont = { size: 11, name: 'Arial' };
        const evenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
        const oddFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.height = 30;
        headerRow.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = rtlAlign; cell.border = headerBorder; });
        headerRow.commit();

        // Stream data rows one by one
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const dataRow = sheet.addRow({ id: r.id, created_at: r.created_at, first_name: r.first_name, last_name: r.last_name, id_number: r.id_number, gender: r.gender, phone: r.phone, city: r.city, region: r.region, vehicle_type: r.vehicle_type, vehicle_plate: r.vehicle_plate, birth_date: r.birth_date, occupation: r.occupation, rescue_tools: r.rescue_tools, notes: r.notes });
            const fill = i % 2 === 0 ? evenFill : oddFill;
            dataRow.eachCell({ includeEmpty: true }, cell => { cell.fill = fill; cell.font = dataFont; cell.alignment = rtlAlign; cell.border = dataBorder; });
            dataRow.commit();
        }

        sheet.autoFilter = { from: 'A1', to: 'O1' };
        await workbook.commit();
    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

// ─── Start ───────────────────────────────────────────────────────
initStorage().then(() => {
    app.listen(PORT, () => {
        console.log(`✅ תופעת טבע server running on http://localhost:${PORT}`);
        console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
        console.log(`💾 Storage: ${USE_PG ? 'PostgreSQL' : 'JSON files'}`);
    });
}).catch(err => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
});
