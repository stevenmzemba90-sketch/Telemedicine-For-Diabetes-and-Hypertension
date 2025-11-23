// app.js — Supabase-enabled workflow with localStorage fallback
// Configuration: create a `config.js` (ignored by git) or set `window.APP_CONFIG` before this script loads.
// See `config.example.js` for the format.
const DEFAULT_SUPABASE_URL = "https://your-project.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "your-anon-key";

// Read runtime config from `window.APP_CONFIG` if provided; otherwise fall back to constants above.
const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY;

const useLocalFallback = SUPABASE_URL === DEFAULT_SUPABASE_URL || SUPABASE_ANON_KEY === DEFAULT_SUPABASE_ANON_KEY;

let supabaseClient = null;
if (!useLocalFallback) {
    // Initialize supabase client (guarded) — support multiple CDN patterns
    try {
        if (typeof createClient === 'function') {
            supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            console.warn('Supabase client factory not found on the page.');
            supabaseClient = null;
        }
    } catch (err) {
        console.error('Supabase init error:', err);
        supabaseClient = null;
    }
}

// Utilities
function generateConsultationCode() {
    return 'C' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
}

// Date helpers and aggregation utilities
function parseISO(d) { return d ? new Date(d) : null; }
function isSameDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function daysBetween(a, b) { return Math.floor((b - a) / (1000 * 60 * 60 * 24)); }

function computeTotals(cons) {
    const now = new Date();
    let dayTotal = 0, weekTotal = 0, monthTotal = 0;
    let dayCount = 0, weekCount = 0, monthCount = 0;
    (cons || []).forEach(r => {
        const d = parseISO(r.cashier_registered_at);
        if (!d) return;
        const fee = Number(r.fee || 0) || 0;
        // same day
        if (isSameDay(d, now)) { dayTotal += fee; dayCount++; }
        // within last 7 days (including today)
        if (daysBetween(d, now) <= 6 && daysBetween(d, now) >= 0) { weekTotal += fee; weekCount++; }
        // same month
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) { monthTotal += fee; monthCount++; }
    });
    return { day: { total: dayTotal, count: dayCount }, week: { total: weekTotal, count: weekCount }, month: { total: monthTotal, count: monthCount } };
}

function groupPatients(cons) {
    // return map { name: [{records}] }
    const map = {};
    (cons || []).forEach(r => {
        const name = r.patient_name || 'Unknown';
        map[name] = map[name] || [];
        map[name].push(r);
    });
    return map;
}

// Backend relay (optional local server to persist queue)
const BACKEND_URL = 'http://localhost:4000/queue';

// Backend helper endpoints for notifications and sms
const BACKEND_BASE = BACKEND_URL.replace(/\/queue$/, '/');
const BACKEND_NOTIFY = BACKEND_BASE + 'notify';
const BACKEND_SMS = BACKEND_BASE + 'sms';

// Outbox helpers: items waiting to be pushed to Supabase
function outboxGet() { return _lsGet('outbox'); }
function outboxSet(arr) { _lsSet('outbox', arr); }
function addToOutbox(item) { const o = outboxGet(); o.push(item); outboxSet(o); }

async function syncOutbox() {
    const items = outboxGet();
    if (!items.length) return;
    // Try Supabase first if configured
    if (supabaseClient) {
        for (let i = items.length - 1; i >= 0; i--) {
            try {
                const { data, error } = await supabaseClient.from('consultations').insert(items[i]).select().single();
                if (!error) {
                    items.splice(i, 1);
                }
            } catch (err) {
                console.warn('Sync error', err);
            }
        }
        outboxSet(items);
        return;
    }
    // Otherwise attempt to POST to local backend if available
    try {
        const res = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) });
        if (res.ok) {
            outboxSet([]);
        }
    } catch (err) {
        console.warn('No backend to sync to yet', err);
    }
}

// Notification helpers (post to local backend which will persist notifications)
async function notifyRole(role, payload) {
    try {
        await fetch(BACKEND_NOTIFY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, payload, ts: new Date().toISOString() }) });
    } catch (err) {
        console.warn('Notify backend failed', err);
    }
}

async function sendSMS(phone, message) {
    if (!phone) return;
    try {
        await fetch(BACKEND_SMS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, message }) });
    } catch (err) {
        console.warn('SMS backend failed', err);
    }
}

