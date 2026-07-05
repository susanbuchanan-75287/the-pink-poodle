# The Pink Poodle 🐩

Marketing website for **The Pink Poodle** — a locally owned luxury pet salon in Princeton, West Virginia, owned and operated by Britni.

**Live site:** https://pinkpoodle.dog

## About
Static, single-page site (no build step). Just HTML, CSS, and vanilla JS — fast, secure, and free to host on GitHub Pages.

| File | Purpose |
|------|---------|
| `index.html` | All page content & sections |
| `styles.css` | Blush/pink upscale theme, responsive layout |
| `script.js` | Nav, gallery lightbox, scroll reveals, SMS booking composer |
| `assets/` | Photos of Britni, Paris, and freshly-groomed pups |
| `CNAME` | Custom domain for GitHub Pages (`pinkpoodle.dog`) |

## Booking → text notification
The booking form on the site does **not** need a server. When a visitor fills it out and taps **Send Booking Text**, their phone opens Messages with a pre-filled text (name, dog, breed, service, preferred time) addressed to **304-921-2748** — so the appointment request arrives on Britni's phone as a normal SMS. Click-to-call and email links are provided as fallbacks.

To change the phone number, edit `SALON_PHONE` in `script.js`.

## SEO
The site is optimized for local search ("dog grooming Princeton WV" and similar):
- Descriptive title, meta description & keywords, canonical URL, and `robots` directives
- **Geo meta tags** (region, placename, coordinates) targeting Princeton / Mercer County, WV
- **Open Graph + Twitter Card** tags for rich link previews on Facebook, iMessage, etc.
- **Schema.org structured data** — `PetGroomer`/`LocalBusiness` (address, geo, hours-ready, services, areaServed, sameAs) and a `FAQPage` for rich results
- `sitemap.xml` (with image sitemap) and `robots.txt`
- Semantic headings, descriptive `alt` text, and explicit image `width`/`height` for Core Web Vitals

After the domain is live, submit `https://pinkpoodle.dog/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) and create/claim the [Google Business Profile](https://business.google.com) for the strongest local ranking.

## Hosting (GitHub Pages)
1. Repo: `susanbuchanan-75287/the-pink-poodle`
2. Settings → Pages → Source: **Deploy from a branch** → `main` / root
3. Custom domain: `pinkpoodle.dog` (set via the `CNAME` file)

### DNS
Point the domain's DNS at GitHub Pages:

**Apex `pinkpoodle.dog`** — four A records:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
(and optionally AAAA records for IPv6.)

**`www.pinkpoodle.dog`** — CNAME → `susanbuchanan-75287.github.io`

**Second domain `thepinkpoodle.dog`** — set up a forward/redirect at your registrar to `https://pinkpoodle.dog` (most registrars offer free domain forwarding).

## Updating content
- **Text/services/reviews:** edit `index.html`
- **Colors/fonts:** edit the `:root` variables at the top of `styles.css`
- **Photos:** drop new images in `assets/` and reference them in `index.html`

_Made with 🩷_
