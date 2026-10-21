# Demo script (5 minutes)

**Before:** `npm run dev`, open http://localhost:3000, press Ctrl+0 (100% zoom), click **Reset Data**.
Sample files are in `tests/corpus/`.

1. **Say:** "Vendor documents arrive in every shape. No templates, one AI read."
   Drag in `scanned_invoice.png` (a rotated, noisy scan) → toast shows invoice INV-5004 read and auto-posted.
2. Drag in `paragraph_invoice.txt`, then `forwarded_chain.eml` → same outcome from a plain paragraph and a forwarded chain
   (the chain contains a superseded "$8,000 estimate"; the AI picks the right $8,250).
3. Drag in `XYZ_Company.pdf` → **Needs Review: unapproved freight $45**. Then `EFGHI_Company.pdf` → **duplicate invoice number** caught.
4. Paste a jotted note into the text box: `apex mfg inv INV-9001 po 2024-106, 160 x 31.50, total 5040` → Process pasted text.
5. **Matches** → open the exception → read the plain-English reason and the check list → **Manually Approve** → it moves to Reports.
6. Overview → **Run Batch Processing** for the 15 pre-loaded invoices (10 pass, 5 exceptions).
7. **Acknowledgements** → shows the vendor delay applied (drop `ack_delay.txt` first to show it live).
8. **Reset Data** → back to the clean starting point.

**If Gemini is unavailable** (quota/network): stop the app and run
`$env:LLM_PROVIDER="fixture"; npm run dev`. The screen says "Test mode"; use only the `tests/corpus` files.