// Admin schedule send helper
async function sendSchedule({ date, message, targets = ['cashier', 'provider', 'pharmacist'] }) {
    const payload = { date, message };
    if (supabaseClient) {
        try { await supabaseClient.from('schedules').insert({ date, message }).select(); } catch (e) { }
    }
    for (const r of targets) notifyRole(r, { type: 'schedule', date, message });
}

// Local fallback storage helpers (simple simulation)
function _lsGet(key) {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : [];
}
function _lsSet(key, arr) {
    localStorage.setItem(key, JSON.stringify(arr));
}

// Users & session helpers (simple local auth fallback)
function usersGet() { return _lsGet('users'); }
function usersSet(u) { _lsSet('users', u); }
function addUser(user) { const u = usersGet(); u.push(user); usersSet(u); }
function findUserByEmail(email) { return usersGet().find(x => x.email === email); }
function setSession(sess) { localStorage.setItem('session', JSON.stringify(sess)); }
function getSession() { const s = localStorage.getItem('session'); return s ? JSON.parse(s) : null; }
function clearSession() { localStorage.removeItem('session'); }

async function registerPatient({ name, age, sex, village, contact1, contact2, hiv_status, fee, created_by }) {
    const code = generateConsultationCode();
    const record = {
        consultation_code: code,
        patient_name: name,
        age: age || null,
        sex: sex || null,
        village: village || null,
        contact_primary: contact1 || null,
        contact_secondary: contact2 || null,
        hiv_status: !!hiv_status,
        fee: fee ? Number(fee) : 0,
        created_by: created_by || null,
        cashier_registered_at: new Date().toISOString(),
        provider_notes: null,
        medication_refill: false,
        pharmacy_dispensed: false,
        admin_finalized: false,
        status: 'registered',
    };

    // Always save to local consultations log (immediate local copy)
    const local = _lsGet('consultations');
    local.push(record);
    _lsSet('consultations', local);

    // If supabase not configured, add to outbox and attempt to post to backend
    if (useLocalFallback || !supabaseClient) {
        addToOutbox(record);
        // try to POST to local backend relay
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([record]) }); } catch (e) { }
        return { data: record, error: null };
    }

    // Try to insert into Supabase, on failure queue to outbox
    try {
        const { data, error } = await supabaseClient.from('consultations').insert(record).select().single();
        if (error) {
            addToOutbox(record);
            return { data: record, error };
        }
        // success: ensure outbox synced
        await syncOutbox();
        return { data, error: null };
    } catch (err) {
        addToOutbox(record);
        return { data: record, error: err };
    }
}

async function providerUpdate({ consultation_code, notes, medication_refill }) {
    if (useLocalFallback || !supabaseClient) {
        const arr = _lsGet('consultations');
        const idx = arr.findIndex(r => r.consultation_code === consultation_code);
        if (idx === -1) return { error: 'Not found' };
        arr[idx].provider_notes = notes || arr[idx].provider_notes;
        arr[idx].medication_refill = !!medication_refill;
        arr[idx].provider_updated_at = new Date().toISOString();
        arr[idx].status = 'provider-updated';
        _lsSet('consultations', arr);
        // notify pharmacist and optionally send SMS to patient
        notifyRole('pharmacist', { consultation_code: consultation_code, patient_name: arr[idx].patient_name, notes: notes });
        sendSMS(arr[idx].contact_primary || arr[idx].contact_secondary || null, `Provider update for ${arr[idx].patient_name}: ${notes || 'No notes'}`);
        // post to backend queue for record-keeping
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'provider-update', consultation: arr[idx] }]) }); } catch (e) { }
        return { data: arr[idx], error: null };
    }

    const { data, error } = await supabaseClient
        .from('consultations')
        .update({ provider_notes: notes, medication_refill: medication_refill, status: 'provider-updated', provider_updated_at: new Date().toISOString() })
        .eq('consultation_code', consultation_code)
        .select()
        .single();

    if (!error && data) {
        notifyRole('pharmacist', { consultation_code: consultation_code, patient_name: data.patient_name, notes });
        sendSMS(data.contact_primary || data.contact || null, `Provider update for ${data.patient_name}: ${notes || 'No notes'}`);
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'provider-update', consultation: data }]) }); } catch (e) { }
    }

    return { data, error };
}

