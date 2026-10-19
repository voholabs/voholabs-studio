#!/bin/sh
# Container entrypoint: bring up the in-container Temporal dev server first,
# wait until it accepts connections, then start nginx + the Postiz processes.
set -e

# With MCP_GATEWAY_URL set (e.g. http://gateway.internal:8080), the MCP
# endpoints (/api/mcp-oauth, /api/mcp, /api/mcp/<key>) go to that gateway,
# which relays them to the backend. The URLs connected agents use stay the
# same. If the gateway cannot be reached, nginx serves the request from the
# backend directly, so agents keep working (only when nothing reached the
# gateway, so a tool call is never sent twice). Unset or malformed, the file
# is empty and nothing changes.
write_mcp_gateway_conf() {
  conf=/etc/nginx/mcp-gateway.conf
  : > "$conf"
  [ -n "$MCP_GATEWAY_URL" ] || return 0
  # scheme://host[:port] only: nginx appends the request path itself, so a
  # path here would be dropped or doubled.
  gateway=$(printf '%s' "$MCP_GATEWAY_URL" | sed -e 's#/*$##')
  if ! printf '%s' "$gateway" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'; then
    echo "[start] MCP_GATEWAY_URL is not scheme://host[:port] ($MCP_GATEWAY_URL); MCP endpoints stay on the backend"
    return 0
  fi
  resolver=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
  case "$resolver" in *:*) resolver="[$resolver]" ;; esac
  echo "[start] MCP endpoints go through the gateway at $gateway"
  cat > "$conf" <<EOF
resolver $resolver valid=10s ipv6=on;

# The MCP endpoints. When the gateway cannot be reached, the backend serves
# the request directly (@mcp_direct). A POST is a tool call and must not run
# twice, so @mcp_direct only takes a request none of which reached the
# gateway (\$upstream_bytes_sent is 0, or empty when the name did not
# resolve): the connection was refused or timed out. A gateway that took the
# request and then failed gives the agent a 502/504 instead of a resend.
# nginx 1.22 cannot fail over a variable proxy_pass with proxy_next_upstream
# (that needs an upstream group, which resolves the name once at boot),
# hence the check. The gateway's own 502/504 responses pass through as they
# are (proxy_intercept_errors off) and never trigger the fallback.
location ~ ^/api/(mcp-oauth|mcp|mcp/[^/]+)/?\$ {
    set \$mcp_gateway $gateway;
    rewrite ^/api(/.*)\$ \$1 break;
    proxy_pass \$mcp_gateway;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 3s;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_intercept_errors off;
    error_page 502 504 = @mcp_direct;
}

# The gateway's file links. Only the gateway has them, so there is no
# fallback: a 502 while it is down, its own 404 for a missing file. No
# add_header here, so the server's security headers apply.
location ~ ^/api/mcp-files/.+\$ {
    set \$mcp_gateway $gateway;
    rewrite ^/api(/.*)\$ \$1 break;
    proxy_pass \$mcp_gateway;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 3s;
    proxy_read_timeout 300s;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
}

location @mcp_direct {
    if (\$upstream_bytes_sent ~ [1-9]) {
        return 502;
    }
    rewrite ^/api(/.*)\$ \$1 break;
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # As on /api/: only the gateway's own calls to the backend carry it.
    proxy_set_header X-Mcp-Gateway-Secret "";
}
EOF
}

TEMPORAL_DB_DIR="${TEMPORAL_DB_DIR:-/temporal}"
mkdir -p "$TEMPORAL_DB_DIR"

echo "[start] launching Temporal dev server..."
# WAL with synchronous=normal makes SQLite sync to disk at checkpoints rather
# than on every commit, so a slow volume does not time Temporal out.
# gRPC and the web UI listen on loopback only: the backend and orchestrator in
# this container reach it at localhost:7233, and the UI stays reachable from a
# shell inside the container (railway ssh) without being exposed to anything
# else on the private network.
temporal server start-dev \
  --ip 127.0.0.1 \
  --port 7233 \
  --ui-ip 127.0.0.1 \
  --ui-port 8233 \
  --db-filename "$TEMPORAL_DB_DIR/temporal.db" \
  --namespace default \
  --sqlite-pragma journal_mode=wal \
  --sqlite-pragma synchronous=normal \
  --log-level error &

# Wait for Temporal to accept connections (up to ~90s) so the backend's
# search-attribute registration doesn't race it on boot.
i=0
while [ "$i" -lt 90 ]; do
  if temporal operator namespace describe default --address 127.0.0.1:7233 >/dev/null 2>&1; then
    echo "[start] Temporal dev server ready"
    break
  fi
  i=$((i + 1))
  sleep 1
done

# Bound Temporal history growth so the /temporal volume doesn't fill up.
# Retention only purges CLOSED workflow history; running and future-scheduled
# workflows are never affected. 24h is Temporal's minimum. Best-effort: never
# block startup if the CLI flag differs across versions.
temporal operator namespace update -n default --retention 24h --address 127.0.0.1:7233 >/dev/null 2>&1 \
  || temporal operator namespace update default --retention 24h --address 127.0.0.1:7233 >/dev/null 2>&1 \
  || echo "[start] warning: could not set Temporal retention (continuing)"

write_mcp_gateway_conf

echo "[start] starting nginx + app processes..."
nginx
pnpm run pm2
