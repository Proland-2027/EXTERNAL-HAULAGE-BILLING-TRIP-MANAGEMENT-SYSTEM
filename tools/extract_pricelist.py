#!/usr/bin/env python3
"""Extracts every sheet of the client price list workbook to JSON (header rows + data rows) for tools/build_rates.js."""
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = []
for ws in wb.worksheets:
    rows = [[("" if v is None else v) for v in r] for r in ws.iter_rows(values_only=True)]
    out.append({"sheet": ws.title, "rows": rows})
json.dump(out, open(sys.argv[2], "w"), default=str)
print("sheets:", [o["sheet"] for o in out])
