// Backend with SQLite for persistent storage, file uploads, chat/messages and login history
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 4000;

// enable CORS so system can be accessed from outside campus (configurable)
const cors = require('cors');
app.use(cors());

app.use(express.json({ limit: '5mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const DB_FILE = path.join(DATA_DIR, 'telemed.db');
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        role TEXT,
        ts TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS consultations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_code TEXT,
        patient_name TEXT,
        age INTEGER,
        sex TEXT,
        village TEXT,
        contact_primary TEXT,
        contact_secondary TEXT,
        fee INTEGER,
        created_by TEXT,
        cashier_registered_at TEXT,
        provider_notes TEXT,
        medication_details TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_code TEXT,
        patient_name TEXT,
        sender TEXT,
        message TEXT,
        ts TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        payload TEXT,
        ts TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        message TEXT,
        targets TEXT,
        created_by TEXT,
        ts TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_code TEXT,
        patient_name TEXT,
        filename TEXT,
        originalname TEXT,
        path TEXT,
        uploader TEXT,
        ts TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_number TEXT,
        message TEXT,
        ts TEXT
    )`);
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage });

function genCode() {
    return 'C' + Date.now().toString(36).toUpperCase().slice(-8);
}

app.post('/login', (req, res) => {
    const { name, email, role } = req.body || {};
    const ts = new Date().toISOString();
    db.run(`INSERT INTO logins (name,email,role,ts) VALUES (?,?,?,?)`, [name, email, role, ts], function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, id: this.lastID });
    });
});

app.get('/admin/logins', (req, res) => {
    db.all(`SELECT * FROM logins ORDER BY ts DESC LIMIT 1000`, [], (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, rows });
    });
});

app.post('/consultation', (req, res) => {
    const body = req.body || {};
    const consultation_code = body.consultation_code || genCode();
    const ts = new Date().toISOString();
    db.run(`INSERT INTO consultations (consultation_code,patient_name,age,sex,village,contact_primary,contact_secondary,fee,created_by,cashier_registered_at,provider_notes,medication_details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [consultation_code, body.name || body.patient_name, body.age || null, body.sex || null, body.village || null, body.contact1 || body.contact_primary || null, body.contact2 || body.contact_secondary || null, body.fee || 0, body.created_by || null, ts, body.provider_notes || null, body.medication_details || null],
        function (err) {
            if (err) return res.status(500).json({ ok: false, error: err.message });
            res.json({ ok: true, id: this.lastID, consultation_code });
        });
});

app.get('/consultations', (req, res) => {
    db.all(`SELECT * FROM consultations ORDER BY cashier_registered_at DESC LIMIT 2000`, [], (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, data: rows });
    });
});

app.post('/message', (req, res) => {
    const { consultation_code, patient_name, sender, message } = req.body || {};
    const ts = new Date().toISOString();
    db.run(`INSERT INTO messages (consultation_code,patient_name,sender,message,ts) VALUES (?,?,?,?,?)`, [consultation_code || null, patient_name || null, sender || 'cashier', message || '', ts], function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, id: this.lastID, ts });
    });
});

app.get('/messages', (req, res) => {
    const { consultation_code, patient_name } = req.query;
    let sql = `SELECT * FROM messages`;
    const params = [];
    if (consultation_code) { sql += ` WHERE consultation_code = ?`; params.push(consultation_code); }
    else if (patient_name) { sql += ` WHERE patient_name = ?`; params.push(patient_name); }
    sql += ` ORDER BY ts ASC LIMIT 2000`;
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, data: rows });
    });
});

app.post('/upload', upload.single('file'), (req, res) => {
    const file = req.file;
    const { consultation_code, patient_name, uploader } = req.body || {};
    if (!file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const ts = new Date().toISOString();
    db.run(`INSERT INTO files (consultation_code,patient_name,filename,originalname,path,uploader,ts) VALUES (?,?,?,?,?,?,?)`, [consultation_code || null, patient_name || null, file.filename, file.originalname, file.path, uploader || null, ts], function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, id: this.lastID, file: { filename: file.filename, originalname: file.originalname, path: file.path } });
    });
});

