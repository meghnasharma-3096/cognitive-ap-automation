#!/usr/bin/env python3
"""Generates tests/corpus: varied vendor documents + <file>.expected.json (ground truth)
+ <file>.llm.json (what a correct model read looks like, replayed by LLM_PROVIDER=fixture).
The .llm.json files are AUTHORED, not recorded; `npm run eval:live -- --record` replaces them with real Gemini output.
Run: python3 scripts/build-corpus.py   (needs Pillow)"""
import json, os, textwrap
from email.message import EmailMessage
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'corpus')
os.makedirs(OUT, exist_ok=True)

def w(name, data, mode='w'):
    with open(os.path.join(OUT, name), mode) as f:
        f.write(data)

def li(d, q, u): return {"description": d, "sku": None, "quantity": q, "unit_price": u, "amount": round(q * u, 2)}

def ext(**kw):
    base = dict(document_type='invoice', confidence=0.95, vendor_name=None, sender_email=None, invoice_number=None,
                invoice_date=None, po_number=None, other_po_numbers=[], currency='USD', line_items=[], subtotal=None,
                freight_amount=None, tax_amount=None, total_amount=None, payment_terms=None, acknowledgement=None,
                summary=None, evidence=[])
    base.update(kw); return base

def case(name, ext_, expected):
    w(name + '.llm.json', json.dumps(ext_, indent=2) + '\n')
    w(name + '.expected.json', json.dumps(expected, indent=2) + '\n')

# ---------------------------------------------------------------- the two user-supplied PDFs
case('XYZ_Company.pdf', ext(vendor_name='XYZ Company', sender_email='billing@officemax-corporate.com', invoice_number='INV-88392',
     invoice_date='2026-03-13', po_number='PO-4017', freight_amount=45.0, total_amount=1953.94, payment_terms='Net 30',
     summary='Invoice INV-88392 for $1,953.94 against PO-4017 incl. $45 freight.',
     evidence=[{"field":"invoice_number","quote":"INV-88392"},{"field":"po_number","quote":"PO-4017"},
               {"field":"total_amount","quote":"$1,953.94"},{"field":"freight_amount","quote":"$45.00 freight"}]),
     dict(type='invoice', invoice_number='INV-88392', po='PO-4017', total=1953.94, freight=45.0, match='Exception', code='FREIGHT'))
case('EFGHI_Company.pdf', ext(vendor_name='EFGHI Company', sender_email='billing@efghi.com', invoice_number='INV-88392',
     invoice_date='2026-03-13', po_number='PO-4019', other_po_numbers=['PO-4017'], freight_amount=45.0, total_amount=1953.94, payment_terms='Net 30',
     summary='Invoice INV-88392 against PO-4019 (subject line says PO-4017; body says PO-4019).',
     evidence=[{"field":"po_number","quote":"under PO-4019"},{"field":"total_amount","quote":"$1,953.94"}]),
     dict(type='invoice', invoice_number='INV-88392', po='PO-4019', total=1953.94, freight=45.0, match='Exception', code='FREIGHT', note='becomes DUPLICATE if XYZ_Company.pdf was ingested first'))

# ---------------------------------------------------------------- plain paragraph email (clean match)
para = textwrap.dedent("""\
    From: ar@globaltech-supply.com
    To: ap@distributor.com
    Date: 2026-10-05
    Subject: Invoice INV-5001

    Hi team, just sending across invoice INV-5001 for PO-2024-110. We shipped 200 units of the
    industrial sensor kit at $35.50 each, so the total comes to $7,100.00 with no freight and
    nothing else added. Terms are Net 45. Thanks, Priya from Global Tech
    """)
w('paragraph_invoice.txt', para)
case('paragraph_invoice.txt', ext(vendor_name='Global Tech', sender_email='ar@globaltech-supply.com', invoice_number='INV-5001',
     invoice_date='2026-10-05', po_number='PO-2024-110', line_items=[li('industrial sensor kit', 200, 35.5)], freight_amount=0.0,
     total_amount=7100.0, payment_terms='Net 45', summary='Invoice INV-5001, 200 x $35.50 = $7,100 against PO-2024-110.',
     evidence=[{"field":"invoice_number","quote":"invoice INV-5001"},{"field":"po_number","quote":"PO-2024-110"},{"field":"total_amount","quote":"$7,100.00"}]),
     dict(type='invoice', invoice_number='INV-5001', po='PO-2024-110', total=7100.0, freight=0.0, match='Success'))

# ---------------------------------------------------------------- jotted list
jot = textwrap.dedent("""\
    apex mfg - quick one
    inv INV-5002  / po 2024-106
    160 x 31.50
    ship 0
    total 5040
    """)
