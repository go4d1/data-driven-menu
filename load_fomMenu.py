import re
import subprocess
import sys

xml_file = '/Volumes/LargeExFat/Claude/CleanStart/fomSchema.xml'
pg_bin   = '/usr/local/opt/postgresql@17/bin/psql'
db_args  = [pg_bin, '-h', 'localhost', '-U', 'martinglynn', 'postgres']

with open(xml_file, 'r', encoding='utf-8') as f:
    raw = f.read()

def get_field(block, tag):
    m = re.search(r'<' + tag + r'>(.*?)</' + tag + r'>', block, re.DOTALL)
    return m.group(1) if m else ''

def escape(val):
    return val.replace("'", "''")

row_blocks = re.findall(r'<row>(.*?)</row>', raw, re.DOTALL)

create_sql = """\
DROP TABLE IF EXISTS fommenu;
CREATE TABLE fommenu (
    pk        INTEGER PRIMARY KEY,
    parentpk  INTEGER,
    cprompt   VARCHAR(60),
    chref     VARCHAR(60),
    cfunction VARCHAR(120),
    isort     INTEGER,
    ilevel    INTEGER,
    crole     VARCHAR(10),
    objective TEXT,
    cexec     TEXT,
    jscript   TEXT,
    lparent   BOOLEAN,
    chtml     TEXT,
    jqclass   VARCHAR(10),
    class     VARCHAR(10)
);
"""

inserts = []
for block in row_blocks:
    pk        = get_field(block, 'pk') or '0'
    parentpk  = get_field(block, 'parentpk') or '0'
    cprompt   = escape(get_field(block, 'cprompt'))
    chref     = escape(get_field(block, 'chref'))
    cfunction = escape(get_field(block, 'cfunction'))
    isort     = get_field(block, 'isort') or '0'
    ilevel    = get_field(block, 'ilevel') or '0'
    crole     = escape(get_field(block, 'crole'))
    objective = escape(get_field(block, 'objective'))
    cexec     = escape(get_field(block, 'cexec'))
    jscript   = escape(get_field(block, 'jscript'))
    lparent_val = get_field(block, 'lparent')
    lparent   = 'TRUE' if lparent_val.strip() == '1' else 'FALSE'
    chtml     = escape(get_field(block, 'chtml'))
    jqclass   = escape(get_field(block, 'jqclass'))
    cls       = escape(get_field(block, 'class'))

    inserts.append(
        f"INSERT INTO fommenu "
        f"(pk,parentpk,cprompt,chref,cfunction,isort,ilevel,crole,objective,cexec,jscript,lparent,chtml,jqclass,class) "
        f"VALUES ({pk},{parentpk},'{cprompt}','{chref}','{cfunction}',{isort},{ilevel},"
        f"'{crole}','{objective}','{cexec}','{jscript}',{lparent},'{chtml}','{jqclass}','{cls}');"
    )

full_sql = create_sql + '\n'.join(inserts)

result = subprocess.run(db_args, input=full_sql, capture_output=True, text=True)
if result.returncode != 0:
    print("ERROR:", result.stderr)
    sys.exit(1)

print(f"Done. {len(inserts)} rows inserted into fommenu.")
