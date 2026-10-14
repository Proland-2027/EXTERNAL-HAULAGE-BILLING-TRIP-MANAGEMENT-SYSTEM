# DARCO JMG — Spare Parts Sourcing & Procurement Management

A zero-install, mobile-friendly web app (`spare-parts/index.html`) for sourcing SINOTRUK / HOWO
truck spare parts from suppliers in China. It centralises spare part requests with photographs,
one-part RFQ PDFs, the supplier database, quotations and price comparison, purchase orders,
shipping and the procurement history.

Open `spare-parts/index.html` in Chrome / Safari / Edge (phone or computer), or serve the repository
(`npm start`) and open <http://localhost:8080/spare-parts/>. No server, database or build step is
needed; data is stored in the browser (structured data in localStorage, photographs in IndexedDB).
Use **Data → Export backup** to back up or move the dataset.

To publish it on an existing WordPress site, upload the repository folder to the web root (for
example `/wp-content/uploads/spare-parts/` together with the shared `css/` and `js/` folders) and link
to `spare-parts/index.html`, or embed it in a page with an `<iframe>`.

## 1. Spare parts requests

* **Automatic request ID** `DARCO-SP-00001`, `DARCO-SP-00002`, … (prefix editable in Setup).
* Fields: request date, requested by, department / workshop, truck registration, make, model,
  chassis / VIN, engine model, part category, description, OEM / manufacturer part number, quantity,
  unit, urgency (Normal / Urgent / Critical), size / specification, remarks.
* **One spare part per request.** The form keeps the truck details after saving (*Save & add another
  part*), and *Another part, same truck* on a request page starts the next request pre-filled.
* **Three mandatory photographs**: full part, different angle, close-up of the part number /
  markings. *Take photo* opens the phone camera directly (`capture="environment"`), *Gallery* picks an
  existing picture. Photos are resized on the device (max 1280 px JPEG) before being stored.
* **Validation** of every required field and the three photos before saving.
* **Duplicate prevention**: the same normalised part number (spaces, dashes and case ignored) on the
  same truck while a request is still open blocks saving and links to the existing request; the same
  part number on another truck, or a closed request, is flagged (with the last price paid) but allowed.
* **Excel / CSV bulk import** (Requests → *Import Excel/CSV…* or Data). Download the template for the
  column layout; headers are matched flexibly (`Part No`, `OEM`, `Reg No`, `Priority`, … all work),
  dates in serial, ISO or dd/mm/yyyy form are accepted, IDs are assigned when missing, rows whose ID
  already exists are skipped and duplicates are flagged (optionally skipped). Imported requests have no
  photos; add them with *Edit* before sending to suppliers.

Request status is derived automatically: `NEW → RFQ SENT → QUOTED → ORDERED → SHIPPED → RECEIVED`,
plus manual `ON HOLD`, `CANCELLED` and `CLOSED`.

## 2. Spare parts photo request PDF (one part per PDF)

*Download PDF* on a request page generates a single-page A4 PDF that follows the DARCO JMG
one-part RFQ template: company header, request number, date and urgency, the three photographs,
the part & truck information (part name, category, OEM number, quantity, truck model and
registration, engine, chassis, specification, remarks), a *Supplier quotation (to be completed)*
block with blank lines for brand, unit price (USD or RMB), availability / lead time and warranty,
the destination and the procurement contact. The PDF is produced in the browser without any external
service (`spare-parts/js/pdf.js` + `documents.js`), so it also works offline.

*Share via WhatsApp* prepares the message (reference, part, OEM number, truck, quantity, what to
reply with) and:

* on a phone uses the system share sheet with the PDF attached — pick WhatsApp and the supplier;
* on a computer downloads the PDF and opens WhatsApp Web / `wa.me` with the supplier's number and the
  message; attach the downloaded PDF in the chat.

The share can be recorded as an RFQ sent to that supplier.

## 3. Chinese supplier management

Supplier ID (`SUP-001`), company name, contact person, WhatsApp, WeChat, email, city / province,
product specialization, payment terms, currency, rating (1–5), remarks, active flag. Performance is
computed from the purchase orders and RFQs: orders placed, deliveries on time (received on or before
the ETA), average lead time (PO date → received), RFQ response rate, quotes won, total spend.

*Send RFQ to suppliers* on a request records which suppliers received it (channel + date, several at
once); each one then has a WhatsApp button to send the PDF. Per supplier the app tracks `SENT`,
`QUOTED`, `DECLINED` or `NO RESPONSE`; the RFQs & Quotes page lists every RFQ grouped by request and
warns about RFQs waiting more than 3 days.

## 4. Quotations and price comparison

