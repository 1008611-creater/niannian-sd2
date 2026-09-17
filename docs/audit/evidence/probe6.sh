#!/bin/bash
D=/srv/kidswear-data/staging/niannian-sd2-4998bd8
echo "=== ci.yml ==="
cat $D/.github/workflows/ci.yml
echo "=== mounts ==="
docker inspect niannian-sd2-app --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Mode}}){{"\n"}}{{end}}' 2>&1
echo "=== sd2 related containers ==="
docker ps -a --format '{{.Names}} | {{.Status}}' | grep -iE "sd2|video|worker" | head -10
echo "=== host worker processes ==="
ps aux | grep -iE "video-task-worker|dispatcher|harness" | grep -v grep | head -10
echo "=== systemd units ==="
systemctl list-units --type=service --all 2>/dev/null | grep -iE "niannian|video|redraw" | head -10
echo "=== compose file used ==="
docker inspect niannian-sd2-app --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>&1
