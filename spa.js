/* ===================================================================
   The Pink Poodle — Spa & Booking mini-app (LIVE backend)
   Everything persists server-side in Firestore via the pinkPoodleSpa
   Cloud Function. Nothing is stored in the browser — no localStorage,
   no sessionStorage, no cookies. Runtime state lives only in memory for
   the current page view and is cleared on reload.
   =================================================================== */
(function () {
  'use strict';

  /* ---------- backend ---------- */
  var ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSpa';
  function api(action, payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'Network error.' }; }).then(function (j) {
        if (!r.ok || (j && j.error)) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /* ---------- static menus (client-side estimate only) ---------- */
  var STYLISTS = [
    { name: 'Britni', role: 'Owner & Groomer' },
    { name: 'Jenefer', role: 'Groomer & Stylist' },
    { name: 'Hannah', role: 'Bath & Spa Specialist' },
    { name: 'No preference', role: 'First available' }
  ];
  var SERVICES = [
    { id: 'bath', name: 'Bath & Brush', desc: 'Shampoo, blow-dry, brush-out', price: 30, dur: 45 },
    { id: 'groom', name: 'Full Groom', desc: 'Bath + breed/style haircut', price: 55, dur: 90 },
    { id: 'puppy', name: "Puppy's First Groom", desc: 'Gentle intro for pups under 6 mo', price: 40, dur: 60 },
    { id: 'deshed', name: 'De-Shed Treatment', desc: 'Deep de-shedding for double coats', price: 45, dur: 60 },
    { id: 'nails', name: 'Nail Trim', desc: 'Quick trim, in & out', price: 12, dur: 15 },
    { id: 'teeth', name: 'Teeth Brushing', desc: 'Fresh breath & clean smile', price: 8, dur: 10 }
  ];
  var ADDONS = [
    { id: 'grind', name: 'Nail grind', price: 8 },
    { id: 'facial', name: 'Blueberry facial', price: 6 },
    { id: 'cologne', name: 'Cologne + bow/bandana', price: 5 },
    { id: 'flea', name: 'Flea & tick bath', price: 12 },
    { id: 'ears', name: 'Ear cleaning', price: 6 },
    { id: 'gland', name: 'Gland expression', price: 8 }
  ];
  var SIZE_ADD = { 'Small (0–20 lb)': 0, 'Medium (20–50 lb)': 10, 'Large (50–90 lb)': 22, 'X-Large (90+ lb)': 38 };
  var STEP_ICONS = ['📝', '🐾', '🛁', '✂️', '✨', '🔔', '🏠'];
  var STEPS = ['Requested', 'Checked in', 'Bathing', 'Grooming', 'Finishing', 'Ready for pickup', 'Picked up'];

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toString().replace(/\.00$/, ''); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function dl(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- runtime-only state (cleared on reload) ---------- */
  var sel = { services: {}, addons: {}, stylist: 'No preference' };
  var staffPin = null;              // held in memory only while the tab is open
  var lastCodes = [];               // recent REF codes booked this session (memory only)
  var boardCache = [];              // last fetched board tickets
  var feesCache = [];               // last fetched fees
  var boardFilter = 'All';
  var currentSub = 'board';
  var coState = { id: null, items: [] };

  /* =================================================================
     NAVIGATION
     ================================================================= */
  function go(view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('hidden', v.dataset.view !== view); });
    document.querySelectorAll('.nav__btn').forEach(function (b) { b.classList.toggle('on', b.dataset.go === view); });
    if (view === 'staff') showSub(currentSub);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav__btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

  /* =================================================================
     SERVICE MENU + TOTAL (client-side estimate)
     ================================================================= */
  function renderServices() {
    $('svcList').innerHTML = SERVICES.map(function (s) {
      return '<div class="svc ' + (sel.services[s.id] ? 'sel' : '') + '" data-svc="' + s.id + '">' +
        '<div class="svc__check">' + (sel.services[s.id] ? '✓' : '') + '</div>' +
        '<div><div class="svc__name">' + esc(s.name) + '</div><div class="svc__desc">' + esc(s.desc) + '</div></div>' +
        '<div class="svc__price">from ' + money(s.price) + '<div class="svc__dur">' + s.dur + ' min</div></div></div>';
    }).join('');
    $('svcList').querySelectorAll('[data-svc]').forEach(function (el) {
      el.addEventListener('click', function () { var k = el.dataset.svc; sel.services[k] = !sel.services[k]; renderServices(); renderTotal(); });
    });
  }
  function renderAddons() {
    $('addonList').innerHTML = ADDONS.map(function (a) {
      return '<button type="button" class="pill ' + (sel.addons[a.id] ? 'sel' : '') + '" data-add="' + a.id + '">' + esc(a.name) + ' +' + money(a.price) + '</button>';
    }).join('');
    $('addonList').querySelectorAll('[data-add]').forEach(function (el) {
      el.addEventListener('click', function () { var k = el.dataset.add; sel.addons[k] = !sel.addons[k]; renderAddons(); renderTotal(); });
    });
  }
  function renderStylists() {
    $('stylistList').innerHTML = STYLISTS.map(function (s) {
      return '<button type="button" class="pill ' + (sel.stylist === s.name ? 'sel' : '') + '" data-sty="' + esc(s.name) + '">' + esc(s.name) + '</button>';
    }).join('');
    $('stylistList').querySelectorAll('[data-sty]').forEach(function (el) {
      el.addEventListener('click', function () { sel.stylist = el.dataset.sty; renderStylists(); });
    });
  }
  function estimate() {
    var total = 0, dur = 0, groomy = false;
    SERVICES.forEach(function (s) { if (sel.services[s.id]) { total += s.price; dur += s.dur; if (['groom', 'deshed', 'puppy'].indexOf(s.id) >= 0) groomy = true; } });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) { total += a.price; dur += 8; } });
    var size = $('pSize').value;
    if (groomy && SIZE_ADD[size]) total += SIZE_ADD[size];
    return { total: total, dur: dur };
  }
  function renderTotal() {
    var e = estimate();
    $('totalAmt').textContent = money(e.total);
    $('totalDur').textContent = e.dur ? ('≈ ' + (e.dur >= 60 ? Math.floor(e.dur / 60) + 'h ' : '') + (e.dur % 60) + 'm') : 'Select services';
  }
  function selectedServiceNames() {
    var names = [];
    SERVICES.forEach(function (s) { if (sel.services[s.id]) names.push(s.name); });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) names.push('+' + a.name); });
    return names;
  }
  $('pSize').addEventListener('change', renderTotal);
  $('bkTime').addEventListener('change', function () { $('exactWrap').classList.toggle('hidden', this.value !== 'exact'); });

  /* =================================================================
     CREATE BOOKING → live backend
     ================================================================= */
  $('bookBtn').addEventListener('click', function () {
    var petName = $('pName').value.trim();
    if (!petName) { toast("Please add your pup's name 🐩"); return; }
    var services = selectedServiceNames();
    if (!services.length) { toast('Choose at least one service 🛁'); return; }
    if (!$('oName').value.trim() || !$('oPhone').value.trim()) { toast('Add your name & mobile so we can confirm 📱'); return; }
    if (!$('cVax').checked || !$('cHandle').checked || !$('cContact').checked) { toast('Please check the 3 OK boxes 🐾'); return; }
    if (!$('cSign').value.trim()) { toast('Please sign with your name ✍️'); return; }

    var e = estimate();
    var when = $('bkDate').value ? new Date($('bkDate').value + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'flexible';
    var time = $('bkTime').value === 'exact' ? ($('bkExact').value || 'exact time') : ($('bkTime').value || 'any time');
    var btn = $('bookBtn'); btn.disabled = true; btn.textContent = 'Sending…';

    api('spaBook', {
      pet: { name: petName, breed: $('pBreed').value.trim(), size: $('pSize').value, notes: $('pNotes').value.trim() },
      owner: { name: $('oName').value.trim(), phone: $('oPhone').value.trim(), email: $('oEmail').value.trim() },
      services: services, stylist: sel.stylist, requestedDate: when, requestedTime: time, est: e.total,
      company: $('hp').value
    }).then(function (res) {
      lastCodes.unshift({ code: res.code, pet: petName });
      showBookingSuccess(res.code, petName, services, sel.stylist, when, time, e.total);
      // reset selections
      sel.services = {}; sel.addons = {};
      $('pName').value = ''; $('pBreed').value = ''; $('pNotes').value = '';
      $('cVax').checked = $('cHandle').checked = $('cContact').checked = false;
      renderServices(); renderAddons(); renderTotal();
      toast('Request sent! Code ' + res.code + ' 🩷');
    }).catch(function (err) {
      toast(err.message || 'Could not send — please text 304-921-2748');
    }).then(function () { btn.disabled = false; btn.textContent = 'Request →'; });
  });

  function showBookingSuccess(code, petName, services, stylist, when, time, est) {
    go('track');
    $('trackCode').value = code;
    var msg = "Hi Britni! I'd like to book at The Pink Poodle.\n" +
      'Pet: ' + petName + '\n' +
      'Services: ' + services.join(', ') + '\n' +
      'Stylist: ' + stylist + '\n' +
      'When: ' + when + ', ' + time + '\n' +
      'Est: ' + money(est) + ' · Ref ' + code;
    var sms = 'sms:3049212748' + (/iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(msg);
    $('trackBody').innerHTML =
      '<div class="card" style="border:1px solid var(--gold,#c9a34e)">' +
      '<h2 style="margin-top:0">You\'re on the list! ✨</h2>' +
      '<p>Save this booking code — it\'s how you\'ll track ' + esc(petName) + '\'s spa day:</p>' +
      '<div class="track__code" style="font-size:1.6rem;text-align:center;letter-spacing:0.2em">' + esc(code) + '</div>' +
      '<a class="btn btn--primary btn--block" style="margin-top:0.8rem" href="' + sms + '">💬 Text this request to the salon</a>' +
      '<button class="btn btn--soft btn--block" id="trackNow" type="button" style="margin-top:0.5rem">Track now →</button>' +
      '</div>';
    var tn = $('trackNow'); if (tn) tn.addEventListener('click', doTrack);
  }

  /* =================================================================
     TRACK (customer) — by code
     ================================================================= */
  function doTrack() {
    var code = $('trackCode').value.trim().toUpperCase();
    if (!code) { toast('Enter your booking code ✨'); return; }
    $('trackBody').innerHTML = '<p class="muted">Looking up ' + esc(code) + '…</p>';
    api('spaTrack', { code: code }).then(function (res) {
      var t = res.ticket;
      if (t.cancelled) {
        $('trackBody').innerHTML = '<div class="card"><div class="track__code">' + esc(t.petName || 'Your pup') + ' · REF ' + esc(t.code) + '</div><p class="muted">This appointment was cancelled. Text 304-921-2748 to rebook.</p></div>';
        return;
      }
      var steps = STEPS.map(function (label, i) {
        var cls = i < t.step ? 'done' : (i === t.step ? 'active' : '');
        return '<div class="step ' + cls + '"><div class="dot">' + (i < t.step ? '✓' : STEP_ICONS[i]) + '</div><div class="lbl">' + label + '</div></div>';
      }).join('');
      var canCancel = t.step < 2;
      $('trackBody').innerHTML = '<div class="track"><div class="track__code">' + esc(t.petName || 'Your pup') + ' · REF ' + esc(t.code) + '</div>' +
        '<div class="track__status">' + esc(STEPS[t.step] || 'Requested') + (t.step === 5 ? ' 🔔' : '') + '</div>' +
        '<div class="steps">' + steps + '</div>' +
        (canCancel ? '<button class="btn btn--soft btn--sm" id="custCancel" type="button" style="margin-top:0.6rem">Cancel this request</button>' : '') +
        '</div>';
      var cc = $('custCancel');
      if (cc) cc.addEventListener('click', function () {
        if (!confirm('Cancel this appointment?')) return;
        api('spaCancelByCode', { code: t.code }).then(function () { toast('Cancelled. Text us to rebook 🩷'); doTrack(); }).catch(function (e) { toast(e.message); });
      });
    }).catch(function (err) {
      $('trackBody').innerHTML = '<div class="empty"><div class="big">🔍</div><p>' + esc(err.message || 'No booking found for that code.') + '</p></div>';
    });
  }
  $('trackGo').addEventListener('click', doTrack);
  $('trackCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doTrack(); });

  /* =================================================================
     STAFF — PIN gate
     ================================================================= */
  function staffUnlocked() { return !!staffPin; }
  function setStaffUI(on) {
    $('staffToggle').classList.toggle('on', on);
    $('staffToggle').textContent = on ? '🔓 Staff' : '🔒 Staff';
    document.querySelector('.nav__staff').classList.toggle('hidden', !on);
  }
  $('staffToggle').addEventListener('click', function () {
    if (staffUnlocked()) { staffPin = null; setStaffUI(false); go('home'); return; }
    $('pinInput').value = ''; $('pinModal').classList.add('open'); setTimeout(function () { $('pinInput').focus(); }, 100);
  });
  $('pinGo').addEventListener('click', function () {
    var pin = $('pinInput').value.trim();
    if (!pin) return;
    $('pinGo').disabled = true;
    // Validate by attempting a staff call; hold the PIN in memory only on success.
    api('spaBoard', { pin: pin }).then(function (res) {
      staffPin = pin; boardCache = res.tickets || [];
      $('pinModal').classList.remove('open'); setStaffUI(true); go('staff'); showSub('board');
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }).catch(function (err) {
      toast(err.message || 'Wrong PIN');
    }).then(function () { $('pinGo').disabled = false; });
  });
  $('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pinGo').click(); });
  $('pinCancel').addEventListener('click', function () { $('pinModal').classList.remove('open'); });

  /* ---------- staff subnav ---------- */
  function showSub(sub) {
    currentSub = sub;
    document.querySelectorAll('#staffSubnav .pill').forEach(function (b) { b.classList.toggle('sel', b.dataset.sub === sub); });
    document.querySelectorAll('.staff__pane').forEach(function (p) { p.classList.toggle('hidden', p.dataset.sub !== sub); });
    if (sub === 'board') renderBoard();
    if (sub === 'ledger') loadLedger();
    if (sub === 'contacts') loadContacts();
    if (sub === 'fees') loadFees();
  }
  document.querySelectorAll('#staffSubnav .pill').forEach(function (b) { b.addEventListener('click', function () { showSub(b.dataset.sub); }); });

  /* =================================================================
     STAFF — status board
     ================================================================= */
  function fetchBoard() {
    return api('spaBoard', { pin: staffPin }).then(function (res) { boardCache = res.tickets || []; return boardCache; });
  }
  function renderBoard() {
    fetchBoard().then(drawBoard).catch(function (e) { toast(e.message); });
  }
  function drawBoard() {
    var f = $('boardFilter');
    var opts = ['All'].concat(STYLISTS.map(function (s) { return s.name; }).filter(function (n) { return n !== 'No preference'; }));
    f.innerHTML = opts.map(function (o) { return '<button type="button" class="pill ' + (boardFilter === o ? 'sel' : '') + '" data-f="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
    f.querySelectorAll('[data-f]').forEach(function (el) { el.addEventListener('click', function () { boardFilter = el.dataset.f; drawBoard(); }); });

    var list = boardCache.filter(function (t) { return !t.cancelled; });
    if (boardFilter !== 'All') list = list.filter(function (t) { return t.stylist === boardFilter; });
    var box = $('board');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🧼</div><p>No pups on the board yet today.</p></div>'; return; }
    box.innerHTML = list.map(function (t) {
      var done = t.step >= 6;
      var ready = t.step === 5;
      var chip = t.paid ? '<span class="statuschip statuschip--done">Paid ✓</span>' : (done ? '<span class="statuschip statuschip--done">Picked up</span>' : (ready ? '<span class="statuschip statuschip--ready">Ready 🔔</span>' : '<span class="statuschip statuschip--go">' + esc(STEPS[t.step]) + '</span>'));
      var actions = '';
      if (!done) {
        if (t.step < 5) actions += '<button class="btn btn--primary btn--sm" data-adv="' + t.id + '" data-step="' + (t.step + 1) + '">Next: ' + esc(STEPS[t.step + 1]) + ' →</button>';
        if (t.step === 5) actions += '<button class="btn btn--gold btn--sm" data-adv="' + t.id + '" data-step="6">Mark picked up</button>';
        if (t.step >= 1) actions += '<button class="btn btn--soft btn--sm" data-adv="' + t.id + '" data-step="' + (t.step - 1) + '">‹ Back</button>';
      }
      if (!t.paid) actions += '<button class="btn btn--gold btn--sm" data-co="' + t.id + '">💳 Checkout</button>';
      actions += '<button class="btn btn--soft btn--sm" data-cx="' + t.id + '">Cancel</button>';
      actions += '<button class="btn btn--soft btn--sm" data-del="' + t.id + '">✕</button>';
      var owner = t.owner || {};
      return '<div class="card ticket ' + (ready ? 'ticket--ready' : '') + (done ? ' ticket--done' : '') + '">' +
        '<div class="ticket__top"><strong>' + esc(t.pet && t.pet.name || t.petName) + '</strong>' + chip +
        '<span class="ticket__code" style="margin-left:auto">' + esc(t.code) + '</span></div>' +
        '<div class="ticket__svcs">' + esc((t.services || []).join(' · ')) + ' — ' + esc(t.stylist) +
        (t.requestedTime ? ' · ' + esc(t.requestedTime) : '') + (t.est ? ' · est ' + money(t.est) : '') +
        (t.finalTotal ? ' · <strong>paid ' + money(t.finalTotal) + '</strong>' : '') + '</div>' +
        (owner.name || owner.phone ? '<div class="muted">📱 ' + esc(owner.name || '') + (owner.phone ? ' · ' + esc(owner.phone) : '') + '</div>' : '') +
        (t.pet && t.pet.notes ? '<div class="muted">📝 ' + esc(t.pet.notes) + '</div>' : '') +
        '<div class="ticket__actions">' + actions + '</div></div>';
    }).join('');

    box.querySelectorAll('[data-adv]').forEach(function (el) { el.addEventListener('click', function () { advance(el.dataset.adv, Number(el.dataset.step)); }); });
    box.querySelectorAll('[data-co]').forEach(function (el) { el.addEventListener('click', function () { openCheckout(el.dataset.co); }); });
    box.querySelectorAll('[data-cx]').forEach(function (el) { el.addEventListener('click', function () { openCancel(el.dataset.cx); }); });
    box.querySelectorAll('[data-del]').forEach(function (el) { el.addEventListener('click', function () {
      if (!confirm('Remove from board? This deletes the ticket.')) return;
      api('spaDelete', { pin: staffPin, id: el.dataset.del }).then(renderBoard).catch(function (e) { toast(e.message); });
    }); });
  }
  function advance(id, step) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0];
    api('spaAdvance', { pin: staffPin, id: id, step: step }).then(function () {
      if (step === 5 && t && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('🐩 ' + (t.pet && t.pet.name || 'A pup') + ' is ready for pickup!', { body: 'The Pink Poodle · Ref ' + t.code }); } catch (e) {}
      }
      renderBoard();
    }).catch(function (e) { toast(e.message); });
  }
  $('boardRefresh').addEventListener('click', renderBoard);

  /* ---------- walk-in ---------- */
  $('walkInBtn').addEventListener('click', function () {
    $('wiName').value = '';
    $('wiStylist').innerHTML = STYLISTS.filter(function (s) { return s.name !== 'No preference'; }).map(function (s) { return '<option>' + esc(s.name) + '</option>'; }).join('');
    if (boardFilter !== 'All') $('wiStylist').value = boardFilter;
    $('walkinModal').classList.add('open');
  });
  $('wiCancel').addEventListener('click', function () { $('walkinModal').classList.remove('open'); });
  $('wiSave').addEventListener('click', function () {
    var name = $('wiName').value.trim(); if (!name) { toast('Pet name?'); return; }
    api('spaWalkin', { pin: staffPin, petName: name, stylist: $('wiStylist').value }).then(function () {
      $('walkinModal').classList.remove('open'); toast('Checked in ' + name); renderBoard();
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     CHECKOUT
     ================================================================= */
  function openCheckout(id) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    coState = { id: id, items: [] };
    // Seed line items from the requested services with menu prices.
    (t.services || []).forEach(function (name) {
      var clean = name.replace(/^\+/, '');
      var svc = SERVICES.filter(function (s) { return s.name === clean; })[0];
      var add = ADDONS.filter(function (a) { return a.name === clean; })[0];
      var price = svc ? svc.price : (add ? add.price : 0);
      coState.items.push({ label: clean, amount: price });
    });
    if (!coState.items.length) coState.items.push({ label: (t.services && t.services[0]) || 'Grooming', amount: t.est || 0 });
    $('checkoutTitle').textContent = 'Checkout — ' + (t.pet && t.pet.name || t.petName);
    $('coDiscount').value = 0; $('coTip').value = 0; $('coPay').value = 'Cash';
    drawCoItems();
    $('checkoutModal').classList.add('open');
  }
  function drawCoItems() {
    $('coItems').innerHTML = coState.items.map(function (it, i) {
      return '<div class="row2" style="grid-template-columns:1fr 90px 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<input type="text" data-ci-label="' + i + '" value="' + esc(it.label) + '" placeholder="Item" />' +
        '<input type="number" data-ci-amt="' + i + '" value="' + it.amount + '" min="0" step="1" inputmode="decimal" />' +
        '<button class="btn btn--soft btn--sm" data-ci-del="' + i + '" type="button">✕</button></div>';
    }).join('');
    $('coItems').querySelectorAll('[data-ci-label]').forEach(function (el) { el.addEventListener('input', function () { coState.items[el.dataset.ciLabel].label = el.value; }); });
    $('coItems').querySelectorAll('[data-ci-amt]').forEach(function (el) { el.addEventListener('input', function () { coState.items[el.dataset.ciAmt].amount = Math.max(0, Number(el.value) || 0); coTotal(); }); });
    $('coItems').querySelectorAll('[data-ci-del]').forEach(function (el) { el.addEventListener('click', function () { coState.items.splice(el.dataset.ciDel, 1); drawCoItems(); coTotal(); }); });
    coTotal();
  }
  function coTotal() {
    var gross = coState.items.reduce(function (s, it) { return s + (Number(it.amount) || 0); }, 0);
    var total = Math.max(0, gross - (Number($('coDiscount').value) || 0)) + (Number($('coTip').value) || 0);
    $('coTotal').textContent = money(total);
  }
  $('coAddItem').addEventListener('click', function () { coState.items.push({ label: '', amount: 0 }); drawCoItems(); });
  $('coDiscount').addEventListener('input', coTotal);
  $('coTip').addEventListener('input', coTotal);
  $('coCancel').addEventListener('click', function () { $('checkoutModal').classList.remove('open'); });
  $('coSave').addEventListener('click', function () {
    $('coSave').disabled = true;
    api('spaCheckout', {
      pin: staffPin, id: coState.id,
      items: coState.items.filter(function (it) { return it.label && it.amount >= 0; }),
      discount: Number($('coDiscount').value) || 0,
      tip: Number($('coTip').value) || 0,
      payMethod: $('coPay').value
    }).then(function (res) {
      $('checkoutModal').classList.remove('open'); toast('Paid ' + money(res.total) + ' ✓'); renderBoard();
    }).catch(function (e) { toast(e.message); }).then(function () { $('coSave').disabled = false; });
  });

  /* =================================================================
     CANCEL (staff, with optional no-show fee)
     ================================================================= */
  var cxId = null;
  function openCancel(id) { cxId = id; $('cxReason').value = ''; $('cxFee').value = 0; $('cancelModal').classList.add('open'); }
  $('cxCancel').addEventListener('click', function () { $('cancelModal').classList.remove('open'); });
  $('cxSave').addEventListener('click', function () {
    api('spaCancel', { pin: staffPin, id: cxId, reason: $('cxReason').value.trim() || 'Cancelled', noShowFee: Number($('cxFee').value) || 0 })
      .then(function () { $('cancelModal').classList.remove('open'); toast('Cancelled'); renderBoard(); })
      .catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     LEDGER
     ================================================================= */
  function loadLedger() {
    $('ledgerBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaLedger', { pin: staffPin }).then(function (res) {
      var bal = res.balances || [];
      $('ledgerBalances').innerHTML = '<h2 style="margin-top:0">Account balances</h2>' +
        (bal.length ? '<table class="ledger"><tbody>' + bal.map(function (b) {
          return '<tr><td>' + esc(b.acct) + '</td><td style="text-align:right">' + money(b.balance) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">No entries yet.</p>');
      var entries = res.entries || [];
      $('ledgerBody').innerHTML = entries.length ? entries.map(function (e) {
        var lines = (e.lines || []).map(function (l) {
          return '<tr><td>' + esc(l.acct) + '</td><td style="text-align:right">' + (l.dr ? money(l.dr) : '') + '</td><td style="text-align:right">' + (l.cr ? money(l.cr) : '') + '</td></tr>';
        }).join('');
        return '<div class="card"><div class="ticket__top"><strong>' + esc(e.date || '') + '</strong><span class="muted" style="margin-left:auto">' + esc(e.ref || '') + '</span></div>' +
          '<div class="muted">' + esc(e.memo || '') + '</div>' +
          '<table class="ledger"><thead><tr><th>Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>' + lines + '</tbody></table></div>';
      }).join('') : '<div class="empty"><div class="big">📒</div><p>No journal entries yet.</p></div>';
    }).catch(function (e) { $('ledgerBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  $('ledgerRefresh').addEventListener('click', loadLedger);
  $('ledgerAddBtn').addEventListener('click', function () {
    $('leDate').value = todayISO(); $('leMemo').value = ''; $('leDebit').value = ''; $('leCredit').value = ''; $('leAmount').value = '';
    $('ledgerModal').classList.add('open');
  });
  $('leCancel').addEventListener('click', function () { $('ledgerModal').classList.remove('open'); });
  $('leSave').addEventListener('click', function () {
    api('spaLedgerAdd', { pin: staffPin, date: $('leDate').value, memo: $('leMemo').value.trim(), debit: $('leDebit').value.trim(), credit: $('leCredit').value.trim(), amount: Number($('leAmount').value) || 0 })
      .then(function () { $('ledgerModal').classList.remove('open'); toast('Entry posted 📒'); loadLedger(); })
      .catch(function (e) { toast(e.message); });
  });
  $('ledgerCsvBtn').addEventListener('click', function () {
    api('spaLedger', { pin: staffPin }).then(function (res) {
      var rows = [['Date', 'Ref', 'Memo', 'Account', 'Debit', 'Credit']];
      (res.entries || []).forEach(function (e) {
        (e.lines || []).forEach(function (l) { rows.push([e.date || '', e.ref || '', e.memo || '', l.acct, l.dr || '', l.cr || '']); });
      });
      dl('pink-poodle-ledger-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     CONTACTS
     ================================================================= */
  var contactsCache = [];
  function loadContacts() {
    $('contactsBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaContacts', { pin: staffPin }).then(function (res) {
      contactsCache = res.contacts || [];
      $('contactsBody').innerHTML = contactsCache.length ? contactsCache.map(function (c) {
        return '<div class="card"><strong>' + esc(c.name || '(no name)') + '</strong>' +
          '<span class="badge" style="margin-left:0.4rem">' + c.visits + ' visit' + (c.visits === 1 ? '' : 's') + '</span>' +
          (c.phone ? '<div class="muted">📱 <a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a></div>' : '') +
          (c.email ? '<div class="muted">✉️ <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></div>' : '') +
          (c.pets && c.pets.length ? '<div class="muted">🐩 ' + esc(c.pets.join(', ')) + '</div>' : '') + '</div>';
      }).join('') : '<div class="empty"><div class="big">📇</div><p>No contacts yet.</p></div>';
    }).catch(function (e) { $('contactsBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  $('contactsRefresh').addEventListener('click', loadContacts);
  $('contactsCsvBtn').addEventListener('click', function () {
    var rows = [['Name', 'Phone', 'Email', 'Pets', 'Visits']];
    contactsCache.forEach(function (c) { rows.push([c.name || '', c.phone || '', c.email || '', (c.pets || []).join('; '), c.visits]); });
    dl('pink-poodle-contacts-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
  });
  $('contactsVcfBtn').addEventListener('click', function () {
    var vcf = contactsCache.map(function (c) {
      var n = c.name || 'Pink Poodle Client';
      return 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:' + n + '\r\n' +
        (c.phone ? 'TEL;TYPE=CELL:' + c.phone + '\r\n' : '') +
        (c.email ? 'EMAIL:' + c.email + '\r\n' : '') +
        (c.pets && c.pets.length ? 'NOTE:Pets: ' + c.pets.join(', ') + '\r\n' : '') +
        'END:VCARD';
    }).join('\r\n');
    dl('pink-poodle-contacts-' + todayISO() + '.vcf', 'text/vcard', vcf);
  });

  function csvRow(arr) { return arr.map(function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }

  /* =================================================================
     FEES & PIN
     ================================================================= */
  function loadFees() {
    api('spaFees', { pin: staffPin }).then(function (res) { feesCache = res.fees || []; drawFees(); }).catch(function (e) { toast(e.message); });
  }
  function drawFees() {
    $('feesBody').innerHTML = feesCache.map(function (f, i) {
      return '<div class="row2" style="grid-template-columns:1fr 100px 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<input type="text" data-fee-label="' + i + '" value="' + esc(f.label) + '" placeholder="Fee name" />' +
        '<input type="number" data-fee-amt="' + i + '" value="' + f.amount + '" min="0" step="1" inputmode="decimal" />' +
        '<button class="btn btn--soft btn--sm" data-fee-del="' + i + '" type="button">✕</button></div>';
    }).join('');
    $('feesBody').querySelectorAll('[data-fee-label]').forEach(function (el) { el.addEventListener('input', function () { feesCache[el.dataset.feeLabel].label = el.value; }); });
    $('feesBody').querySelectorAll('[data-fee-amt]').forEach(function (el) { el.addEventListener('input', function () { feesCache[el.dataset.feeAmt].amount = Math.max(0, Number(el.value) || 0); }); });
    $('feesBody').querySelectorAll('[data-fee-del]').forEach(function (el) { el.addEventListener('click', function () { feesCache.splice(el.dataset.feeDel, 1); drawFees(); }); });
  }
  $('feeAddBtn').addEventListener('click', function () { feesCache.push({ label: '', amount: 0 }); drawFees(); });
  $('feeSaveBtn').addEventListener('click', function () {
    api('spaFeesSave', { pin: staffPin, fees: feesCache.filter(function (f) { return f.label; }) })
      .then(function (res) { feesCache = res.fees || []; drawFees(); toast('Fees saved ⚙️'); })
      .catch(function (e) { toast(e.message); });
  });
  $('pinSaveBtn').addEventListener('click', function () {
    var np = $('newPin').value.trim();
    if (!/^\d{4,8}$/.test(np)) { toast('PIN must be 4–8 digits'); return; }
    api('spaSetPin', { pin: staffPin, newPin: np }).then(function () {
      staffPin = np; $('newPin').value = ''; toast('PIN updated 🔒');
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     INIT
     ================================================================= */
  $('bkDate').min = todayISO(); $('bkDate').value = todayISO();
  renderServices(); renderAddons(); renderStylists(); renderTotal();
  setStaffUI(false);
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('spa-sw.js').catch(function () {}); }
})();
