#!/bin/bash
echo "=== db list ==="
docker exec niannian-sd2-postgres psql -U "$POSTGRES_USER" -lqt 2>&1 | head -10
echo "=== public tables in niannian ==="
docker exec niannian-sd2-postgres psql -U "$POSTGRES_USER" -d niannian -c '\dt public.*' 2>&1 | head -30
echo "=== table count ==="
docker exec niannian-sd2-postgres psql -U "$POSTGRES_USER" -d niannian -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>&1
echo "=== app logs (last 60) ==="
docker logs --tail 60 niannian-sd2-app 2>&1 | tail -60
