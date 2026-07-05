# Security Policy

## Reporting a vulnerability

If you discover a security issue with The Pink Poodle website or its booking
backend, please email **groomerbrit@yahoo.com** (subject: "Security") rather
than opening a public issue. We'll respond as quickly as we can.

## How this site is protected

**Static site (GitHub Pages)**
- Served over HTTPS only — HTTP is redirected to HTTPS (HSTS via GitHub Pages).
- No server, database, or user accounts on the site itself, so there is no
  login, session, or SQL surface to attack.
- Gallery content is rendered with text-only DOM APIs (`textContent`), so
  captions/breeds can't inject scripts (no stored XSS).

**Booking + admin backend (Firebase Cloud Functions)**
- **Rate limiting:** the public booking endpoint (`pinkPoodleBook`) allows at
  most 6 requests per IP per 10 minutes; excess requests get HTTP 429. This
  protects Britni's inbox and the email/SMS quota from spam floods.
- **Honeypot:** a hidden `company` field silently drops automated bot
  submissions.
- **Input validation:** every field is length-capped and the email format is
  checked before anything is sent or stored.
- **CORS lockdown:** functions only accept browser requests from
  `*.pinkpoodle.dog` (and localhost for testing).
- **Admin passphrase:** the Salon Console requires a passphrase, compared in
  **constant time** (no timing leak). Wrong guesses are throttled — 8 failed
  attempts per IP per 10 minutes triggers HTTP 429, blocking brute force.
- **Secrets** (SendGrid, Twilio, GitHub token, Facebook token, passphrase) are
  stored in Google Secret Manager — never committed to the repo.

## Dependency & repository hygiene

- **Dependabot** is enabled: security alerts, automated security-update PRs, and
  a weekly `dependabot.yml` schedule for the `/functions` npm packages and
  GitHub Actions.
- **Secret scanning** and **push protection** are enabled on the repository, so
  credentials can't be accidentally committed.
- Backend dependencies are kept current; `npm audit` reports **0
  vulnerabilities** as of the latest deploy.