*Record quote* stores the supplier's reply: brand / manufacturer, unit price and currency (USD, RMB,
NGN, EUR), MOQ, lead time, availability, warranty, validity date, shipping cost, remarks and an
optional photo of the offered part. The comparison table on the request page converts every quote to
the base currency (rates in Setup), applies the supplier MOQ, adds the quoted shipping and shows the
difference against the lowest offer, the lead time and a score (60 % price, 25 % lead time, 15 %
supplier rating). Flags: *best*, *lowest*, *fastest*. *Select* marks the winning quote; the table
exports to Excel.

## 5. Purchase orders

`DARCO-PO-00001`, … created from the selected quotation (other selected quotes from the same supplier
can be added to the same PO). Lines carry the request reference, part number, description, brand,
truck, quantity (max of requested and MOQ), unit price; totals include shipping, other charges and
discount, with the equivalent in the base and local currency. Status flow
`DRAFT → SENT → CONFIRMED → PAID → SHIPPED → ARRIVED → RECEIVED → CLOSED` (or `CANCELLED`) with a
history timeline. Draft POs are editable inline. Each PO has a printable document, a PDF, an Excel
export and *Send to supplier (WhatsApp)* (PDF + summary message).

## 6. Shipping

Per PO: method (air, sea LCL/FCL, courier, rail), forwarder, tracking / AWB / BL number, origin and
destination ports, ETD, ETA, shipped / arrived / received dates, customs clearance status, received by,
quantity / condition check and remarks. Entering *Shipped on*, *Arrived on* or *Received on* moves the
PO status. The Shipping page lists open shipments with days to ETA and overdue flags.

## 7. Procurement history

Every PO line, searchable by part number, truck or supplier, with price statistics per part number
(times bought, last / lowest / highest / average price in the base currency, last supplier) and the
most-ordered parts. The same history is shown on a request page when the part number has been bought
before, and on each supplier page (previous orders, on-time deliveries).

## Excel

Exports (SheetJS from a CDN; CSV when offline): requests, suppliers (with performance), RFQs &
quotations, purchase orders, PO lines / history, shipments, a per-request comparison, a per-PO
workbook, and *Export all* with every sheet. Imports: requests (bulk) and full JSON backups.

## Data model (one JSON document + photo store)

| Collection | Key fields |
|---|---|
| `settings` | company, address, destination, procurement contact / phone / email / WhatsApp, prefixes, `baseCurrency`, `localCurrency`, `rates` (units of base per 1 unit of currency), `pdfNote`, categories, units, truck makes, departments, requesters |
| `trucks[]` | `regNo`, `make`, `model`, `chassis`, `engineModel`, `department` (added automatically from requests) |
| `requests[]` | `id`, `date`, `requestedBy`, `department`, truck fields, `category`, `description`, `partNo`, `qty`, `unit`, `urgency`, `size`, `remarks`, `photos[3]` (photo ids), `status`, `imported`, `matchingPartNo[]` |
| `suppliers[]` | `id`, `name`, `contact`, `whatsapp`, `wechat`, `email`, `city`, `province`, `specialization`, `paymentTerms`, `currency`, `rating`, `remarks`, `active` |
| `rfqs[]` | `id`, `requestId`, `supplierId`, `sentAt`, `channel`, `status`, `selected`, `quote {receivedAt, brand, unitPrice, currency, moq, leadTimeDays, availability, warranty, validUntil, shippingCost, remarks, photoId}` |
| `purchaseOrders[]` | `id`, `number`, `supplierId`, `date`, `currency`, `paymentTerms`, `status`, `lines[] {requestId, rfqId, partNo, description, brand, truckReg, qty, unit, unitPrice, amount, leadTimeDays, warranty}`, `shippingCost`, `otherCost`, `discount`, `subtotal`, `total`, `shipment {method, forwarder, trackingNo, originPort, destinationPort, etd, eta, shippedAt, arrivedAt, customsStatus, receivedAt, receivedBy, receivedQtyOk, remarks}`, `history[]` |

Photos are stored in IndexedDB under ids such as `DARCO-SP-00001-P1`; backups include them as data URLs.

## Code

```
spare-parts/index.html       app shell (uses ../css/styles.css, ../js/export.js, ../js/charts.js)
spare-parts/css/spares.css   mobile-first additions: form, photo slots, documents
spare-parts/js/spares.js     engine: numbering, validation, duplicates, status, currency, comparison, PO totals, supplier stats, history, import
spare-parts/js/pdf.js        dependency-free PDF writer (text, lines, rectangles, JPEG images)
spare-parts/js/documents.js  RFQ sheet and purchase-order PDF layouts
spare-parts/js/photos.js     camera / gallery capture, resizing, IndexedDB photo store
spare-parts/js/store.js      localStorage persistence, backup export / import
spare-parts/js/seed.js       demo dataset (fictitious suppliers, placeholder photos)
spare-parts/js/app.js        UI
tests/spares.test.js, tests/pdf.test.js, tests/documents.test.js   `npm test`
```
