/**
 * Offline fallback parser. NOT the smart path (that's the LLM). It exists so the
 * app still does something sensible with no API key / no network, and so tests
 * have a deterministic baseline. Text only: it cannot read scans or images.
 * Its confidence is capped below what a verified LLM read can reach.
 */
import { normPo } from '../matchEngine';
import { numberInText, toNumber } from './normalize';

const AMT = String.raw`\$?\s*([\d]{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;

const first = (text: string, patterns: RegExp[]): { value: string; quote: string } | null => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return { value: m[1].trim(), quote: m[0].trim() };
  }
  return null;
};

function cleanVendor(s: string): string {
  let v = s.replace(/\s+/g, ' ').trim();
  // PDF text flattens "Name / Role / Company" onto one line; drop the person + role prefix.
  v = v.replace(/^.*\b(?:Accounts (?:Receivable|Payable)|Billing|Finance|Sales|Support|Department|Team)\s+/i, '');
  const words = v.split(' ');
  if (words.length > 4) v = words.slice(-3).join(' ');
  return v.replace(/[.,;]+$/, '');
}

function vendorFrom(text: string, senderEmail: string | null): string | null {
  const re = /\b([A-Z][A-Za-z0-9&.'-]*(?: [A-Z][A-Za-z0-9&.'-]*){0,4} (?:Company|Co\.|Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Limited|Pvt\.? Ltd\.?|GmbH))\b/g;
  const hits = [...text.matchAll(re)].map(m => m[1]);
  if (hits.length) return cleanVendor(hits[hits.length - 1]);
  // No reliable name in the text. A guess from the e-mail domain would cause false vendor mismatches, so say "unknown".
  void senderEmail;
  return null;
}

export function rulesExtract(text: string): any {
  const t = text ?? '';
  const evidence: { field: string; quote: string }[] = [];

  const senderM = t.match(/From:\s*(?:[^<\n@]*<)?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i) ?? t.match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/);
  const sender = senderM ? senderM[1].toLowerCase() : null;

  // --- invoice number
  const inv = first(t, [
    /invoice\s*(?:number|no\.?|num|id|#)?\s*(?:is|:)?\s*#?\s*((?:INV|BILL|IN)[-\s]?[A-Z0-9][A-Z0-9\-/]*)/i,
    /\b(INV[-\s]?\d[\w-]*)/i,
    /invoice\s*(?:number|no\.?|num|id|#)\s*(?:is|:)?\s*#?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  ]);

  // --- PO numbers: mentions in the body win over the Subject line; the rest are reported as "other POs".
  const poRe = /\bPO[-\s#:]*([A-Z0-9]*\d[A-Z0-9-]*)/gi;
  const subjMatch = t.match(/Subject:(.*?)(?=\b(?:Hi|Hello|Dear)\b|\n\s*\n|$)/is);
  const bodyText = subjMatch ? t.replace(subjMatch[0], ' ') : t;
  const uniq = (a: string[]) => [...new Set(a)];
  const poList = (s: string) => uniq([...s.matchAll(poRe)].map(m => normPo(`PO-${m[1]}`)));
  const ordered = uniq([...poList(bodyText), ...poList(subjMatch?.[1] ?? '')]);
  const poPrimary = ordered[0] ?? null;
  const poOthers = ordered.slice(1);
  if (poPrimary) {
    const q = t.match(new RegExp(`.{0,25}${poPrimary.replace('PO-', 'PO[-\\s#:]*')}.{0,10}`, 'i'));
    if (q) evidence.push({ field: 'po_number', quote: q[0].trim() });
  }

  // --- total (prefer explicit "due/grand/payable" phrasing)
  const total = first(t, [
    new RegExp(String.raw`(?:total\s+amount\s+due|amount\s+due|total\s+due|grand\s+total|total\s+payable|balance\s+due)[^0-9$\n]{0,25}` + AMT, 'i'),
    new RegExp(String.raw`\btotal\b[^0-9$\n]{0,25}` + AMT, 'i'),
    new RegExp(String.raw`(?:pay|payment of|owed?)[^0-9$\n]{0,15}` + AMT, 'i'),
  ]);

  // --- freight: "$45.00 freight charge"  or  "freight: $45.00"
  const freight = first(t, [
    new RegExp(String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:freight|shipping|delivery)`, 'i'),
    new RegExp(String.raw`(?:freight|shipping|delivery|postage)(?:\s+charges?)?[^0-9$\n]{0,30}` + AMT, 'i'),
  ]);

  // --- line items: "40 x Widget @ 12.50" / "40 units of Widget at $12.50"
  const items: any[] = [];
  for (const m of t.matchAll(/(\d+)\s*(?:x|×|units? of|pcs? of)\s+([^@\n$]+?)\s*(?:@|at)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    const q = Number(m[1]), u = toNumber(m[3])!;
    items.push({ description: m[2].trim(), sku: null, quantity: q, unit_price: u, amount: Math.round(q * u * 100) / 100 });
  }

  const date = t.match(/Date:\s*([A-Za-z]+\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  const vendor = vendorFrom(t, sender);

  const lower = t.toLowerCase();
  const ackWords = /(delay|delayed|backorder|back-order|split shipment|can only ship|will ship|shipping on|eta\b|confirm(?:ed|ation)? (?:your )?(?:order|po)|price (?:change|increase|update))/i.test(lower);
  let type: 'invoice' | 'acknowledgement' | 'inquiry' | 'other';
  if (inv && total) type = 'invoice';
  else if (/invoice|amount due|payment due|please remit/i.test(lower) && total) type = 'invoice';
  else if (ackWords && poPrimary) type = 'acknowledgement';
  else if (/\?/.test(t) || /(question|could you|can you|please advise|status of)/i.test(lower)) type = 'inquiry';
  else type = 'other';

  let ack: any = null;
  if (type === 'acknowledgement') {
    let status: string | null = 'Confirmed';
    if (/price (?:change|increase|update)|new price/i.test(lower)) status = 'Price Change';
    else if (/backorder|back-order|out of stock/i.test(lower)) status = 'Backorder';
    else if (/split|can only ship|partial/i.test(lower)) status = 'Split Shipment';
    else if (/delay|postpone|pushed|late/i.test(lower)) status = 'Delayed';
    const qty = t.match(/(\d+)\s*(?:units?|pcs?|pieces)/i)?.[1];
    const eta = t.match(/(?:eta|ship(?:ping)? (?:date|on)|by)\s*:?\s*([A-Za-z]+\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
    ack = { status, quantity: qty ? Number(qty) : null, eta, new_unit_price: null };
  }

  if (inv) evidence.push({ field: 'invoice_number', quote: inv.quote });
  if (total) evidence.push({ field: 'total_amount', quote: total.quote });
  if (freight) evidence.push({ field: 'freight_amount', quote: freight.quote });

  // Capped confidence: more fields found -> more trust, but never as high as a verified LLM read.
  let confidence = 0.45;
  if (type === 'invoice') confidence += (inv ? 0.14 : 0) + (total ? 0.14 : 0) + (poPrimary ? 0.1 : 0) + (vendor ? 0.07 : 0) + (sender ? 0.03 : 0);
  else if (type === 'acknowledgement') confidence = poPrimary ? 0.72 : 0.5;
  else confidence = 0.55;

  const summaryBy: Record<string, string> = {
    invoice: `Invoice${inv ? ' ' + inv.value : ''}${total ? ` for $${toNumber(total.value)?.toFixed(2)}` : ''}${poPrimary ? ` against ${poPrimary}` : ''}.`,
    acknowledgement: `Vendor ${ack?.status?.toLowerCase() ?? 'update'} regarding ${poPrimary}.`,
    inquiry: 'Vendor inquiry needing a human response.',
    other: 'Unclassified document.',
  };

  return {
    document_type: type,
    confidence: Math.min(0.88, confidence),
    vendor_name: vendor,
    sender_email: sender,
    invoice_number: type === 'invoice' ? inv?.value ?? null : null,
    invoice_date: date,
    po_number: poPrimary,
    other_po_numbers: poOthers,
    currency: /\$|usd/i.test(t) ? 'USD' : null,
    line_items: items,
    subtotal: null,
    freight_amount: type === 'invoice' && freight ? toNumber(freight.value) : null,
    tax_amount: null,
    total_amount: type === 'invoice' && total ? toNumber(total.value) : null,
    payment_terms: t.match(/\bnet\s*\d+\b/i)?.[0] ?? null,
    acknowledgement: ack,
    summary: summaryBy[type],
    evidence: evidence.filter(e => e.quote),
  };
}

export { numberInText };
