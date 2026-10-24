# Cognitive AP Automation

**Live URL:** [https://cognitive-ap-automation.onrender.com](https://cognitive-ap-automation.onrender.com) (free tier: first load takes about a minute; replay mode, no live LLM key)

LLM-first accounts-payable prototype: vendor documents go in (any format), the model reads them, a deterministic engine does the three-way match (PO / goods receipt / invoice), humans handle the exceptions.

## Run it

```bash
npm install
cp .env.example .env      # put your GEMINI_API_KEY in .env (optional, see below)
npm run dev               # http://localhost:3000
```

No database to set up. Data lives in `data/db.json` (created from `data/seed.json` on first run).

| Command | What it does |
|---|---|
| `npm test` | 80+ tests: data layer, match engine, ingestion over the whole corpus |
| `npm run eval:live` | Runs `tests/corpus` through the **real** Gemini model and diffs against ground truth |
| `npm run eval:live -- --record` | Same, and saves Gemini's answers as the replay fixtures |
| `npm run corpus` | Regenerates the test corpus (needs Python + Pillow) |
| Reset button / `POST /api/reset` | Restores the golden seed data at any time |

## Getting documents in

1. **UI**: drag & drop or browse (PDF, PNG/JPG scans, `.eml`, `.txt`), several at once; or paste text.
2. **Inbox folder**: drop files into `data/inbox/`; they are picked up within seconds and moved to `processed/` or `failed/`.
3. **API**: `POST /api/ingest` with `{ filename, dataBase64 }` or `{ filename, text }`.

Every path runs the same pipeline: one Gemini call classifies **and** extracts (no layout templates), a deterministic audit checks the answer against the source (arithmetic, values present in the text, multiple POs), then the invoice is matched. Low-confidence reads, LLM outages and unreadable files go to **Needs Review**, never auto-posted.

## Gemini quota

A free-tier key allows only ~20 requests/day per model (the app then says so plainly). Turn on billing for the key in Google AI Studio for demos. See `DEMO.md` for a 5-minute walkthrough.

## Without a Gemini key

The app falls back to a text-only offline parser (clearly labelled in the UI). It cannot read scans or images. `LLM_PROVIDER=fixture` replays the recorded answers in `tests/corpus/*.llm.json` (used by tests and offline demos).

## Match rules

Duplicate invoice (same invoice number alone) · PO missing · receipt missing · vendor mismatch · billed qty vs received / ordered · unit price (tolerance `AP_TOLERANCE`, default $5) · unapproved freight · missing total. A manual approval is never overwritten by the engine.

## Layout

`server/` Express API + JSON store + match engine + extraction · `src/` React UI · `tests/corpus/` sample documents + ground truth · `data/seed.json` golden data.

## Hosting a public demo (free)

The app needs a Node host (GitHub Pages cannot run the API). A `Dockerfile` and `render.yaml` are included:

1. Push the branch to GitHub. On https://render.com choose **New > Blueprint** and pick this repo.
2. It builds and starts in **demo (replay) mode** (`LLM_PROVIDER=fixture`): the 11 sample documents are read from recorded answers, so no key is needed. Any other pasted text or text file is read by the offline parser and always goes to the Needs Review queue; scans and images need a Gemini key.
3. To read arbitrary documents live, delete `LLM_PROVIDER` in the service settings and add `GEMINI_API_KEY`.

Locally: `npm run build && NODE_ENV=production npm start`.

Notes: the free tier sleeps after idle time (first load is slow), and data resets whenever the service restarts. Anyone with the link can use the app and press Reset, so do not put real data or a paid key on a public URL.