w('jotted_list.txt', jot)
case('jotted_list.txt', ext(vendor_name='Apex Mfg', invoice_number='INV-5002', po_number='PO-2024-106', line_items=[li('unspecified', 160, 31.5)],
     freight_amount=0.0, total_amount=5040.0, confidence=0.9, summary='Jotted invoice INV-5002 from Apex Mfg: 160 x $31.50 = $5,040.',
     evidence=[{"field":"invoice_number","quote":"INV-5002"},{"field":"total_amount","quote":"total 5040"}]),
     dict(type='invoice', invoice_number='INV-5002', po='PO-2024-106', total=5040.0, freight=0.0, match='Success', rules_ok=False))

# ---------------------------------------------------------------- forwarded chain (.eml) with a stale earlier price
m = EmailMessage()
m['From'] = 'Dana Whitfield <dana.whitfield@distributor.com>'; m['To'] = 'ap@distributor.com'
m['Date'] = 'Tue, 06 Oct 2026 09:12:00 +0000'; m['Subject'] = 'Fwd: RE: RE: Starlight invoice'
m.set_content(textwrap.dedent("""\
    AP, please process the final one below.

    ---------- Forwarded message ----------
    From: Raj Menon <billing@starlightlog.com>
    Date: Mon, 05 Oct 2026
    Subject: RE: RE: Starlight invoice

    Hi Dana, corrected version, please ignore the earlier $8,000 estimate.
    Invoice INV-5003 against PO-2024-112: 220 pcs at $37.50 = $8,250.00. No freight.
    Regards, Raj, Starlight Log

    > On Fri, 02 Oct 2026, Dana Whitfield wrote:
    > Can you send the invoice for the October order?
    >
    > On Thu, 01 Oct 2026, Raj Menon wrote:
    > Estimate was $8,000 for the lot, will invoice soon.
    """))
w('forwarded_chain.eml', m.as_string())
case('forwarded_chain.eml', ext(vendor_name='Starlight Log', sender_email='billing@starlightlog.com', invoice_number='INV-5003',
     invoice_date='2026-10-05', po_number='PO-2024-112', line_items=[li('pcs', 220, 37.5)], freight_amount=0.0, total_amount=8250.0,
     summary='Corrected Starlight invoice INV-5003 for $8,250 (the $8,000 figure was a superseded estimate).',
     evidence=[{"field":"invoice_number","quote":"Invoice INV-5003"},{"field":"total_amount","quote":"$8,250.00"}]),
     dict(type='invoice', invoice_number='INV-5003', po='PO-2024-112', total=8250.0, freight=0.0, match='Success', rules_ok=False))

# ---------------------------------------------------------------- scanned-style image (PNG): rotated, noisy, uneven
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; FONTB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def draw_invoice(lines_, title, size=(1240, 1650)):
    img = Image.new('L', size, 238)
    d = ImageDraw.Draw(img)
    y = 90
    d.text((90, y), title, font=ImageFont.truetype(FONTB, 54), fill=30); y += 110
    for text, bold in lines_:
        d.text((90, y), text, font=ImageFont.truetype(FONTB if bold else FONT, 34), fill=40); y += 58
    random.seed(7)
    px = img.load()
    for _ in range(60000):
        x, yy = random.randrange(size[0]), random.randrange(size[1]); px[x, yy] = max(0, px[x, yy] - random.randrange(25, 70))
    img = img.rotate(1.6, expand=True, fillcolor=225).filter(ImageFilter.GaussianBlur(0.9))
    return img

inv_lines = [("AWS Ent - Billing Dept", True), ("1200 Harbor Way, Seattle WA", False), ("", False),
             ("Invoice No:  INV-5004", True), ("Date:  10/07/2026", False), ("Customer PO:  PO-2024-109", False), ("", False),
             ("Qty    Description               Unit        Amount", True), ("190     Cloud gateway licence     34.50      6,555.00", False),
             ("", False), ("Freight                                       0.00", False), ("TOTAL DUE                              $6,555.00", True), ("", False), ("Terms: Net 30", False)]
img = draw_invoice(inv_lines, 'INVOICE')
img.save(os.path.join(OUT, 'scanned_invoice.png'))
case('scanned_invoice.png', ext(vendor_name='AWS Ent', invoice_number='INV-5004', invoice_date='2026-10-07', po_number='PO-2024-109',
     line_items=[li('Cloud gateway licence', 190, 34.5)], freight_amount=0.0, total_amount=6555.0, payment_terms='Net 30', confidence=0.9,
     summary='Scanned invoice INV-5004 from AWS Ent for $6,555.00.', evidence=[]),
     dict(type='invoice', invoice_number='INV-5004', po='PO-2024-109', total=6555.0, freight=0.0, match='Success', rules_ok=False, needs_llm=True))

