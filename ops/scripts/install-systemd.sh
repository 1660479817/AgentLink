#!/usr/bin/env bash
set -euo pipefail

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
KNOT_USER="${KNOT_USER:-$(whoami)}"

echo "KNOT_HOME=$KNOT_HOME"
echo "KNOT_USER=$KNOT_USER"

sudo mkdir -p /etc/knot /var/knot/uploads
sudo chown "$KNOT_USER":"$KNOT_USER" /var/knot/uploads

if [[ ! -f /etc/knot/knot-platform.env ]]; then
  sudo cp "$KNOT_HOME/ops/env/knot-platform.env.example" /etc/knot/knot-platform.env
  echo "Edit: sudo nano /etc/knot/knot-platform.env"
fi
if [[ ! -f /etc/knot/openclaw-agent.env ]]; then
  sudo cp "$KNOT_HOME/ops/env/openclaw-agent.env.example" /etc/knot/openclaw-agent.env
  echo "Edit: sudo nano /etc/knot/openclaw-agent.env"
fi

for unit in knot-postgres knot-platform openclaw-agent; do
  sed -e "s|__KNOT_HOME__|$KNOT_HOME|g" -e "s|__KNOT_USER__|$KNOT_USER|g" \
    "$KNOT_HOME/ops/systemd/${unit}.service" | sudo tee "/etc/systemd/system/${unit}.service" >/dev/null
done

sudo systemctl daemon-reload
sudo systemctl enable knot-postgres knot-platform openclaw-agent
echo "Done. Start: sudo systemctl start knot-postgres && sudo systemctl start knot-platform openclaw-agent"
