#!/usr/bin/env python3
"""Migrate VFP Theater tables to PostgreSQL aaa database, theater schema."""

import dbfread
import psycopg2
import datetime
import os

SRC = '/Volumes/LargeExFat/Claude/FlyOutMenu/aaa/Theater'
DB  = dict(host='localhost', port=5432, database='aaa')

# VFP type → PostgreSQL type
TYPE_MAP = {
    'C': 'TEXT',
    'M': 'TEXT',   # memo
    'I': 'INTEGER',
    'N': 'NUMERIC',
    'F': 'DOUBLE PRECISION',
    'D': 'DATE',
    'T': 'TIMESTAMP',
    'L': 'BOOLEAN',
}

def pg_col_def(f):
    pg = TYPE_MAP.get(f.type, 'TEXT')
    return f'"{f.name.lower()}" {pg}'

def coerce(value):
    """Convert VFP values to psycopg2-friendly Python values."""
    if isinstance(value, datetime.date):
        return value
    return value

conn = psycopg2.connect(**DB)
cur  = conn.cursor()

cur.execute("CREATE SCHEMA IF NOT EXISTS theater")
conn.commit()
print("Schema 'theater' ready.")

tables = [f[:-4] for f in sorted(os.listdir(SRC)) if f.lower().endswith('.dbf')]

for tname in tables:
    path = os.path.join(SRC, tname + '.dbf')
    tbl  = dbfread.DBF(path, encoding='cp1252', ignore_missing_memofile=False)
    cols = tbl.fields

    col_defs = ', '.join(pg_col_def(f) for f in cols)
    cur.execute(f'DROP TABLE IF EXISTS theater."{tname.lower()}"')
    cur.execute(f'CREATE TABLE theater."{tname.lower()}" ({col_defs})')

    col_names = ', '.join(f'"{f.name.lower()}"' for f in cols)
    placeholders = ', '.join(['%s'] * len(cols))
    insert_sql = f'INSERT INTO theater."{tname.lower()}" ({col_names}) VALUES ({placeholders})'

    count = 0
    for rec in tbl:
        row = [coerce(rec[f.name]) for f in cols]
        cur.execute(insert_sql, row)
        count += 1

    conn.commit()
    print(f"  {tname.lower():20s} {count:5d} rows")

cur.close()
conn.close()
print("\nDone.")
