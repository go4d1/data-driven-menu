kill $(lsof -ti:3000)

App Password nzvg kigf kmyr ghf

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;

psql -h localhost -p 5437 -d aaa -c "\dt"
What other parameters can be passed psql besides "\dt"
These are psql meta-commands (backslash commands), not SQL. The most useful ones:

Listing objects

\l list databases
\dt list tables (current schema)
\dt _._ list tables in all schemas
\dt schema.\* list tables in a specific schema
\dv list views
\di list indexes
\ds list sequences
\df list functions
\dn list schemas
\du list roles/users
\dx list installed extensions
\d list everything in current schema
\d tablename describe a table (columns, types, indexes, FKs)
\d+ tablename same, plus storage info, comments, sizes
Connection / session

\c dbname connect to a different database
\c dbname user host connect with explicit user/host
\conninfo show current connection details
\q quit
Search

\dt _foo_ table-name pattern match
\d _foo_ pattern match on any object
Output / formatting

\x toggle expanded (one-column-per-line) display — great for wide rows
\timing toggle showing query execution time
\pset null '∅' show NULL as a visible character
\a toggle aligned/unaligned output
\H toggle HTML output
\o file.txt send query results to a file
\o stop sending to file
Files / scripts

\i file.sql run SQL from a file
\ir file.sql run SQL from a file (relative to current script)
\e open editor with the last query, then run it
\ef funcname edit a function definition
\copy table FROM 'f.csv' CSV HEADER client-side copy from a CSV
Help

\? list of all meta-commands
\h list of all SQL commands
\h SELECT syntax help for a specific SQL command
Tip: \? inside psql is the canonical reference — exhaustive and always current to your version.

backup aaa:
pg*dump -h localhost -p 5437 -d aaa -t fommenu -F p -f fommenu_backup*$(date +%Y%m%d).sql

backup bbb:
pg*dump -h localhost -p 5433 -d bbb -t fommenu -F p -f bb_backup*$(date +%Y%m%d).sql
