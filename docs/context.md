# FlowGuardian AI — context din discuția inițială

## Module
- **AI Website Tester** — introduci URL-ul, AI-ul propune teste (butoane, formulare, coș, căutare); utilizatorul le aprobă; primește raport.
- **API Guardian** — monitorizează API-uri: disponibilitate, viteză, status HTTP, reguli pe JSON (ex. `products.length > 0`).
- **FlowFix** — automatizări la incidente: email, tichete, alte acțiuni.

## Funcția de atragere
„Introdu URL-ul și descoperă ce nu funcționează pe site-ul tău.” Scan gratuit → abonament pentru monitorizare continuă + automatizări.
Public: programatori, proprietari de magazine, freelanceri, agenții web.

## Niveluri
| Nivel    | Ce testează               | Ce oferă utilizatorul |
| -------- | ------------------------- | --------------------- |
| Basic    | Disponibilitate și viteză | URL                   |
| Smart    | Status HTTP și date JSON  | URL + reguli          |
| Browser  | Butoane, formulare, coș   | URL + pași de test    |
| Advanced | API-uri private           | Autorizare limitată   |

## Principiu AI
AI-ul ajută la configurare și interpretare; sistemul clasic (Playwright, HTTP checks) execută testele periodic. Mai ieftin și mai fiabil.

## Prototip (validare înainte de MVP)
Testează fiabil, pe site-uri diferite (țintă 20–30, >85% succes):
1. încărcarea paginii;
2. funcționarea unui buton;
3. completarea unui formular de test.

Primul pas UX: dashboard → introduci URL → vezi teste propuse → aprobi → rezultate.

## Teste flaky → FlowFix
La eșec: retry → diagnostic (comparare cu ultima rulare reușită: screenshot, DOM, text/rol).
- **Selector schimbat** (element similar există) → notificare de mentenanță, prioritate mică, selector propus + încredere; aprobare cu un click în app, re-rulare imediată.
- **Bug real** (pasul merge, rezultatul e greșit) → incident urgent (email/tichet).
- Selectori multipli salvați per element (rol+text, data-testid, CSS) ca fallback.
- Fără auto-update la început; istoric de versiuni pentru workflow-uri; mentenanța grupată în digest zilnic.

## Riscuri
- Teste flaky / alarme false.
- Protecție anti-bot (Cloudflare, captcha).
- Autorizare: verificare proprietate site (DNS TXT / meta tag).
- Efecte secundare: formulare reale, comenzi — date de test, oprire înainte de plată.
- Cost rulări browser — frecvență legată de plan.

## Stack (propus)
- **Supabase**: Postgres, Auth, RLS, Realtime (rezultate live), Storage (screenshot-uri, DOM), pg_cron (programare).
- **Worker Playwright** separat (Node, Docker pe Fly.io/Railway/VPS) — Edge Functions nu pot rula browser. Preia joburi dintr-o coadă în Postgres, scrie rezultatele înapoi.
- **Frontend**: React + Vite, `@supabase/supabase-js`.
- API Guardian (HTTP checks simple) poate rula în Edge Functions sau în worker.

## Buget: 0 € (prototip)
- DB/Auth/Storage: Supabase Free (keep-alive ca să nu intre în pauză).
- Worker: local pe PC → apoi Oracle Cloud Always Free (ARM, până la 4 CPU / 24 GB) sau GitHub Actions cron.
- Frontend: Cloudflare Pages / Vercel / Netlify free.
- AI: Gemini API free tier / Groq free / Ollama local.
- Email: Resend free.

## Decizii
- Worker: **GitHub Actions** (cron + workflow_dispatch pentru „Rulează acum”), repo public, chei în GitHub Secrets. Mai târziu: Oracle Always Free.
- Render free nu merge (512 MB RAM, sleep, fără background workers).
- Schema DB: `backend/supabase/migrations/0001_init.sql` (sites, tests, test_steps, runs, incidents + RLS + `enqueue_due_runs`, `claim_next_run`).
- Raport overview (schema v1, `worker/src/report.mjs`): verdicte după cloudflare/security-audit-skill — `confirmed` (+severity high/medium/low/hardening), `needs_validation` (nemăsurat, fără severity), `rejected` (OK). Header-e lipsă = `hardening`, nu vulnerabilitate. Include hartă site (din crawl) + arhitectură detectată.

## Concurență
Checkly, Datadog Synthetics, Ghost Inspector, UptimeRobot, Octomind, Momentic, QA Wolf.
Diferențiere: utilizatori netehnici, rapoarte în limbaj simplu (inclusiv română), nișă WooCommerce/Shopify, încredere (puține alarme false).
