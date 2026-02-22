const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3335;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tofaat2024';

// ─── JSON File Storage ──────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'submissions.json');
const analyticsFile = path.join(dataDir, 'analytics.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ nextId: 1, submissions: [] }, null, 2));
if (!fs.existsSync(analyticsFile)) fs.writeFileSync(analyticsFile, JSON.stringify({ nextId: 1, visits: [] }, null, 2));

function readDB() {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function readAnalytics() {
    return JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
}

function writeAnalytics(data) {
    fs.writeFileSync(analyticsFile, JSON.stringify(data, null, 2));
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
           req.headers['x-real-ip'] ||
           req.socket.remoteAddress ||
           'unknown';
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

// ─── Middleware ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'tofaat-dev-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true }
}));

// Serve static files
app.use(express.static(__dirname));

// ─── Public API ─────────────────────────────────────────────────

// Page visit tracking (called from client-side script)
app.post('/api/track', (req, res) => {
    try {
        const { page, referrer, title, vid } = req.body;
        if (!page || page.includes('admin')) return res.json({ ok: true }); // don't track admin

        const ua = req.headers['user-agent'] || '';
        const { browser, device, os } = parseUserAgent(ua);
        const ip = getClientIp(req);

        const analytics = readAnalytics();
        analytics.visits.push({
            id: analytics.nextId++,
            timestamp: new Date().toISOString(),
            page: page.replace(/^\//, '') || 'index.html',
            title: title || '',
            referrer: referrer || '',
            ip,
            browser,
            device,
            os,
            vid: vid || null
        });

        // Keep last 10,000 visits
        if (analytics.visits.length > 10000) {
            analytics.visits = analytics.visits.slice(-10000);
        }

        writeAnalytics(analytics);
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: true });
    }
});

app.post('/api/submit', (req, res) => {
    try {
        const d = req.body;
        if (!d.first_name || !d.last_name || !d.phone) {
            return res.status(400).json({ success: false, message: 'שדות חובה חסרים' });
        }

        const rescueTools = Array.isArray(d.rescue_tools)
            ? d.rescue_tools.join(', ')
            : (d.rescue_tools || '');

        const db = readDB();
        const submission = {
            id: db.nextId++,
            created_at: new Date().toISOString(),
            first_name: d.first_name || '',
            last_name: d.last_name || '',
            id_number: d.id_number || '',
            gender: d.gender || '',
            phone: d.phone || '',
            city: d.city || '',
            region: d.region || '',
            vehicle_type: d.vehicle_type || '',
            vehicle_plate: d.vehicle_plate || '',
            birth_date: d.birth_date || '',
            occupation: d.occupation || '',
            rescue_tools: rescueTools,
            notes: d.notes || '',
            terms_agreed: d.terms_agreed ? 1 : 0
        };

        db.submissions.push(submission);
        writeDB(db);
        res.json({ success: true });
    } catch (err) {
        console.error('Submit error:', err);
        res.status(500).json({ success: false, message: 'שגיאת שרת' });
    }
});

// ─── Admin API ──────────────────────────────────────────────────

