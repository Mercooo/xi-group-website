// OCR text → fields → verdict. Run with `npm test`. FAIL lines mean behaviour changed.
import { parseReceiptText } from "../supabase/functions/_shared/textparse.ts";
import { judge } from "../supabase/functions/_shared/rules.ts";

const r = { handles: ["marcomoheb12345@instapay"], names: ["Marco Moheb", "ماركو مهيب"], phones: ["01002500663"] };
const now = new Date("2026-11-13T12:00:00Z");
const cases: [string, string, string][] = [
  ["english app, handle shown", `InstaPay\nTransaction Successful\nEGP 100.00\n\nMARCO MOHEB To\nmarcomoheb12345@instapay Receiver IPA\nMINA M*** From\n990011229999 Reference Number\n13 Nov 2026 04:35 PM Date\n`, "verified"],
  ["ltr layout, masked phone", `InstaPay\nSuccessful\nAmount\n100.00 EGP\nFees 0.00 EGP\nTo\nMarco Moheb\n0100****663\nFrom\nAndrew Sami\nReference No.\nIPN20261113ABC1234\nDate 13/11/2026 1:22 PM`, "verified"],
  ["arabic, digits misread", `‎٠١‏ جنيه\nإلى ‎MARCO M***‏\nرقم الموبايل 663+++*0100\nمن ‎MINA AZIZ‏\nالرقم المرجعي 778899001122\nالتاريخ ‎PM‏ 02:10 13/11/2026\n`, "review"],
  ["marco is the sender", `InstaPay\nSuccessful\nAmount 100 EGP\nFrom\nmarcomoheb12345@instapay\nTo\nsomeone@instapay\nReference 123456789012\n13/11/2026`, "review"],
  ["wrong amount", `InstaPay\nSuccessful\nAmount 50 EGP\nTo marcomoheb12345@instapay\nReference 123456789099\n13/11/2026`, "review"],
  ["failed transfer", `InstaPay\nTransaction Failed\nAmount 100 EGP\nTo marcomoheb12345@instapay\nReference 123456789077\n13/11/2026`, "review"],
  ["not a receipt", `hello`, "review"],
];
for (const [label, text, expect] of cases) {
  const v = judge(parseReceiptText(text, r), { price: 100, recipient: r, salesStart: "2026-11-12", now, strict: false });
  const ok = v.status === expect;
  if (!ok) process.exitCode = 1;
  console.log(ok ? "ok  " : "FAIL", label, v.status, v.reasons.join(","));
}
