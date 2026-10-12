# Excel column → database field mapping

## Trip Log → `trips`

| Excel | Header | Field | Type | Notes |
|---|---|---|---|---|
| A | Date Dispatched | `dateDispatched` | date (YYYY-MM-DD) | required |
| B | Date Delivered | `dateDelivered` | date | |
| C | Plate Number | `plate` | text, FK → assets | |
| D | Asset Code | `assetCode` | derived from asset | stored for history |
| E | Type of Vehicle | `vehicleType` | derived | HAULAGE, Closed Body Logistics, Flat Trucks Logistics, Hiabs Logistics |
| F | Type | `vehicleCategory` | derived | New Batch, Old Batch, CANTER, Flat Truck, Hiab, 3rd Party |
| G | Cost Center | `costCenter` | derived | CC039/CC046/CC047/CC059 |
| H | Contract Type | `contractType` | text | optional price-list key |
| I | CLIENT NAME | `client` | text, FK → clients | |
| J | Loading From | `loadingFrom` | text | |
| K | Loading To | `loadingTo` | text | |
| L | Journey Plan ID | `journeyPlanId` | text | |
| M | Client Waybill Number | `waybill` | text | |
| N | Return Waybill Received? | `returnWaybill` | enum Received / Not Received / blank | |
| O | Invoice Status | `invoiceStatus` | enum Invoice Not Sent / Invoice Sent / Internal Client | raw value in `invoiceStatusRaw` |
| — | *new* | `agreedRateId` | text | chosen rate when several match; otherwise lookup is automatic |
| — | *new* | **Agreed Client Price (₦)** | computed | from `rates` on the dispatch date |
| P | Selling Price (₦) | `sellingPrice` | number, **manual only** | never auto-filled |
| — | *new* | Price Variance (₦) / (%) | computed | selling − agreed; ÷ agreed × 100 |
| Q | VAT (₦) | computed | `round(sellingPrice × vatRate, 2)` | vatRate from settings (7.5 %) |
| R | Billing After VAT (₦) | computed | `sellingPrice + vat` | |
| S | Quote Number | `quoteNo` | text | |
| T | SO Number | `soNo` | text | |
| U | Manual Invoice Number | `manualInvoiceNo` | text | override |
| V | Invoice Number | `invoiceNo` | text | set when an invoice is generated; `invoiceId` links to `invoices` |
| W | Payment Status | `paymentStatus` | enum Not Paid / Advance / Paid | |
| X | Advance (₦) | `advance` | number | |
| Y | Amount Paid (₦) | computed | Paid → billing; Advance → advance; else 0 | |
| Z | Balance (₦) | computed | billing − amountPaid | |
| AA | Total (₦) | computed | = billing | |
| AB | Month (helper) | computed | `YYYY-MM` of dispatch | |
| AC/AD | helpers | — | replaced by invoice queries | |
| AF | notes | `note` | text | |
| — | audit | `version`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `history[]` | | |
| — | provenance | `source` (`workbook`/`manual`/`import`), `xlRow` | | |

## Asset List → `assets`

| Excel | Field |
|---|---|
| A Plate Number | `plate` (id) |
| B Asset Code | `assetCode` |
| C Type of Vehicle | `vehicleType` |
| D Cost Center | `costCenter` |
| E Type | `vehicleCategory` |

## Settings → `settings/main`

| Excel | Field |
|---|---|
| B6 VAT Rate | `vatRate` (0.075) |
| B7 Payment Terms | `paymentTermsDays` (7) |
| B10–B12 Bank | `bankName`, `accountName`, `accountNumber` |
| B15 Next Invoice Sequence | replaced by per-client numbering (`invoiceNumberFormat`) |
| A58:A113 Client Master List | `clients` collection (`name`, `code`, `active`) |

## New module: `rates` (Agreed Client Price List)

`client`, `loadingFrom`, `loadingTo`, `vehicleType`, `contractType` (optional), `price`, `effectiveDate`, `expiryDate` (optional), `status` (computed Active/Expired/Future), `remarks`.

## New module: `invoices`

`number`, `client`, `invoiceDate`, `dueDate`, `includesVat`, `tripIds[]`, `subtotal`, `vat`, `total`, `status` (Draft / Sent / Paid / Void), `manualNumber` (true when overridden), `notes`.

## New module: `payments`

`invoiceId` (optional), `tripIds[]`, `client`, `date`, `amount`, `method`, `reference`, `recordedBy`.
