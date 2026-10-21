/**
 * What the LLM must return for ANY inbound vendor document, and the prompt
 * that makes it do so. One call classifies AND extracts, so there is no
 * layout-specific OCR template anywhere: scans, layout PDFs, plain-text emails,
 * jotted lists and forwarded chains all go through the same path.
 */
import { Type } from '@google/genai';

export type DocType = 'invoice' | 'acknowledgement' | 'inquiry' | 'other';
export type AckStatus = 'Confirmed' | 'Delayed' | 'Backorder' | 'Split Shipment' | 'Price Change';

export interface LineItem {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

export interface Extraction {
  document_type: DocType;
  /** Model's own confidence 0..1 that it read the document correctly. */
  confidence: number;
  vendor_name: string | null;
  sender_email: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  po_number: string | null;
  other_po_numbers: string[];
  currency: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  freight_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  payment_terms: string | null;
  acknowledgement: {
    status: AckStatus | null;
    quantity: number | null;
    eta: string | null;
    new_unit_price: number | null;
  } | null;
  summary: string | null;
  /** Verbatim snippets from the document backing the key fields (verified server-side). */
  evidence: { field: string; quote: string }[];
}

export const EVIDENCE_FIELDS = ['invoice_number', 'po_number', 'total_amount', 'freight_amount'] as const;

const nullableString = { type: Type.STRING, nullable: true };
const nullableNumber = { type: Type.NUMBER, nullable: true };

export const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    document_type: { type: Type.STRING, enum: ['invoice', 'acknowledgement', 'inquiry', 'other'] },
    confidence: { type: Type.NUMBER },
    vendor_name: nullableString,
    sender_email: nullableString,
    invoice_number: nullableString,
    invoice_date: nullableString,
    po_number: nullableString,
    other_po_numbers: { type: Type.ARRAY, items: { type: Type.STRING } },
    currency: nullableString,
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: nullableString,
          sku: nullableString,
          quantity: nullableNumber,
          unit_price: nullableNumber,
          amount: nullableNumber,
        },
        required: ['description', 'sku', 'quantity', 'unit_price', 'amount'],
      },
    },
    subtotal: nullableNumber,
    freight_amount: nullableNumber,
    tax_amount: nullableNumber,
    total_amount: nullableNumber,
    payment_terms: nullableString,
    acknowledgement: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        status: { type: Type.STRING, nullable: true, enum: ['Confirmed', 'Delayed', 'Backorder', 'Split Shipment', 'Price Change'] },
        quantity: nullableNumber,
        eta: nullableString,
        new_unit_price: nullableNumber,
      },
      required: ['status', 'quantity', 'eta', 'new_unit_price'],
    },
    summary: nullableString,
    evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { field: { type: Type.STRING }, quote: { type: Type.STRING } },
        required: ['field', 'quote'],
      },
    },
  },
  required: [
    'document_type', 'confidence', 'vendor_name', 'sender_email', 'invoice_number', 'invoice_date', 'po_number',
    'other_po_numbers', 'currency', 'line_items', 'subtotal', 'freight_amount', 'tax_amount', 'total_amount',
    'payment_terms', 'acknowledgement', 'summary', 'evidence',
  ],
};

export const SYSTEM_PROMPT = `You are the document-understanding engine of an Accounts Payable automation system.
You receive ONE inbound vendor document in any form: a scanned image, a layout-based PDF invoice, a PDF of an email,
a plain-text email with the details written inline in a paragraph, a quickly jotted list or table, or a forwarded
email chain. There is no fixed template. Read it the way an experienced AP clerk would.

CLASSIFY (document_type):
- "invoice": a vendor is asking to be paid (an invoice, bill, or payment request with an amount due).
- "acknowledgement": a vendor confirms, delays, splits, backorders or changes the price of an existing purchase order.
- "inquiry": a question or request that is neither of the above (status question, remittance query, dispute, etc.).
- "other": anything else.

EXTRACT, grounded strictly in the document:
- NEVER invent or infer a value that is not written in the document. If a field is absent, use null (or [] for lists).
- Numbers must be plain JSON numbers: "$1,953.94" -> 1953.94. No currency symbols or thousands separators.
- invoice_number: the vendor's invoice identifier exactly as written (keep prefixes like INV-).
- po_number: the purchase order the invoice/acknowledgement refers to, normalised as "PO-<digits/code>" (e.g. "PO 4017" -> "PO-4017").
  If several POs are mentioned, put the main one in po_number and the rest in other_po_numbers.
- vendor_name: the company that issued the document (letterhead, signature, or sender). Not the recipient.
- sender_email: the sender's email address if shown.
- total_amount: the total the vendor is asking to be paid (grand total / amount due), INCLUDING freight and tax.
- freight_amount: freight, shipping or delivery charges ONLY if stated; otherwise null. Do not guess it by subtraction.
- subtotal / tax_amount / line_items: only if stated. For each line item give quantity, unit_price and amount when written.
- invoice_date: ISO YYYY-MM-DD if a date is clearly the invoice date; otherwise null.
- For forwarded or quoted chains: extract the document that is the actual subject (the invoice/acknowledgement being
  forwarded), not unrelated numbers in signatures, footers, disclaimers or older quoted messages.
- For acknowledgements fill the acknowledgement object (status, quantity, eta as YYYY-MM-DD, new_unit_price); for any
  other type set acknowledgement to null.
- summary: ONE short sentence describing what the document says.
- confidence: 0..1, how sure you are that the key fields are correct. Lower it for blurry scans, ambiguous numbers,
  conflicting figures or a document that does not look like what you were told it is. Do not default to 0.99.

EVIDENCE: for each of invoice_number, po_number, total_amount and freight_amount that you extracted (non-null),
add an evidence entry {field, quote} where quote is a SHORT VERBATIM snippet copied from the document that contains
the value. These quotes are machine-verified against the source, so copy them exactly and never fabricate one.

Return only the JSON object that matches the schema.`;