app.get('/files', (req, res) => {
    const { consultation_code, patient_name } = req.query;
    let sql = `SELECT * FROM files`;
    const params = [];
    if (consultation_code) { sql += ` WHERE consultation_code = ?`; params.push(consultation_code); }
    else if (patient_name) { sql += ` WHERE patient_name = ?`; params.push(patient_name); }
    sql += ` ORDER BY ts DESC LIMIT 200`;
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, data: rows });
    });
});

app.post('/sms', async (req, res) => {
    const body = req.body || {};
    const ts = new Date().toISOString();
    db.run(`INSERT INTO sms (to_number,message,ts) VALUES (?,?,?)`, [body.to, body.message, ts], function (err) {
        if (err) console.error('SMS insert failed', err.message);
    });
    // also keep a file log for compatibility
    try {
        const SMS_FILE = path.join(DATA_DIR, 'sms.json');
        const current = fs.existsSync(SMS_FILE) ? JSON.parse(fs.readFileSync(SMS_FILE, 'utf8')) : [];
        current.push({ to: body.to, message: body.message, ts });
        fs.writeFileSync(SMS_FILE, JSON.stringify(current, null, 2));
    } catch (e) { console.error(e); }
    // also persist as a chat message so admin chatbot histories can be reconstructed
    try {
        const consultation_code = body.consultation_code || null;
        const patient_name = body.patient_name || null;
        const sender = body.sender || 'admin-sms';
        const message = body.message || '';
        db.run(`INSERT INTO messages (consultation_code,patient_name,sender,message,ts) VALUES (?,?,?,?,?)`, [consultation_code, patient_name, sender, message, ts], function (err) {
            if (err) console.error('messages insert failed', err.message);
        });
    } catch (e) { console.error(e); }
    // Attempt Twilio only if configured
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (sid && token && from) {
        try {
            const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
            const params = new URLSearchParams();
            params.append('From', from);
            params.append('To', body.to);
            params.append('Body', body.message);
            const resp = await fetch(url, { method: 'POST', body: params, headers: { 'Authorization': 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') } });
            const rj = await resp.text();
            return res.json({ ok: true, sent: true, resp: rj });
        } catch (e) {
            console.error('Twilio send failed', e);
        }
    }
    res.json({ ok: true, queued: true });
});


// receive generic notifications from clients (admin orchestrates communication)
app.post('/notify', (req, res) => {
    const { role, payload } = req.body || {};
    const ts = new Date().toISOString();
    db.run(`INSERT INTO notifications (role,payload,ts) VALUES (?,?,?)`, [role || null, JSON.stringify(payload || {}), ts], function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, id: this.lastID });
    });
});

// admin posts schedule -> persist and create notifications entries for targets
app.post('/schedule', (req, res) => {
    const { date, message, targets, created_by } = req.body || {};
    const ts = new Date().toISOString();
    const targetsStr = Array.isArray(targets) ? targets.join(',') : (targets || '');
    db.run(`INSERT INTO schedules (date,message,targets,created_by,ts) VALUES (?,?,?,?,?)`, [date || null, message || null, targetsStr, created_by || null, ts], function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        const scheduleId = this.lastID;
        // also insert notification rows for each target so dashboards can pick them up
        const list = (targets || []).slice ? (targets || []) : (targetsStr ? targetsStr.split(',') : []);
        list.forEach(t => {
            db.run(`INSERT INTO notifications (role,payload,ts) VALUES (?,?,?)`, [t, JSON.stringify({ type: 'schedule', scheduleId, date, message }), ts], function (e) { if (e) console.error('notif insert', e.message); });
        });
        res.json({ ok: true, id: scheduleId });
    });
});

app.get('/queue', (req, res) => {
    db.all(`SELECT * FROM consultations ORDER BY cashier_registered_at DESC LIMIT 2000`, [], (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, items: rows });
    });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
