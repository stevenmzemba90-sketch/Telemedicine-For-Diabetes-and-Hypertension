// Simple local backend to accept queued consultation records
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');

app.use(express.json({ limit: '2mb' }));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, '[]');

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

app.get('/queue', (req, res) => {
    try {
        const current = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || [];
        res.json({ ok: true, items: current });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Local queue server running on http://localhost:${PORT}`));