async function pharmacyUpdate({ consultation_code, dispensed }) {
    if (useLocalFallback || !supabaseClient) {
        const arr = _lsGet('consultations');
        const idx = arr.findIndex(r => r.consultation_code === consultation_code);
        if (idx === -1) return { error: 'Not found' };
        arr[idx].pharmacy_dispensed = !!dispensed;
        arr[idx].pharmacy_updated_at = new Date().toISOString();
        arr[idx].status = dispensed ? 'med-dispensed' : arr[idx].status;
        _lsSet('consultations', arr);
        // notify cashier and admin that medication was dispensed
        notifyRole('cashier', { consultation_code: consultation_code, patient_name: arr[idx].patient_name, dispensed });
        notifyRole('admin', { consultation_code: consultation_code, patient_name: arr[idx].patient_name, dispensed });
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'pharmacy-dispense', consultation: arr[idx] }]) }); } catch (e) { }
        return { data: arr[idx], error: null };
    }

    const { data, error } = await supabaseClient
        .from('consultations')
        .update({ pharmacy_dispensed: dispensed, pharmacy_updated_at: new Date().toISOString(), status: dispensed ? 'med-dispensed' : 'pharmacy-updated' })
        .eq('consultation_code', consultation_code)
        .select()
        .single();

    if (!error && data) {
        notifyRole('cashier', { consultation_code: consultation_code, patient_name: data.patient_name, dispensed });
        notifyRole('admin', { consultation_code: consultation_code, patient_name: data.patient_name, dispensed });
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'pharmacy-dispense', consultation: data }]) }); } catch (e) { }
    }

    return { data, error };
}

// Pharmacist edits medication details / refill info and uploads edited file to system
async function pharmacyEdit({ consultation_code, medication_details, refill_quantity, notes }) {
    if (useLocalFallback || !supabaseClient) {
        const arr = _lsGet('consultations');
        const idx = arr.findIndex(r => r.consultation_code === consultation_code);
        if (idx === -1) return { error: 'Not found' };
        arr[idx].pharmacy_edited_at = new Date().toISOString();
        arr[idx].pharmacy_notes = notes || arr[idx].pharmacy_notes || null;
        arr[idx].medication_details = medication_details || arr[idx].medication_details || null;
        arr[idx].refill_quantity = refill_quantity || arr[idx].refill_quantity || null;
        arr[idx].status = 'pharmacy-edited';
        _lsSet('consultations', arr);
        // notify admin and cashier that pharmacy uploaded edited file
        notifyRole('admin', { consultation_code, patient_name: arr[idx].patient_name, action: 'pharmacy-edited' });
        notifyRole('cashier', { consultation_code, patient_name: arr[idx].patient_name, action: 'pharmacy-edited' });
        // try backend persistence
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'pharmacy-edit', consultation: arr[idx] }]) }); } catch (e) { }
        // broadcast storage change
        localStorage.setItem('consultation-updated', new Date().toISOString());
        return { data: arr[idx], error: null };
    }

    const { data, error } = await supabaseClient
        .from('consultations')
        .update({ pharmacy_notes: notes, medication_details: medication_details, refill_quantity: refill_quantity, status: 'pharmacy-edited', pharmacy_edited_at: new Date().toISOString() })
        .eq('consultation_code', consultation_code)
        .select()
        .single();

    if (!error && data) {
        notifyRole('admin', { consultation_code, patient_name: data.patient_name, action: 'pharmacy-edited' });
        notifyRole('cashier', { consultation_code, patient_name: data.patient_name, action: 'pharmacy-edited' });
        try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'pharmacy-edit', consultation: data }]) }); } catch (e) { }
        localStorage.setItem('consultation-updated', new Date().toISOString());
    }

    return { data, error };
}

// Mark patient absent (admin) and store absent flag
async function markAbsent(consultation_code, absent = true) {
    if (useLocalFallback || !supabaseClient) {
        const arr = _lsGet('consultations');
        const idx = arr.findIndex(r => r.consultation_code === consultation_code);
        if (idx === -1) return { error: 'Not found' };
        arr[idx].absent = !!absent;
        arr[idx].absent_marked_at = new Date().toISOString();
        _lsSet('consultations', arr);
        localStorage.setItem('consultation-updated', new Date().toISOString());
        return { data: arr[idx], error: null };
    }

    const { data, error } = await supabaseClient.from('consultations').update({ absent: absent, absent_marked_at: new Date().toISOString() }).eq('consultation_code', consultation_code).select().single();
    if (!error && data) localStorage.setItem('consultation-updated', new Date().toISOString());
    return { data, error };
}

