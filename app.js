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
    // Initialize supabase client (guarded)
    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
        adminOutput.textContent = JSON.stringify(res.data, null, 2);
    });

    // Initial admin load
    adminRefresh?.click();

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
