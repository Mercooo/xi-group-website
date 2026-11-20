# XI · 74: festival invitation and ticketing

The invitation website for the XI Group's 74th anniversary (1952 – 2026). Guests pick their seats on the theatre plan, pay 100 EGP a seat with InstaPay, upload the transfer screenshot, and get a QR ticket for every seat (also as a printable PDF). Unit leaders book seats without paying. The gate team scans tickets with a phone camera.

| Page | Who | What |
| --- | --- | --- |
| `/` | Everyone | Invitation, InstaPay box, booking form (Arabic, with an English toggle) |
| `/t/<code>` | Ticket holder | One QR per seat, status, printable PDF (one A5 page per seat), image, calendar file, sponsors' offers |
| `/leader` | Unit leaders (own passcode) | Book seats for members and families without InstaPay; list and cancel their bookings |
| `/gate` | Gate team (passcode) | Camera scanner: admitted / already used / not verified / unknown |
| `/admin` | Organisers (passcode) | Orders, receipt review, seat map, manual tickets with seats, leader accounts, settings, gate log, CSV |

## Seats

The hall is drawn from the organisers' plan in `src/lib/theatre.json`: 21 rows of left, middle and right blocks whose length changes row by row, 653 seats. Seat ids look like `07-M02` (row 7, middle seat 2), counted from the left facing the stage.

- **VIP:** the middle block of rows 1-5 (64 working seats). Everyone sees it on the plan; only the organisers give these seats out, from `/admin → إصدار تذكرة`.
- **Broken seats** (31) are crossed out and can't be booked by anyone.
- Both are kept off sale with a hold that never runs out (`organisers-vip` / `broken-seat` in `fest_seats.hold_token`); see `supabase/migrations/20261120_fest_74_theatre_plan_data.sql`.
- Choosing seats holds them for 15 minutes (`fest-seats`), so two guests can't pay for the same seat. One device can hold at most 20 seats; a booking has at most 10.
- The amount due is **seats × price**: 3 seats at 100 EGP need one transfer of exactly 300 EGP. Any other amount is `wrong_amount`.
- When the booking is accepted, the seats are claimed all at once and each gets its own ticket code. A rejected booking gives its seats back (VIP seats go back to the organisers); un-rejecting takes them again if nobody bought them meanwhile.
- Each seat's QR holds `/t/<booking>?seat=<seat code>`. The gate admits each seat once and shows its row and number. Scanning the booking's own code returns `seat_ticket_required`.
- Leaders (`fest_leaders`, managed in `/admin → القادة`) book through `fest-leader`. Their bookings are verified at once, marked with the leader, and don't count as revenue. A leader can have a seat quota.

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
   - The amount must equal the price × the number of seats.
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

- **Tables:** `fest_settings`, `fest_orders`, `fest_seats`, `fest_leaders`, `fest_scans`, `fest_auth_fails`, `fest_keys`, `fest_read_tokens`. RLS is on with no policies, so only the functions can reach them.
- **Functions:** `fest-buy`, `fest-ticket`, `fest-seats` (public), `fest-gate`, `fest-admin`, `fest-leader` (passcode in the `x-fest-key` header). All are deployed with `verify_jwt = false`.
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