// Send reminder SMS to patient (admin action)
async function sendReminderToPatient(consultation_code, message) {
    // Look up contact and send via sendSMS helper
    const all = _lsGet('consultations');
    const rec = all.find(r => r.consultation_code === consultation_code);
    if (!rec) return { error: 'Not found' };
    const phone = rec.contact_primary || rec.contact_secondary || null;
    if (!phone) return { error: 'No phone number' };
    await sendSMS(phone, message || `Reminder: ${rec.patient_name} — ${message || 'Please attend your appointment.'}`);
    // persist reminder attempt to backend queue
    try { fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ action: 'reminder-sent', consultation_code, phone, message }]) }); } catch (e) { }
    return { data: true, error: null };
}

async function fetchAllConsultations() {
    if (useLocalFallback || !supabaseClient) {
        return { data: _lsGet('consultations'), error: null };
    }
    const { data, error } = await supabaseClient.from('consultations').select('*').order('created_at', { ascending: false });
    return { data, error };
}

// Wire UI
document.addEventListener('DOMContentLoaded', () => {
    const cashierForm = document.getElementById('cashier-form');
    const providerForm = document.getElementById('provider-form');
    const pharmacyForm = document.getElementById('pharmacy-form');
    const adminRefresh = document.getElementById('admin-refresh');
    const adminOutput = document.getElementById('admin-output');

    // Render admin consultations as accessible cards when `#admin-list` exists,
    // otherwise fallback to raw JSON output in `#admin-output` (rare).
    async function renderAdminItems(items) {
        const out = document.getElementById('admin-list');
        if (out) {
            if (!items || !items.length) {
                out.textContent = 'No consultations yet.';
                return;
            }
            out.innerHTML = '';
            items.forEach(it => {
                const div = document.createElement('div'); div.className = 'card';
                const title = document.createElement('h3'); title.textContent = `${it.patient_name} — ${it.consultation_code}`;
                const p = document.createElement('p');
                p.innerHTML = `Fee: <strong>${Number(it.fee || 0).toLocaleString()}</strong> — Registered: ${it.cashier_registered_at || '-'} `;
                const notes = document.createElement('p'); notes.style.marginTop = '8px'; notes.style.fontSize = '15px'; notes.textContent = `Provider notes: ${it.provider_notes || '-'} `;
                const meta = document.createElement('div'); meta.className = 'meta';
                meta.textContent = `Medication refill: ${it.medication_refill ? 'Yes' : 'No'} • Pharmacy dispensed: ${it.pharmacy_dispensed ? 'Yes' : 'No'} • Status: ${it.status || '-'}`;
                const btnAbsent = document.createElement('button'); btnAbsent.className = 'btn signup'; btnAbsent.textContent = it.absent ? 'Marked Absent' : 'Mark Absent'; btnAbsent.dataset.code = it.consultation_code;
                const btnRemind = document.createElement('button'); btnRemind.className = 'btn signin'; btnRemind.textContent = 'Remind Patient'; btnRemind.dataset.code = it.consultation_code;
                const ctrl = document.createElement('div'); ctrl.style.marginTop = '8px'; ctrl.appendChild(btnAbsent); ctrl.appendChild(btnRemind);
                div.appendChild(title); div.appendChild(p); div.appendChild(notes); div.appendChild(meta); div.appendChild(ctrl);
                out.appendChild(div);
            });
            return;
        }
        if (adminOutput) {
            // Preserve human-readable JSON output and keep it visible
            adminOutput.textContent = JSON.stringify(items, null, 2);
            adminOutput.style.display = '';
            adminOutput.style.whiteSpace = 'pre';
            adminOutput.style.fontFamily = 'monospace, monospace';
            return;
        }
    }

    cashierForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('cashier-patient-name').value.trim();
        const age = document.getElementById('cashier-age').value.trim();
        const sex = document.getElementById('cashier-sex').value;
        const village = document.getElementById('cashier-village').value.trim();
        const contact1 = document.getElementById('cashier-contact-1').value.trim();
        const contact2 = document.getElementById('cashier-contact-2').value.trim();
        const hiv = document.getElementById('cashier-hiv').checked;
        const res = await registerPatient({ name, age, sex, village, contact1, contact2, hiv_status: hiv });
        if (res.error) return alert('Error: ' + (res.error.message || res.error));
        alert('Registered. Consultation code: ' + res.data.consultation_code);
        cashierForm.reset();
    });

    providerForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('provider-consultation-code').value.trim();
        const notes = document.getElementById('provider-notes').value.trim();
        const refill = document.getElementById('provider-med-refill').checked;
        const res = await providerUpdate({ consultation_code: code, notes, medication_refill: refill });
        if (res.error) return alert('Error: ' + (res.error.message || res.error));
        alert('Provider update saved for ' + code);
        providerForm.reset();
    });

    pharmacyForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('pharm-consultation-code').value.trim();
        const disp = document.getElementById('pharm-dispensed').checked;
        const res = await pharmacyUpdate({ consultation_code: code, dispensed: disp });
        if (res.error) return alert('Error: ' + (res.error.message || res.error));
        alert('Pharmacy record updated for ' + code);
        pharmacyForm.reset();
    });

    adminRefresh?.addEventListener('click', async () => {
        const res = await fetchAllConsultations();
        if (res.error) return alert('Error: ' + (res.error.message || res.error));
        await renderAdminItems(res.data || []);
    });

    // Initial admin load (if admin-list exists render cards)
    // Allow pages to provide their own admin renderer by setting `window.ADMIN_CUSTOM_RENDERER = true`.
    if (document.getElementById('admin-list') && !window.ADMIN_CUSTOM_RENDERER) {
        (async () => { const r = await fetchAllConsultations(); if (!r.error) await renderAdminItems(r.data || []); })();
    }

    // Try to sync outbox when online
    window.addEventListener('online', () => { syncOutbox(); });
    if (navigator.onLine) syncOutbox();

    if (useLocalFallback) {
        console.warn('Supabase keys not set — using localStorage fallback. Edit app.js to add SUPABASE_URL and SUPABASE_ANON_KEY.');
    }
    // --- Simple client-side auth (localStorage) ---
    const showSigninBtn = document.getElementById('show-signin');
    const showSignupBtn = document.getElementById('show-signup');
    const signinForm = document.getElementById('signin-form');
    const signupForm = document.getElementById('signup-form');
    const authForms = document.getElementById('auth-forms');
    const userHeader = document.getElementById('user-header');
    const welcomeEl = document.getElementById('welcome');
    const signoutBtn = document.getElementById('signout');

    function showForm(which) {
        signinForm.style.display = which === 'signin' ? '' : 'none';
        signupForm.style.display = which === 'signup' ? '' : 'none';
    }

    showSigninBtn?.addEventListener('click', (e) => { e.preventDefault(); showForm('signin'); });
    showSignupBtn?.addEventListener('click', (e) => { e.preventDefault(); showForm('signup'); });

    // Signup handler
    signupForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('su-name').value.trim();
        const email = document.getElementById('su-email').value.trim().toLowerCase();
        const password = document.getElementById('su-password').value;
        const role = document.getElementById('su-role').value || 'cashier';
        if (!email || !password) return alert('Please provide email and password');
        if (findUserByEmail(email)) return alert('An account with that email already exists');
        const user = { name, email, password, role, created_at: new Date().toISOString() };
        addUser(user);
        setSession({ email: user.email, role: user.role, name: user.name });
        // Redirect to role dashboard
        window.location.href = roleToDashboard(user.role);
    });

    // Signin handler
    signinForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('si-email').value.trim().toLowerCase();
        const password = document.getElementById('si-password').value;
        const user = findUserByEmail(email);
        if (!user) return alert('User not found');
        if (user.password !== password) return alert('Invalid credentials');
        setSession({ email: user.email, role: user.role, name: user.name });
        window.location.href = roleToDashboard(user.role);
    });

    signoutBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        clearSession();
        window.location.href = './index.html';
    });

    function roleToDashboard(role) {
        switch ((role || '').toLowerCase()) {
            case 'provider': return './dashboard_provider.html';
            case 'pharmacist': return './dashboard_pharmacist.html';
            case 'admin': return './dashboard_admin.html';
            case 'cashier': return './dashboard_cashier.html';
            default: return './index.html';
        }
    }

    // Show welcome if session exists
    const sess = getSession();
    if (sess) {
        welcomeEl.textContent = `Welcome, ${sess.name || sess.email} (${sess.role})`;
        userHeader.style.display = '';
        authForms.style.display = 'none';
        document.querySelector('.buttons')?.classList?.add('hidden');
    }
});
