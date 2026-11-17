"""Reconcile CVP laboratory codes without changing established Eumed names.

Usage: python tools/reconcile_lab_catalog.py SOURCE.xlsx [--apply]
The workbook is read only. Report: work/catalog-reconciliation.json.
"""
import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROOT = Path(__file__).resolve().parents[1]


def read_sheets(path):
    with zipfile.ZipFile(path) as archive:
        strings = ["".join(t.text or "" for t in item.findall(".//m:t", NS))
                   for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        relationships = {r.get("Id"): r.get("Target") for r in ET.fromstring(
            archive.read("xl/_rels/workbook.xml.rels"))}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        result = {}
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            target = relationships[sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            rows = []
            for row in ET.fromstring(archive.read(target)).findall("m:sheetData/m:row", NS)[1:]:
                values = {}
                for cell in row:
                    value = cell.find("m:v", NS)
                    text = value.text or "" if value is not None else "".join(cell.itertext())
                    values[re.sub(r"\d", "", cell.get("r"))] = (strings[int(text)] if cell.get("t") == "s" else text).strip()
                rows.append(values)
            result[sheet.get("name")] = rows
        return result


def source_entries(sheets):
    entries = {}
    def add(code, parent, name):
        entry = entries.setdefault(code, {"code": code, "parent_code": parent, "name": name, "aliases": []})
        if name not in entry["aliases"]:
            entry["aliases"].append(name)
    for row in sheets["CVP"]:
        if not any(row.get(column) == "11" for column in ("L", "M", "N")):
            continue
        # A parent is a selectable code only when this row has no child CVP code.
        code = row.get("H") or row.get("C")
        name = row.get("F") or row.get("E") or row.get("D")
        if code and name:
            add(code, row["C"], name)
    for row in sheets["ACCORPAMENTI"]:
        if row.get("G") == "11" and row.get("A") and row.get("B"):
            code, name = row["A"], row["B"]
            add(code, code, name)
    return entries


def reconcile(source, apply=False):
    expected = source_entries(read_sheets(source))
    catalog_path = ROOT / "lab_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    actual = {entry["code"]: entry for entry in catalog["entries"]}
    if len(actual) != len(catalog["entries"]):
        raise ValueError("Duplicate catalog codes: no automatic update")
    missing, extra = sorted(expected.keys() - actual.keys()), sorted(actual.keys() - expected.keys())
    if extra:
        raise ValueError(f"Codes outside laboratory source: review before updating: {extra}")
    # Preserve runtime names and all curated aliases. Add the source name as an
    # alias only where absent; do not add generic parent names to child entries.
    added_aliases = []
    for code in sorted(actual.keys() & expected.keys()):
        entry = actual[code]
        for official in expected[code]["aliases"]:
            if official not in [entry["name"], *entry["aliases"]]:
                added_aliases.append({"code": code, "alias": official})
                if apply:
                    entry["aliases"].append(official)
    if apply:
        catalog["entries"].extend(expected[code] for code in missing)
        catalog["source"] = {"file": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                             "branch": "11", "sheets": ["CVP", "ACCORPAMENTI"]}
        catalog["version"] = "CVP-2026-10-30+synlab+aou-padova+schiavonia-0.15.36"
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"source": str(source), "branch": "11", "expected_codes": len(expected),
              "codes_before": len(actual), "missing_before": missing, "outside_branch": extra,
              "source_aliases_added" if apply else "source_aliases_missing": added_aliases,
              "applied": apply, "codes_after": len(catalog["entries"])}
    (ROOT / "work").mkdir(exist_ok=True)
    (ROOT / "work/catalog-reconciliation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, list)}))
    print("Missing codes:", missing, "Extra codes:", extra, "Source aliases:", len(added_aliases))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    reconcile(args.source, args.apply)
