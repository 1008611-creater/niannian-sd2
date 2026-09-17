#!/bin/bash
echo "=== app env: DATABASE_URL / POSTGRES / EDITOR ==="
docker exec niannian-sd2-app sh -c 'printenv | grep -iE "DATABASE_URL|POSTGRES|EDITOR" | sed -E "s/=(.*)/=<\1 len:\${#BASH_REMATCH[1]}>/" | while IFS= read -r l; do k="${l%%=*}"; v="${l#*=}"; printf "%s -> len=%s\n" "$k" "$(printf "%s" "${v}" | wc -c)"; done'
echo "=== raw keys present ==="
docker exec niannian-sd2-app sh -c 'printenv | grep -iE "DATABASE_URL|POSTGRES|EDITOR" | cut -d= -f1'
