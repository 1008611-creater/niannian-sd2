#!/bin/bash
D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
echo "=== git repo? ==="
ls -d $D/.git 2>/dev/null || echo NO_GIT
echo "=== .github files ==="
find $D/.github -type f | head -20
echo "=== package scripts ==="
docker exec niannian-sd2-app sh -c 'node -e "const p=require(\"/app/package.json\");console.log(JSON.stringify(p.scripts,null,1))"' 2>&1 | head -25
echo "=== migrations dir ==="
ls $D/deploy/migrations 2>/dev/null | head -20
echo "=== python sqlite on host ==="
command -v python3 && python3 -c "
import sqlite3
c=sqlite3.connect('file:$D/data/niannian-auth.sqlite?mode=ro',uri=True)
for (n,) in c.execute(\"select name from sqlite_master where type='table' order by name\"):
    try:
        cnt=c.execute('select count(*) from \"%s\"'%n).fetchone()[0]
    except Exception as e:
        cnt='?'
    print(n, cnt)
" 2>&1 | head -30
echo "=== container image/build time ==="
docker inspect niannian-sd2-app --format '{{.Created}} | {{.Config.Image}}' 2>&1
echo "=== compose project ==="
docker inspect niannian-sd2-app --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>&1
