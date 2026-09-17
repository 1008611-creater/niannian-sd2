#!/bin/bash
echo "=== table count (public) ==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc "select count(*) from information_schema.tables where table_schema='"'"'public'"'"'"' 2>&1
echo "=== all schemas ==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc "select schema_name from information_schema.schemata"' 2>&1
echo "=== tables any schema ==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc "select table_schema||'"'"'.'"'"'||table_name from information_schema.tables where table_schema not like '"'"'pg\_%'"'"' and table_schema <> '"'"'information_schema'"'"' order by 1"' 2>&1 | head -40
echo "=== app log: db/relation errors ==="
docker logs --tail 400 niannian-sd2-app 2>&1 | grep -iE "relation|does not exist|ECONNREFUSED|postgres|database|migration" | head -20
echo "=== app log: provider/ziyu errors ==="
docker logs --tail 400 niannian-sd2-app 2>&1 | grep -iE "ziyu|provider|mimo|miora|runninghub|credits" | head -20
echo "=== data dir ==="
ls -la /srv/kidswear-data/staging/niannian-sd2-4998bd8/data 2>/dev/null | head -10
