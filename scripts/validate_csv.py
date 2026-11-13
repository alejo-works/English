#!/usr/bin/env python3
"""Valida data/vocab.csv y data/errors.csv.

Comprueba columnas exactas, campos obligatorios, ids únicos (slug),
valores permitidos y fechas YYYY-MM-DD. Sale con código 1 si hay errores.

Uso: python scripts/validate_csv.py [directorio_data]
"""
from __future__ import annotations

import csv
import re
import sys
from datetime import date
from pathlib import Path

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

VOCAB_COLUMNS = [
    "id", "english", "spanish", "example_en", "example_es", "type",
    "area", "register", "source", "date_added", "notes",
]
VOCAB_REQUIRED = {"id", "english", "spanish", "example_en", "type", "area", "register", "date_added"}
VOCAB_ALLOWED = {
    "type": {"word", "phrasal_verb", "idiom", "slang", "collocation", "chunk"},
    "area": {"tech_ai", "finance", "business", "daily", "nyc"},
    "register": {"formal", "neutral", "informal", "slang"},
}

ERRORS_COLUMNS = ["id", "wrong", "right", "rule", "category", "date_added"]
ERRORS_REQUIRED = set(ERRORS_COLUMNS)
ERRORS_ALLOWED = {
    "category": {"tense", "preposition", "word_order", "vocab", "pronunciation", "grammar", "article", "spelling"},
}


def valid_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate(path: Path, columns: list[str], required: set[str], allowed: dict[str, set[str]]) -> list[str]:
    problems: list[str] = []
    name = path.name
    if not path.exists():
        return [f"{name}: no existe"]

    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        return [f"{name}: no es UTF-8 ({exc})"]
    if text.startswith("﻿"):
        problems.append(f"{name}: tiene BOM; guárdalo como UTF-8 sin BOM")
        text = text[1:]

    reader = csv.reader(text.splitlines())
    rows = list(reader)
    if not rows:
        return [f"{name}: está vacío"]

    header = rows[0]
    if header != columns:
        problems.append(f"{name}: cabecera {header} ≠ esperada {columns}")
        return problems

    seen: dict[str, int] = {}
    for lineno, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue  # línea en blanco
        where = f"{name}:{lineno}"
        if len(row) != len(columns):
            problems.append(
                f"{where}: {len(row)} columnas, se esperaban {len(columns)} "
                "(¿una coma sin comillas dobles?)"
            )
            continue
        rec = dict(zip(columns, row))
        for col in required:
            if not rec[col].strip():
                problems.append(f"{where}: '{col}' es obligatoria")
        for col, value in rec.items():
            if value != value.strip():
                problems.append(f"{where}: '{col}' tiene espacios al principio o al final")
        rid = rec["id"]
        if rid and not SLUG.match(rid):
            problems.append(f"{where}: id '{rid}' no es un slug (minúsculas, números y guiones)")
        if rid in seen:
            problems.append(f"{where}: id '{rid}' duplicado (ya en la línea {seen[rid]})")
        else:
            seen[rid] = lineno
        for col, values in allowed.items():
            if rec[col] and rec[col] not in values:
                problems.append(f"{where}: {col}='{rec[col]}' no permitido; usa {sorted(values)}")
        if rec["date_added"] and not valid_date(rec["date_added"]):
            problems.append(f"{where}: date_added '{rec['date_added']}' no es YYYY-MM-DD")
    return problems


def main() -> int:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data"
    problems = validate(data_dir / "vocab.csv", VOCAB_COLUMNS, VOCAB_REQUIRED, VOCAB_ALLOWED)
    problems += validate(data_dir / "errors.csv", ERRORS_COLUMNS, ERRORS_REQUIRED, ERRORS_ALLOWED)

    # Los ids deben ser únicos también entre vocab y errors (comparten review_state.csv)
    try:
        v_ids = {r["id"] for r in csv.DictReader((data_dir / "vocab.csv").open(encoding="utf-8"))}
        e_ids = {r["id"] for r in csv.DictReader((data_dir / "errors.csv").open(encoding="utf-8"))}
        for dup in sorted(v_ids & e_ids):
            problems.append(f"id '{dup}' está en vocab.csv y en errors.csv")
    except (OSError, KeyError):
        pass

    if problems:
        print(f"✗ {len(problems)} problema(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("✓ CSV válidos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
