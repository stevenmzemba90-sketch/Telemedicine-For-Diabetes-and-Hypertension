/* Shared communication module for Telemedicine APP
   - Uses BroadcastChannel when available, falls back to localStorage events
   - Persists messages in localStorage under key 'comm:messages:v1'
   - Provides helpers: Comm.sendMessage, Comm.onMessage, Comm.sendConsultationUpdate
*/
(function (global) {
    const KEY = 'comm:messages:v1';
    const SIGNAL_KEY = 'telemed_comm_signal_v1';
    const bcName = 'telemed_comm_v1';
    const handlers = [];
    let bc = null;

    function readMsgs() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
    }

    function saveMsg(msg) {
        const arr = readMsgs(); arr.push(msg); try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) { console.error('comm save error', e); }
    }

    function emitLocal(msg) {
        handlers.forEach(h => { try { h(msg); } catch (e) { console.error(e); } });
    }

    function onStorage(e) {
        if (!e) return;
        if (e.key === SIGNAL_KEY && e.newValue) {
            try {
                const msg = JSON.parse(e.newValue);
                if (msg && msg._comm) {
                    emitLocal(msg);
                }
            } catch (er) { /* ignore */ }
        }
    }

    // init broadcast channel if supported
    try { if (typeof BroadcastChannel !== 'undefined') bc = new BroadcastChannel(bcName); } catch (e) { bc = null; }
    if (bc) {
        bc.onmessage = function (ev) { const msg = ev.data; if (!msg) return; saveMsg(msg); emitLocal(msg); };
    }

    window.addEventListener('storage', onStorage);

    function sendMessage(payload) {
        const base = Object.assign({ id: 'm:' + Date.now() + ':' + Math.floor(Math.random() * 10000), ts: new Date().toISOString() }, payload);
        // persist
        try { saveMsg(base); } catch (e) { console.error(e); }
        // send via BroadcastChannel if available
        if (bc) {
            try { bc.postMessage(base); } catch (e) { /* ignore */ }
        }
        // also trigger storage signal so other tabs receive (storage event does not fire in same tab)
        try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(Object.assign({}, base, { _comm: true }))); } catch (e) { console.error(e); }
        // fire local handlers in this tab
        emitLocal(base);
        return base;
    }

    function getMessages(filter) {
        const arr = readMsgs(); if (!filter) return arr; return arr.filter(filter);
    }

    function onMessage(cb) { if (typeof cb === 'function') handlers.push(cb); }

    function sendConsultationUpdate(payload) {
        const msg = { type: 'consultation_update', payload: payload || {}, fromRole: payload.fromRole || null, to: payload.to || 'all' };
        const sent = sendMessage(msg);
        // also set a dedicated consultation-updated flag for existing listeners
        try { localStorage.setItem('consultation-updated', JSON.stringify({ ts: Date.now(), payload: msg.payload })); } catch (e) { }
        // update notifications key to trigger UI watchers
        try { localStorage.setItem('notifications-updated', JSON.stringify({ ts: Date.now(), payload: msg })); } catch (e) { }
        return sent;
    }

    // expose API
    global.Comm = {
        sendMessage,
        onMessage,
        getMessages,
        sendConsultationUpdate
    };

})(window);
