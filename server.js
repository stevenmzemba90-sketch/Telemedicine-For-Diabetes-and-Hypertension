// Simple local backend to accept queued consultation records
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const NOTIF_FILE = path.join(DATA_DIR, 'notifications.json');
const SMS_FILE = path.join(DATA_DIR, 'sms.json');

app.use(express.json({ limit: '2mb' }));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, '[]');
if (!fs.existsSync(NOTIF_FILE)) fs.writeFileSync(NOTIF_FILE, '[]');
if (!fs.existsSync(SMS_FILE)) fs.writeFileSync(SMS_FILE, '[]');

app.post('/queue', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    try {
        const current = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || [];
        const merged = current.concat(items);
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(merged, null, 2));
        res.json({ ok: true, saved: items.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/notify', (req, res) => {
    const item = req.body || {};
    try {
        const current = JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8')) || [];
        current.push(item);
        fs.writeFileSync(NOTIF_FILE, JSON.stringify(current, null, 2));
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/sms', async (req, res) => {
    const body = req.body || {};
    try {
        const current = JSON.parse(fs.readFileSync(SMS_FILE, 'utf8')) || [];
        current.push({ to: body.to, message: body.message, ts: new Date().toISOString() });
        fs.writeFileSync(SMS_FILE, JSON.stringify(current, null, 2));

        // If Twilio env vars are present, attempt to send SMS (best-effort)
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_FROM;
        if (sid && token && from && typeof fetch === 'function') {
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
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/queue', (req, res) => {
    try {
        const current = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || [];
        res.json({ ok: true, items: current });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Local queue server running on http://localhost:${PORT}`));
