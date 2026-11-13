#!/usr/bin/env python3
"""Exporta el progreso de Supabase a data/review_state.csv (lo ejecuta sync-progress.yml cada noche).

Necesita las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY.
Solo usa la librería estándar. Uso: python scripts/export_review_state.py [ruta_salida]
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

COLUMNS = [
    "id", "kind", "state", "due", "last_review", "stability", "difficulty",
    "reps", "lapses", "days_since_review",
]
STATE = {0: "new", 1: "learning", 2: "review", 3: "relearning"}
PAGE = 1000


def fetch_rows(base: str, key: str) -> list[dict]:
    rows: list[dict] = []
    select = "kind,card_id,state,due,last_review,stability,difficulty,reps,lapses"
    start = 0
    while True:
        req = urllib.request.Request(
            f"{base.rstrip('/')}/rest/v1/card_state?select={select}&order=kind.asc,card_id.asc",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range-Unit": "items",
                "Range": f"{start}-{start + PAGE - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            page = json.load(resp)
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def to_csv(rows: list[dict], now: datetime) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLUMNS)
    for r in sorted(rows, key=lambda r: (r["kind"], r["card_id"])):
        if r["state"] == 0:
            continue  # nunca repasada (o repaso deshecho)
        due = parse(r["due"])
        last = parse(r.get("last_review"))
        w.writerow([
            r["card_id"],
            r["kind"],
            STATE.get(r["state"], r["state"]),
            due.strftime("%Y-%m-%d %H:%M") if due else "",
            last.strftime("%Y-%m-%d") if last else "",
            f"{r['stability']:.2f}",
            f"{r['difficulty']:.2f}",
            r["reps"],
            r["lapses"],
            (now - last).days if last else "",
        ])
    return buf.getvalue()


def main() -> int:
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not base or not key:
        print("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY", file=sys.stderr)
        return 1
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "review_state.csv"
    rows = fetch_rows(base, key)
    content = to_csv(rows, datetime.now(timezone.utc))
    out.write_text(content, encoding="utf-8")
    print(f"review_state.csv: {content.count(chr(10)) - 1} tarjetas repasadas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
