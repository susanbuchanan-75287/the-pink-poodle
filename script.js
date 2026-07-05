// ===== Nav: scroll state + mobile toggle =====
const nav = document.getElementById('nav');
const navToggle = document.getElementById('navToggle');
const navMobile = document.getElementById('navMobile');

const onScroll = () => nav.classList.toggle('nav--scrolled', window.scrollY > 40);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

navToggle.addEventListener('click', () => {
  const open = navMobile.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
});
navMobile.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => {
    navMobile.classList.remove('open');
    navToggle.setAttribute('aria-expanded', false);
  })
);

// ===== Footer year =====
document.getElementById('year').textContent = new Date().getFullYear();

// ===== Booking form -> pre-filled SMS to Britni's phone =====
const SALON_PHONE = '3049212748'; // Britni's cell
const form = document.getElementById('bookForm');

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const val = (id) => (document.getElementById(id).value || '').trim();
  const owner = val('ownerName');

  if (!owner) {
    document.getElementById('ownerName').focus();
    return;
  }

  const dog = val('dogName');
  const breed = val('breed');
  const service = val('service');
  const when = val('prefDate');
  const notes = val('notes');

  const lines = [
    'Hi Britni! I\'d like to book an appointment at The Pink Poodle.',
    `Name: ${owner}`,
    dog ? `Dog: ${dog}${breed ? ` (${breed})` : ''}` : (breed ? `Breed/Size: ${breed}` : ''),
    `Service: ${service}`,
    when ? `Preferred: ${when}` : '',
    notes ? `Notes: ${notes}` : ''
  ].filter(Boolean);

  const body = encodeURIComponent(lines.join('\n'));

  // iOS uses "&", Android/most others use "?"; provide a body that works broadly.
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const sep = isiOS ? '&' : '?';
  const smsUrl = `sms:${SALON_PHONE}${sep}body=${body}`;

  window.location.href = smsUrl;
});

// ===== Gallery: render from manifest, then lightbox =====
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = lightbox.querySelector('.lightbox__close');

const closeLightbox = () => {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImg.src = '';
};
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

const openLightbox = (src, alt) => {
  lightboxImg.src = src;
  lightboxImg.alt = alt;
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
};

async function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  let items = [];
  try {
    const res = await fetch('gallery.json?t=' + Date.now());
    if (res.ok) items = await res.json();
  } catch (_) { /* keep noscript fallback */ }
  if (!Array.isArray(items) || !items.length) return;

  grid.innerHTML = '';
  items.forEach((item, i) => {
    const fig = document.createElement('figure');
    fig.className = 'gallery__item reveal' + (item.tall ? ' gallery__item--tall' : '');
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.alt || item.caption || 'A freshly groomed pup at The Pink Poodle';
    if (item.w) img.width = item.w;
    if (item.h) img.height = item.h;
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
    fig.appendChild(img);
    if (item.caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = item.caption;
      fig.appendChild(cap);
    }
    grid.appendChild(fig);
    if (window.__revealObserver) window.__revealObserver.observe(fig);
    else fig.classList.add('in');
  });
}

// ===== Reveal on scroll =====
const revealEls = document.querySelectorAll(
  '.about__grid, .card, .gallery__item, .review, .book__intro, .book__form, .visit__grid, .section__head'
);
revealEls.forEach(el => el.classList.add('reveal'));

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.transitionDelay = `${(i % 4) * 80}ms`;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  window.__revealObserver = io;
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('in'));
}

// Render the gallery once the observer is ready
renderGallery();
