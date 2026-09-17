#!/bin/bash
echo "=== drivers in /app/node_modules ==="
docker exec niannian-sd2-app sh -c 'ls /app/node_modules 2>/dev/null | grep -iE "sqlite|^pg$|postgres|drizzle|prisma" | head -10; echo "--- total:"; ls /app/node_modules 2>/dev/null | wc -l'
echo "=== /app/data ==="
docker exec niannian-sd2-app sh -c 'ls -la /app/data 2>/dev/null | head'
echo "=== db usage in code ==="
docker exec niannian-sd2-app sh -c 'grep -rln "better-sqlite3" /app/lib /app/app 2>/dev/null | head -5'
docker exec niannian-sd2-app sh -c 'grep -rln "sqlite" /app/lib /app/app 2>/dev/null | head -8'
docker exec niannian-sd2-app sh -c 'grep -rln "POSTGRES\|pgPool\|new Pool" /app/lib /app/app 2>/dev/null | head -8'
echo "=== db module ==="
docker exec niannian-sd2-app sh -c 'ls /app/lib | head -50'
