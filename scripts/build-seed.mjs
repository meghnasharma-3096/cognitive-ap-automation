// Regenerates data/seed.json (the golden dataset used by "Reset data").
// Run: node scripts/build-seed.mjs
//
// The dataset is deliberately engineered so every invoice has a KNOWN outcome:
//
//   index  invoice          scenario                                   expected
//   -----  ---------------  -----------------------------------------  ----------
//   0-2,4,6,8,9,11,13       clean three-way match                      Success
//   1                       freight billed AND authorised on the PO    Success
//   7                       received 2 MORE than ordered               Success
//   3                       warehouse received 5 fewer than billed     Exception (quantity)
//   5                       $45 freight billed, PO authorises none     Exception (freight)
//   10                      billed 10 more than ordered/received       Exception (quantity)
//   12                      unit price +$5                             Exception (price)
//   14                      reuses invoice number of index 13          Exception (duplicate)
//
// Plus PO-4017 (XYZ Company) / PO-4019 (EFGHI Company) with receipts, so the two
// sample vendor-email PDFs have purchase orders to match against.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const VENDORS = ['Global Tech', 'Apex Mfg', 'Starlight Log', 'Logistics Plus', 'AWS Ent'];
const ACK = ['Confirmed', 'Delayed', 'Backorder', 'Price Change'];
const iso = (d) => `${d}T12:00:00.000Z`;

const purchaseorders = Array.from({ length: 15 }, (_, i) => {
  const qty = 100 + i * 10;
  const unit = 25.5 + i;
  const ack = ACK[i % 4];
  return {
    id: `po-${100 + i}`,
    po_number: `PO-2024-${100 + i}`,
    vendor_name: VENDORS[i % 5],
    item_sku: `SKU-${500 + i}`,
    item_details: `Industrial Component ${String.fromCharCode(65 + i)}`,
    expected_quantity: qty,
    unit_price: unit,
    expected_price: round2(qty * unit),
    freight_amount: i === 1 ? 12.5 : 0,
    expected_eta: iso(`2024-03-${String(1 + i).padStart(2, '0')}`),
    ack_status: ack,
    price_delta: ack === 'Price Change' ? round2(1.25 + i * 0.25) : 0,
  };
});

// Sample-email POs (office supplies; goods total 1,908.94 + $45 freight = 1,953.94 invoiced)
for (const [n, vendor] of [[4017, 'XYZ Company'], [4019, 'EFGHI Company']]) {
  purchaseorders.push({
    id: `po-${n}`,
    po_number: `PO-${n}`,
    vendor_name: vendor,
    item_sku: `OFC-SUP-${n}`,
    item_details: 'Office supplies (bulk order)',
    expected_quantity: 100,
    unit_price: 19.0894,
    expected_price: 1908.94,
    freight_amount: 0,
    expected_eta: iso('2026-03-08'),
    ack_status: 'Confirmed',
    price_delta: 0,
  });
}

const warehousereceipts = purchaseorders.slice(0, 15).map((po, i) => ({
  id: `rc-${100 + i}`,
  po_number: po.po_number,
  received_quantity: i === 3 ? po.expected_quantity - 5 : i === 7 ? po.expected_quantity + 2 : po.expected_quantity,
  condition: i === 3 ? 'Damaged' : 'Perfect',
  receipt_date: iso('2024-03-05'),
}));
for (const n of [4017, 4019]) {
  warehousereceipts.push({
    id: `rc-${n}`,
    po_number: `PO-${n}`,
    received_quantity: 100,
    condition: 'Perfect',
    receipt_date: iso('2026-03-10'),
  });
}

const vendorinvoices = purchaseorders.slice(0, 15).map((po, i) => {
  const billedQty = i === 10 ? po.expected_quantity + 10 : po.expected_quantity;
  const unit = i === 12 ? po.unit_price + 5 : po.unit_price;
  const freight = i === 1 ? 12.5 : i === 5 ? 45 : 0;
  return {
    id: `inv-${300 + i}`,
    invoice_number: i === 14 ? 'INV-2024-313' : `INV-2024-${300 + i}`,
    po_number: po.po_number,
    vendor_name: po.vendor_name,
    billed_quantity: billedQty,
    unit_price: unit,
    freight_amount: freight,
    total_amount: round2(billedQty * unit + freight),
    invoice_date: iso('2024-03-08'),
    match_status: 'Pending',
  };
});

const documentclusters = [
  {
    id: 'cl-1',
    cluster_name: 'Duplicate Invoices - Q1',
    category: 'Compliance',
    total_impact_amount: 12500.5,
    document_count: 24,
    status: 'Requires Review',
    description: 'Potential duplicate billing detected across multiple vendor portals.',
  },
  {
    id: 'cl-2',
    cluster_name: 'Price Variance - Logistics',
    category: 'Pricing',
    total_impact_amount: 8420,
    document_count: 15,
    status: 'Requires Review',
    description: 'Consistent 5% surcharge discrepancy from Starlight Logistics.',
  },
  {
    id: 'cl-3',
    cluster_name: 'Tax ID Mismatch',
    category: 'Regulatory',
    total_impact_amount: 0,
    document_count: 8,
    status: 'Requires Review',
    description: 'Vendor Tax IDs do not match ERP master data records.',
  },
];

// Historical ingestion feed shown on Overview (previously hardcoded in App.tsx and
// silently inserted on first load, twice under React StrictMode).
const ingesteddocuments = [
  ['INV-902341', 'Starlight Logistics', 'Invoice', 99.2, 'Auto-posted', '2026-03-12T08:20:00.000Z'],
  ['ACK-77281', 'AWS Enterprise', 'Acknowledgement', 97.8, 'Matched', '2026-03-12T08:17:00.000Z'],
  ['INQ-00129', 'Unknown Sender', 'Inquiry', 62.1, 'Needs Review', '2026-03-12T08:10:00.000Z'],
  ['INV-902342', 'Global Tech Corp', 'Invoice', 98.5, 'Auto-posted', '2026-03-12T08:07:00.000Z'],
  ['ACK-77282', 'Logistics Plus Inc', 'Acknowledgement', 94.2, 'Matched', '2026-03-12T08:04:00.000Z'],
  ['INV-902343', 'Apex Manufacturing', 'Invoice', 89.4, 'Needs Review', '2026-03-11T08:00:00.000Z'],
  ['INV-902344', 'Starlight Logistics', 'Invoice', 99.1, 'Auto-posted', '2026-03-10T08:00:00.000Z'],
].map(([id, vendor_name, intent, confidence_score, status, ingestion_date]) => ({
  id, document_name: `${id}.pdf`, vendor_name, intent, confidence_score, status, ingestion_date,
  invoice_number: intent === 'Invoice' ? id : null, source: 'seed',
}));

const seed = {
  purchaseorders,
  warehousereceipts,
  vendorinvoices,
  ingesteddocuments,
  documentclusters,
  auditlogs: [],
  successreports: [],
  exceptionreports: [],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(seed, null, 2) + '\n');
console.log('wrote', out, Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.length])));