app.get('/api/admin/check', (req, res) => {
    res.json({ loggedIn: !!req.session.adminLoggedIn });
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.adminLoggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'שם משתמש או סיסמא שגויים' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

const requireAdmin = (req, res, next) => {
    if (!req.session.adminLoggedIn) return res.status(401).json({ error: 'Unauthorized' });
    next();
};

app.get('/api/admin/submissions', requireAdmin, (req, res) => {
    const db = readDB();
    const q = (req.query.q || '').toLowerCase();
    let rows = [...db.submissions].reverse(); // newest first

    if (q) {
        rows = rows.filter(r =>
            (r.first_name || '').toLowerCase().includes(q) ||
            (r.last_name || '').toLowerCase().includes(q) ||
            (r.phone || '').includes(q) ||
            (r.city || '').toLowerCase().includes(q) ||
            (r.id_number || '').includes(q)
        );
    }

    res.json(rows);
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const db = readDB();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStr = todayStr.slice(0, 7); // YYYY-MM

    const total = db.submissions.length;
    const today = db.submissions.filter(r => (r.created_at || '').startsWith(todayStr)).length;
    const thisMonth = db.submissions.filter(r => (r.created_at || '').startsWith(monthStr)).length;

    res.json({ total, today, thisMonth });
});

app.delete('/api/admin/submissions/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const db = readDB();
    db.submissions = db.submissions.filter(r => r.id !== id);
    writeDB(db);
    res.json({ success: true });
});

// Analytics API
app.get('/api/admin/analytics', requireAdmin, (req, res) => {
    const analytics = readAnalytics();
    const visits = [...analytics.visits].reverse(); // newest first

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStr = todayStr.slice(0, 7);

    const todayVisits = visits.filter(v => v.timestamp.startsWith(todayStr)).length;
    const weekVisits = visits.filter(v => v.timestamp >= weekAgo).length;
    const monthVisits = visits.filter(v => v.timestamp.startsWith(monthStr)).length;
    const totalVisits = visits.length;

    // Unique visitors (by localStorage visitor ID)
    const uniqueTotal = new Set(visits.filter(v => v.vid).map(v => v.vid)).size;
    const uniqueToday = new Set(visits.filter(v => v.vid && v.timestamp.startsWith(todayStr)).map(v => v.vid)).size;
    const uniqueWeek  = new Set(visits.filter(v => v.vid && v.timestamp >= weekAgo).map(v => v.vid)).size;
    const uniqueMonth = new Set(visits.filter(v => v.vid && v.timestamp.startsWith(monthStr)).map(v => v.vid)).size;

    // Page breakdown
    const pageMap = {};
    visits.forEach(v => {
        const p = v.page || 'index.html';
        if (!pageMap[p]) pageMap[p] = { page: p, visits: 0, today: 0 };
        pageMap[p].visits++;
        if (v.timestamp.startsWith(todayStr)) pageMap[p].today++;
    });
    const pages = Object.values(pageMap).sort((a, b) => b.visits - a.visits);

    // Browser breakdown
    const browserMap = {};
    visits.forEach(v => {
        const b = v.browser || 'אחר';
        browserMap[b] = (browserMap[b] || 0) + 1;
    });

    // Device breakdown
    const deviceMap = {};
    visits.forEach(v => {
        const d = v.device || 'מחשב';
        deviceMap[d] = (deviceMap[d] || 0) + 1;
    });

    // Recent visits (last 100)
    const recent = visits.slice(0, 100);

    res.json({
        stats: {
            today: todayVisits, week: weekVisits, month: monthVisits, total: totalVisits,
            uniqueToday, uniqueWeek, uniqueMonth, uniqueTotal
        },
        pages, browsers: browserMap, devices: deviceMap, recent
    });
});

app.get('/api/admin/export', requireAdmin, (req, res) => {
    const db = readDB();
    const rows = [...db.submissions].reverse();

    const headers = ['מזהה', 'תאריך הצטרפות', 'שם פרטי', 'שם משפחה', 'תעודת זהות', 'מין', 'טלפון', 'עיר', 'איזור', 'סוג רכב', 'מספר רכב', 'תאריך לידה', 'תחום עיסוק', 'כלי חילוץ', 'הערות'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const csvRows = rows.map(r => [
        r.id, r.created_at, r.first_name, r.last_name, r.id_number,
        r.gender, r.phone, r.city, r.region, r.vehicle_type,
        r.vehicle_plate, r.birth_date, r.occupation, r.rescue_tools, r.notes
    ].map(escape).join(','));

    const csv = '\uFEFF' + [headers.join(','), ...csvRows].join('\r\n');
    const filename = `tofaat-teva-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
});

app.listen(PORT, () => {
    console.log(`✅ תופעת טבע server running on http://localhost:${PORT}`);
    console.log(`📋 Admin panel: http://localhost:${PORT}/admin.html`);
});
