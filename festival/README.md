# XI · 74: festival invitation and ticketing

The invitation website for the XI Group's 74th anniversary (1952 – 2026). Guests pay 100 EGP with InstaPay, upload the transfer screenshot, and get a QR ticket. The gate team scans tickets with a phone camera.

| Page | Who | What |
| --- | --- | --- |
| `/` | Everyone | Invitation, InstaPay box, booking form (Arabic, with an English toggle) |
| `/t/<code>` | Ticket holder | Ticket with QR, status, calendar file, saved image, sponsors' offers |
| `/gate` | Gate team (passcode) | Camera scanner: admitted / already used / not verified / unknown |
| `/admin` | Organisers (passcode) | Orders, receipt review, manual tickets, settings, gate log, CSV |

The sponsors and offers page is part of the group website: `/sponsors`, driven by `src/data/sponsors.json` in the parent project.

## How a ticket is checked

1. `fest-buy` stores the screenshot in the private `fest-receipts` bucket. It refuses a screenshot that was already used, matched by SHA-256.
2. The first available reader transcribes the screenshot (amount, receiver, reference, date, status):

   | Reader | When | Cost |
   | --- | --- | --- |
   | Claude vision (`claude-opus-5-5`, structured output, server-side fallback) | `ANTHROPIC_API_KEY` is set | Paid |
   | Gemini vision (`gemini-3.8-flash`, then fallbacks) | `GEMINI_API_KEY` is set | Free tier |
   | Tesseract OCR (English + Arabic), `/api/ocr` on this site | Always | Free, no key, no AI |

   If an AI reader fails, the next one is used.
3. Fixed rules decide the outcome. They live in `supabase/functions/_shared/rules.ts`, with OCR text parsing in `textparse.ts`.
   - The amount must equal the price.
   - The receiver must match the InstaPay address, phone or name set in `/admin`.
   - The transfer must show as successful.
   - The reference must not have been used for another ticket.
   - The date must not be before sales opened.
4. The result is one of three:
   - **verified**: the QR appears at once.
   - **review**: an organiser approves it in `/admin`, and the ticket page updates by itself.
   - **rejected**: clearly wrong. Only the AI readers can reject; plain OCR can misread, so it sends doubtful receipts to review instead.

At the gate, `fest_check_in()` admits a verified ticket exactly once, in a single database statement. Every scan is logged.

## Backend (Supabase project `ckuiiqfdlvtcfleglqce`)

- **Tables:** `fest_settings`, `fest_orders`, `fest_scans`, `fest_auth_fails`, `fest_keys`. RLS is on with no policies, so only the functions can reach them.
- **Functions:** `fest-buy`, `fest-ticket` (public), `fest-gate`, `fest-admin` (passcode in the `x-fest-key` header). All are deployed with `verify_jwt = false`.
- **Passcodes** are stored as salted PBKDF2 hashes in `fest_keys` and changed from `/admin → الإعدادات → كلمات السر`.
  - The admin passcode opens `/admin` and `/gate`. The gate passcode opens `/gate` only.
  - Ten wrong passcodes from one address lock it out for ten minutes.
  - `FEST_ADMIN_PASSCODE` and `FEST_GATE_PASSCODE`, if set as Edge Function secrets, also work.
- **Optional Edge Function secrets:** `GEMINI_API_KEY` (free, better on Arabic screenshots) and `ANTHROPIC_API_KEY`.

Everything else lives in `/admin → الإعدادات` and changes the site without a redeploy:
- price, capacity, and opening date
- InstaPay link and handle
- the receiver details used for matching
- event date and venue
- WhatsApp contact and sponsors link

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm test         # receipt rule checks
npm run build
```

Deployed on Vercel as its own project, with **Root Directory** set to `festival`.
- Pages are static. `/api/ocr` is the only Vercel Function.
- `vercel.json` rewrites `/t/<code>` to the ticket page and allows the camera only on `/gate`.