# image-only PDF (no text layer) with a deliberate PRICE overcharge: 34.90 vs PO 33.50
inv2 = [("Logistics Plus Ltd", True), ("Invoice No:  INV-5005", True), ("Date:  10/08/2026", False), ("Order ref:  PO-2024-108", False), ("", False),
        ("180 units  @  34.90  =  6,282.00", False), ("Freight: none", False), ("", False), ("TOTAL DUE   $6,282.00", True)]
img2 = draw_invoice(inv2, 'TAX INVOICE').convert('RGB')
img2.save(os.path.join(OUT, 'scanned_image_only.pdf'), 'PDF', resolution=150)
case('scanned_image_only.pdf', ext(vendor_name='Logistics Plus', invoice_number='INV-5005', invoice_date='2026-10-08', po_number='PO-2024-108',
     line_items=[li('units', 180, 34.9)], freight_amount=0.0, total_amount=6282.0, confidence=0.88,
     summary='Image-only PDF invoice INV-5005: 180 @ $34.90 = $6,282.', evidence=[]),
     dict(type='invoice', invoice_number='INV-5005', po='PO-2024-108', total=6282.0, freight=0.0, match='Exception', code='PRICE', rules_ok=False, needs_llm=True))

# ---------------------------------------------------------------- table pasted into an email
tbl = textwrap.dedent("""\
    From: accounts@globaltech-supply.com
    Subject: Invoice INV-5006 - PO-2024-105

    Hello,

    Invoice INV-5006 as below.

    PO            Qty    Unit     Line total
    PO-2024-105   150    30.50    4,575.00
    Freight                       0.00
    TOTAL DUE                     $4,575.00

    Global Tech Accounts
    """)
w('table_in_email.txt', tbl)
case('table_in_email.txt', ext(vendor_name='Global Tech', sender_email='accounts@globaltech-supply.com', invoice_number='INV-5006', po_number='PO-2024-105',
     line_items=[li('unspecified', 150, 30.5)], freight_amount=0.0, total_amount=4575.0,
     summary='Invoice INV-5006 in table form, $4,575.00.', evidence=[{"field":"invoice_number","quote":"Invoice INV-5006"},{"field":"total_amount","quote":"$4,575.00"}]),
     dict(type='invoice', invoice_number='INV-5006', po='PO-2024-105', total=4575.0, freight=0.0, match='Success'))

# ---------------------------------------------------------------- multi-PO invoice
multi = textwrap.dedent("""\
    From: ar@globaltech-supply.com
    Subject: Combined invoice INV-5007

    Invoice INV-5007 covers PO-2024-100 (100 units) and PO-2024-102 (120 units). Total amount due is $5,610.00.
    """)
w('multi_po.txt', multi)
case('multi_po.txt', ext(vendor_name='Global Tech', sender_email='ar@globaltech-supply.com', invoice_number='INV-5007', po_number='PO-2024-100',
     other_po_numbers=['PO-2024-102'], total_amount=5610.0, summary='Combined invoice INV-5007 spanning two POs.',
     evidence=[{"field":"invoice_number","quote":"Invoice INV-5007"},{"field":"total_amount","quote":"$5,610.00"}]),
     dict(type='invoice', invoice_number='INV-5007', po='PO-2024-100', total=5610.0, warning='Multiple PO', status='Needs Review'))

# ---------------------------------------------------------------- acknowledgement + inquiry
ack = textwrap.dedent("""\
    From: sales@logisticsplus.com
    Subject: PO-2024-103 shipping update

    Hi, regarding PO-2024-103: the shipment is delayed. New ETA is 2026-11-05.
    """)
w('ack_delay.txt', ack)
case('ack_delay.txt', ext(document_type='acknowledgement', vendor_name='Logistics Plus', sender_email='sales@logisticsplus.com', po_number='PO-2024-103',
     acknowledgement={"status": "Delayed", "quantity": None, "eta": "2026-11-05", "new_unit_price": None}, currency=None,
     summary='Logistics Plus: PO-2024-103 delayed, new ETA 2026-11-05.', evidence=[{"field":"po_number","quote":"PO-2024-103"}]),
     dict(type='acknowledgement', po='PO-2024-103', ack_status='Delayed', eta='2026-11-05'))

inq = "From: ap-help@globaltech-supply.com\nSubject: Payment status\n\nCould you confirm when invoice INV-2024-300 will be paid? Thanks.\n"
w('inquiry.txt', inq)
case('inquiry.txt', ext(document_type='inquiry', vendor_name='Global Tech', sender_email='ap-help@globaltech-supply.com', currency=None,
     summary='Vendor asks when INV-2024-300 will be paid.', confidence=0.93, evidence=[]),
     dict(type='inquiry', status='Needs Review'))
print('corpus written to', os.path.abspath(OUT))
