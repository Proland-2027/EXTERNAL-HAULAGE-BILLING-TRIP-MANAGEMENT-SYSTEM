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
| — | *new* | `vatTreatment` | enum exclusive / inclusive | set by the invoice price type |
| — | *new* | `truckBatch` | New Batch / Old Batch / 3rd Party | snapshot of the vehicle's batch on the dispatch date |
| — | *new* | Net Sales excl. VAT | computed | exclusive: selling price; inclusive: `round(price ÷ 1.075, 2)` |
| Q | VAT (₦) | computed | exclusive: `round(sellingPrice × vatRate, 2)`; inclusive: `price − net` | vatRate from settings (7.5 %) |
| R | Billing After VAT (₦) | computed | exclusive: `sellingPrice + vat`; inclusive: `sellingPrice` | |
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

`client`, `loadingFrom`, `loadingTo`, `vehicleType`, `contractType` (tonnage, optional), `price`, `priceBasis` (exclusive / inclusive), `effectiveDate`, `expiryDate` (optional), `status` (computed Active/Expired/Future), `remarks`, `source`.

June Price List columns → rate: Client → `client` (via alias to the master name), Loading Point → `loadingFrom`, Destination → `loadingTo`, Divison HAULAGE → `vehicleType` HAULAGE (other divisions → any), Truck Tonnage → `contractType`, PLIST / PLIST Exl VAT / Approved Client Price / PL / Plsit / Plist BF Vat → `price` (exclusive), PLIST INL VAT / PL With VAT / PLIST VAT INCL → `price` (inclusive, when no exclusive column), Price AUGUST → second rate effective 2026-08-01, Contract Name / Truck Size / State / Region / Product / Status → `remarks`. Effective date 2026-06-01 (June list).

## `assets` additions

`truckBatch` (New Batch / Old Batch / 3rd Party) and `batchHistory[{batch, effectiveDate}]`.

## `meta/zones`

`map`: trip location (normalised) → price-list zone, e.g. `gbagada → Lagos`, `phc → Port Harcourt`.

## New module: `invoices`

`number`, `client`, `invoiceDate`, `dueDate`, `priceType` (exclusive / inclusive), `vatRate`, `tripIds[]`, `lines[]` (per-trip snapshot: date, route, plate, trip no., waybill, ref, selling price, net, vat, gross), `subtotal`, `vat`, `total`, `company` (name/address/TIN snapshot), `status` (Draft / Sent / Paid / Void), `manualNumber` (true when overridden), `notes`.

## New module: `payments`

`invoiceId` (optional), `tripIds[]`, `client`, `date`, `amount`, `method`, `reference`, `recordedBy`.
