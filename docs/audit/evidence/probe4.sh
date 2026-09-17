#!/bin/bash
D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
echo "=== sqlite3 available? ==="
docker exec niannian-sd2-app sh -c 'command -v sqlite3 || echo NO_SQLITE3'
echo "=== node sqlite deps ==="
docker exec niannian-sd2-app sh -c 'ls node_modules | grep -i sqlite | head'
echo "=== video-assets ==="
ls -la $D/data/video-assets | head -10
find $D/data/video-assets -type f | wc -l
find $D/data/video-assets -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -5
echo "=== docs ==="
ls -R $D/docs 2>/dev/null | head -40
echo "=== deploy ==="
ls -R $D/deploy 2>/dev/null | head -40
echo "=== .github ==="
find $D/.github -type f | head -20
echo "=== package scripts ==="
docker exec niannian-sd2-app sh -c 'node -e "const p=require(\"/app/package.json\");console.log(JSON.stringify(p.scripts,null,1));console.log(\"name:\",p.name,\"ver:\",p.version)"' 2>&1 | head -30
echo "=== git repo? ==="
ls -d $D/.git 2>/dev/null || echo "NO_GIT"
