/* ===================================================================
   The Pink Poodle — Spa & Booking mini-app
   Self-contained. State lives in localStorage; cross-tab sync via the
   `storage` event. No backend required — a booking also offers a real
   SMS deep-link to the salon so requests actually reach Britni.
   =================================================================== */
(function () {
  'use strict';

  /* ---------- constants ---------- */
  var SALON_PHONE = '3049212748';
  var STAFF_PIN = '2748'; // salon PIN for the status board (last 4 of the shop line)
  var isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);

  var STYLISTS = [
    { name: 'Britni', role: 'Owner & Groomer', phone: '+13049212748' },
    { name: 'Jenefer', role: 'Groomer & Stylist', phone: '+13048094041' },
    { name: 'Hannah', role: 'Bath & Spa Specialist', phone: '+13048001778' },
    { name: 'No preference', role: 'First available', phone: '+13049212748' }
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

  // size surcharge added to grooming-type services
  var SIZE_ADD = { 'Small (0–20 lb)': 0, 'Medium (20–50 lb)': 10, 'Large (50–90 lb)': 22, 'X-Large (90+ lb)': 38 };

  var STEPS = ['Requested', 'Checked in', 'Bathing', 'Grooming', 'Finishing', 'Ready for pickup', 'Picked up'];
  var STEP_ICONS = ['📝', '🐾', '🛁', '✂️', '✨', '🔔', '🏠'];

  /* ---------- storage ---------- */
  var DB = {
    pets: 'pp_spa_pets',
    tickets: 'pp_spa_tickets',
    loyalty: 'pp_spa_loyalty'
  };
  function load(k, fb) { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch (e) { return fb; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function pets() { return load(DB.pets, []); }
  function tickets() { return load(DB.tickets, []); }

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function code() { return (Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4)).toUpperCase(); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toString().replace(/\.00$/, ''); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600); }

  /* ---------- booking builder state ---------- */
  var sel = { petId: null, services: {}, addons: {}, stylist: 'No preference' };

  /* =================================================================
     NAVIGATION
     ================================================================= */
  function go(view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('hidden', v.dataset.view !== view); });
    document.querySelectorAll('.nav__btn').forEach(function (b) { b.classList.toggle('on', b.dataset.go === view); });
    if (view === 'pets') renderPetCards();
    if (view === 'track') renderTrack();
    if (view === 'staff') renderBoard();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav__btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

  /* =================================================================
     PETS
     ================================================================= */
  function petAvatar(p, cls) {
    if (p && p.photo) return '<img class="pet__photo ' + (cls || '') + '" src="' + p.photo + '" alt="">';
    return '<div class="pet__photo ' + (cls || '') + '">🐾</div>';
  }

  function renderPetPicker() {
    var box = $('petPicker'); var list = pets();
    if (!list.length) { box.innerHTML = '<p class="muted">Add a pet below to get started.</p>'; sel.petId = null; return; }
    if (!sel.petId || !list.some(function (p) { return p.id === sel.petId; })) sel.petId = list[0].id;
    box.innerHTML = list.map(function (p) {
      return '<label class="svc ' + (p.id === sel.petId ? 'sel' : '') + '" data-pet="' + p.id + '">' +
        petAvatar(p, '') +
        '<div><div class="svc__name">' + esc(p.name) + (p.vax ? '' : ' <span class="badge badge--warn">vax?</span>') + '</div>' +
        '<div class="svc__desc">' + esc(p.breed || 'Dog') + ' · ' + esc((p.size || '').replace(/ \(.*/, '')) + '</div></div>' +
        '<div class="svc__check">' + (p.id === sel.petId ? '✓' : '') + '</div></label>';
    }).join('');
    box.querySelectorAll('[data-pet]').forEach(function (el) {
      el.addEventListener('click', function () { sel.petId = el.dataset.pet; renderPetPicker(); });
    });
  }

  function renderPetCards() {
    var box = $('petCards'); var list = pets();
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🐩</div><p>No pups yet — add your first one!</p></div>'; return; }
    box.innerHTML = list.map(function (p) {
      return '<div class="card pet" data-edit="' + p.id + '">' + petAvatar(p) +
        '<div style="flex:1"><div class="pet__name">' + esc(p.name) + (p.vax ? '<span class="badge">💉 vax ✓</span>' : '<span class="badge badge--warn">vax needed</span>') + '</div>' +
        '<div class="pet__meta">' + esc(p.breed || 'Dog') + ' · ' + esc(p.age || '') + ' · ' + esc(p.size || '') + '</div>' +
        (p.notes ? '<div class="pet__meta">📝 ' + esc(p.notes) + '</div>' : '') + '</div>' +
        '<span class="linkbtn">Edit ›</span></div>';
    }).join('');
    box.querySelectorAll('[data-edit]').forEach(function (el) { el.addEventListener('click', function () { openPet(el.dataset.edit); }); });
  }

  var photoData = '';
  function openPet(id) {
    var p = pets().filter(function (x) { return x.id === id; })[0] || {};
    $('petModalTitle').textContent = id ? 'Edit ' + (p.name || 'pet') : 'Add a pet';
    $('pId').value = id || '';
    $('pName').value = p.name || ''; $('pBreed').value = p.breed || ''; $('pAge').value = p.age || '';
    $('pSize').value = p.size || 'Small (0–20 lb)'; $('pNotes').value = p.notes || ''; $('pVax').checked = !!p.vax;
    photoData = p.photo || '';
    $('pPhotoPreview').innerHTML = photoData ? '<img src="' + photoData + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : '🐾';
    $('petDelete').style.display = id ? '' : 'none';
    $('petModal').classList.add('open');
  }
  function closePet() { $('petModal').classList.remove('open'); }

  $('pPhoto').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var max = 360, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        photoData = c.toDataURL('image/jpeg', 0.82);
        $('pPhotoPreview').innerHTML = '<img src="' + photoData + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(f);
  });

  $('petSave').addEventListener('click', function () {
    var name = $('pName').value.trim();
    if (!name) { toast('Please give your pup a name 🐾'); return; }
    var list = pets(); var id = $('pId').value;
    var rec = { id: id || uid(), name: name, breed: $('pBreed').value.trim(), age: $('pAge').value.trim(), size: $('pSize').value, notes: $('pNotes').value.trim(), vax: $('pVax').checked, photo: photoData };
    if (id) { list = list.map(function (p) { return p.id === id ? rec : p; }); }
    else { list.push(rec); sel.petId = rec.id; }
    save(DB.pets, list); closePet(); renderPetPicker(); renderPetCards(); toast('Saved 🩷');
  });
  $('petDelete').addEventListener('click', function () {
    var id = $('pId').value; if (!id || !confirm('Remove this pet?')) return;
    save(DB.pets, pets().filter(function (p) { return p.id !== id; })); closePet(); renderPetPicker(); renderPetCards();
  });
  $('petCancel').addEventListener('click', closePet);
  $('addPetBtn').addEventListener('click', function () { openPet(''); });
  $('addPetInline').addEventListener('click', function () { openPet(''); });

  /* =================================================================
     SERVICE MENU + TOTAL
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
  function currentPet() { return pets().filter(function (p) { return p.id === sel.petId; })[0]; }
  function estimate() {
    var total = 0, dur = 0, groomy = false;
    SERVICES.forEach(function (s) { if (sel.services[s.id]) { total += s.price; dur += s.dur; if (['groom', 'deshed', 'puppy'].indexOf(s.id) >= 0) groomy = true; } });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) { total += a.price; dur += 8; } });
    var p = currentPet();
    if (groomy && p && SIZE_ADD[p.size]) total += SIZE_ADD[p.size];
    return { total: total, dur: dur };
  }
  function renderTotal() {
    var e = estimate();
    $('totalAmt').textContent = money(e.total);
    $('totalDur').textContent = e.dur ? ('≈ ' + (e.dur >= 60 ? Math.floor(e.dur / 60) + 'h ' : '') + (e.dur % 60) + 'm') : 'Select services';
  }

  $('bkTime').addEventListener('change', function () { $('exactWrap').classList.toggle('hidden', this.value !== 'exact'); });

  /* =================================================================
     CREATE BOOKING (ticket) + SMS deep-link to salon
     ================================================================= */
  function selectedServiceNames() {
    var names = [];
    SERVICES.forEach(function (s) { if (sel.services[s.id]) names.push(s.name); });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) names.push('+' + a.name); });
    return names;
  }

  $('bookBtn').addEventListener('click', function () {
    var pet = currentPet();
    if (!pet) { toast('Add & pick a pet first 🐩'); go('home'); return; }
    if (!selectedServiceNames().length) { toast('Choose at least one service 🛁'); return; }
    if (!$('cVax').checked || !$('cHandle').checked || !$('cContact').checked) { toast('Please check the 3 OK boxes 🐾'); return; }
    if (!$('cSign').value.trim()) { toast('Please sign with your name ✍️'); return; }

    var e = estimate();
    var when = $('bkDate').value ? new Date($('bkDate').value + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'flexible';
    var time = $('bkTime').value === 'exact' ? ($('bkExact').value || 'exact time') : ($('bkTime').value || 'any time');
    var services = selectedServiceNames();

    var ticket = {
      id: uid(), code: code(), createdAt: Date.now(), date: todayISO(),
      petName: pet.name, petBreed: pet.breed, petSize: pet.size, petNotes: pet.notes,
      owner: $('cSign').value.trim(),
      services: services, stylist: sel.stylist,
      requestedDate: when, requestedTime: time,
      est: e.total, step: 0, notified: false
    };
    var list = tickets(); list.unshift(ticket); save(DB.tickets, list);

    // reset selections
    sel.services = {}; sel.addons = {}; renderServices(); renderAddons(); renderTotal();
    $('cVax').checked = $('cHandle').checked = $('cContact').checked = false;

    go('track');
    toast('Request saved! Code ' + ticket.code);

    // Offer to actually send it to the salon by text (real delivery path)
    var msg = "Hi Britni! I'd like to book at The Pink Poodle.\n" +
      'Pet: ' + pet.name + ' (' + (pet.breed || 'dog') + ', ' + (pet.size || '').replace(/ \(.*/, '') + ')\n' +
      'Services: ' + services.join(', ') + '\n' +
      'Stylist: ' + sel.stylist + '\n' +
      'When: ' + when + ', ' + time + '\n' +
      'Est: ' + money(e.total) + ' · Ref ' + ticket.code + '\n' +
      'From: ' + ticket.owner;
    var href = 'sms:' + SALON_PHONE + (isiOS ? '&' : '?') + 'body=' + encodeURIComponent(msg);
    if (isMobile) {
      setTimeout(function () { window.location.href = href; }, 500);
    } else {
      // desktop: show a tappable link in the tracker
      var a = document.createElement('a');
      a.href = href; a.className = 'btn btn--primary btn--block'; a.style.marginTop = '0.6rem';
      a.textContent = '💬 Text this request to the salon';
      var body = $('trackBody'); if (body) body.appendChild(a);
    }
  });

  /* =================================================================
     TRACK (customer)
     ================================================================= */
  function activeTickets() { return tickets().filter(function (t) { return t.step < 6; }); }
  function renderTrack() {
    var box = $('trackBody');
    var mine = tickets().slice(0, 3);
    if (!mine.length) { box.innerHTML = '<div class="empty"><div class="big">✨</div><p>No spa days yet. Book one and watch the magic happen here!</p></div>'; renderStamps(); return; }
    box.innerHTML = mine.map(function (t) {
      var steps = STEPS.map(function (label, i) {
        var cls = i < t.step ? 'done' : (i === t.step ? 'active' : '');
        return '<div class="step ' + cls + '"><div class="dot">' + (i < t.step ? '✓' : STEP_ICONS[i]) + '</div><div class="lbl">' + label + '</div></div>';
      }).join('');
      return '<div class="track"><div class="track__code">' + esc(t.petName) + ' · REF ' + t.code + '</div>' +
        '<div class="track__status">' + STEPS[t.step] + (t.step === 5 ? ' 🔔' : '') + '</div>' +
        '<div class="steps">' + steps + '</div></div>';
    }).join('');
    renderStamps();
  }
  function renderStamps() {
    var n = load(DB.loyalty, 0) % 6;
    $('stamps').innerHTML = Array.from({ length: 6 }).map(function (_, i) {
      if (i === 5) return '<div class="stamp ' + (n === 5 ? 'free' : '') + '">🎁</div>';
      return '<div class="stamp ' + (i < n ? 'on' : '') + '">' + (i < n ? '🐾' : '') + '</div>';
    }).join('');
  }

  /* =================================================================
     STAFF STATUS BOARD
     ================================================================= */
  var boardFilter = 'All';
  function renderBoard() {
    var f = $('boardFilter');
    var opts = ['All'].concat(STYLISTS.map(function (s) { return s.name; }).filter(function (n) { return n !== 'No preference'; }));
    f.innerHTML = opts.map(function (o) { return '<button type="button" class="pill ' + (boardFilter === o ? 'sel' : '') + '" data-f="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
    f.querySelectorAll('[data-f]').forEach(function (el) { el.addEventListener('click', function () { boardFilter = el.dataset.f; renderBoard(); }); });

    var list = tickets().filter(function (t) { return t.date === todayISO() || t.step < 6; });
    if (boardFilter !== 'All') list = list.filter(function (t) { return t.stylist === boardFilter; });
    var box = $('board');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🧼</div><p>No pups on the board yet today.</p></div>'; return; }
    box.innerHTML = list.map(function (t) {
      var done = t.step >= 6;
      var ready = t.step === 5;
      var chip = done ? '<span class="statuschip statuschip--done">Picked up</span>' : (ready ? '<span class="statuschip statuschip--ready">Ready 🔔</span>' : '<span class="statuschip statuschip--go">' + STEPS[t.step] + '</span>');
      var actions = '';
      if (!done) {
        if (t.step < 5) actions += '<button class="btn btn--primary btn--sm" data-adv="' + t.id + '">Next: ' + STEPS[t.step + 1] + ' →</button>';
        if (t.step === 5) actions += '<button class="btn btn--gold btn--sm" data-adv="' + t.id + '">Mark picked up</button>';
        if (t.step >= 1) actions += '<button class="btn btn--soft btn--sm" data-back="' + t.id + '">‹ Back</button>';
      }
      actions += '<button class="btn btn--soft btn--sm" data-del="' + t.id + '">✕</button>';
      return '<div class="card ticket ' + (ready ? 'ticket--ready' : '') + (done ? ' ticket--done' : '') + '">' +
        '<div class="ticket__top"><strong>' + esc(t.petName) + '</strong>' + chip +
        '<span class="ticket__code" style="margin-left:auto">' + t.code + '</span></div>' +
        '<div class="ticket__svcs">' + esc(t.services.join(' · ')) + ' — ' + esc(t.stylist) +
        (t.requestedTime ? ' · ' + esc(t.requestedTime) : '') + ' · ' + money(t.est) + '</div>' +
        (t.petNotes ? '<div class="muted">📝 ' + esc(t.petNotes) + '</div>' : '') +
        '<div class="ticket__actions">' + actions + '</div></div>';
    }).join('');

    box.querySelectorAll('[data-adv]').forEach(function (el) { el.addEventListener('click', function () { advance(el.dataset.adv, 1); }); });
    box.querySelectorAll('[data-back]').forEach(function (el) { el.addEventListener('click', function () { advance(el.dataset.back, -1); }); });
    box.querySelectorAll('[data-del]').forEach(function (el) { el.addEventListener('click', function () { if (confirm('Remove from board?')) { save(DB.tickets, tickets().filter(function (t) { return t.id !== el.dataset.del; })); renderBoard(); } }); });
  }

  function advance(id, dir) {
    var list = tickets();
    list.forEach(function (t) {
      if (t.id !== id) return;
      t.step = Math.max(0, Math.min(6, t.step + dir));
      if (t.step === 5 && !t.notified) { t.notified = true; notifyReady(t); }
      if (t.step === 6) { // picked up -> count a loyalty stamp for full grooms
        if (t.services.some(function (s) { return /Full Groom/.test(s); })) save(DB.loyalty, load(DB.loyalty, 0) + 1);
      }
    });
    save(DB.tickets, list); renderBoard();
  }

  function notifyReady(t) {
    toast(t.petName + ' is ready for pickup! 🔔');
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('🐩 ' + t.petName + ' is ready for pickup!', { body: 'The Pink Poodle · Ref ' + t.code }); } catch (e) {}
    }
  }

  $('walkInBtn').addEventListener('click', function () {
    var name = prompt("Walk-in — pet's name?"); if (!name) return;
    var t = { id: uid(), code: code(), createdAt: Date.now(), date: todayISO(), petName: name.trim(), services: ['Walk-in'], stylist: boardFilter === 'All' ? 'Britni' : boardFilter, requestedTime: 'now', est: 0, step: 1, notified: false, petNotes: '' };
    var list = tickets(); list.unshift(t); save(DB.tickets, list); renderBoard(); toast('Checked in ' + name);
  });

  /* =================================================================
     STAFF PIN GATE
     ================================================================= */
  function staffUnlocked() { return sessionStorage.getItem('pp_spa_staff') === '1'; }
  function setStaff(on) {
    sessionStorage.setItem('pp_spa_staff', on ? '1' : '0');
    $('staffToggle').classList.toggle('on', on);
    $('staffToggle').textContent = on ? '🔓 Staff' : '🔒 Staff';
    document.querySelector('.nav__staff').classList.toggle('hidden', !on);
    if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  $('staffToggle').addEventListener('click', function () {
    if (staffUnlocked()) { setStaff(false); go('home'); return; }
    $('pinInput').value = ''; $('pinModal').classList.add('open'); setTimeout(function () { $('pinInput').focus(); }, 100);
  });
  $('pinGo').addEventListener('click', function () {
    if ($('pinInput').value.trim() === STAFF_PIN) { $('pinModal').classList.remove('open'); setStaff(true); go('staff'); }
    else { toast('Wrong PIN'); }
  });
  $('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pinGo').click(); });
  $('pinCancel').addEventListener('click', function () { $('pinModal').classList.remove('open'); });

  /* =================================================================
     CROSS-TAB SYNC + INIT
     ================================================================= */
  window.addEventListener('storage', function (e) {
    if (Object.values(DB).indexOf(e.key) < 0) return;
    var view = document.querySelector('.view:not(.hidden)');
    var v = view ? view.dataset.view : 'home';
    if (v === 'staff') renderBoard();
    if (v === 'track') renderTrack();
    if (v === 'home') renderPetPicker();
    if (v === 'pets') renderPetCards();
  });

  // default date = today
  $('bkDate').min = todayISO(); $('bkDate').value = todayISO();
  renderPetPicker(); renderServices(); renderAddons(); renderStylists(); renderTotal();
  setStaff(staffUnlocked());

  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('spa-sw.js').catch(function () {}); }
})();
