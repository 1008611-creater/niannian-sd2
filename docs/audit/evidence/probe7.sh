#!/bin/bash
D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
echo "=== du top-level (no node_modules/.next) ==="
du -sh --exclude=node_modules --exclude=.next $D 2>/dev/null
du -sh $D/node_modules 2>/dev/null
du -sh $D/.next 2>/dev/null
echo "=== dir sizes ==="
for x in app lib components public scripts docs deploy mac-agent data; do
  [ -d "$D/$x" ] && echo "$x: $(du -sh --exclude=node_modules $D/$x 2>/dev/null | cut -f1)"
done
echo "=== file count (excl node_modules/.next) ==="
find $D -type f -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | wc -l
echo "=== top-level md files ==="
ls $D/*.md | head -40
echo "=== ziyu jobs route ==="
sed -n '1,50p' $D/app/api/ziyu/jobs/route.ts 2>/dev/null
