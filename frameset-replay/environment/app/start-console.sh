#!/usr/bin/env bash
# Bring the legacy servicing console up, idempotently.
set -u

PORT=8080
LOG=/var/log/console.log
LOCK=/tmp/.console.lock
TOKEN_FILE=/run/frameset-replay/control-token

# A TCP connect, not an HTTP GET: the verifier audits every non-control request
# the console receives, and a readiness probe must not appear in that audit.
up() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }

up && exit 0

exec 9>"$LOCK" 2>/dev/null && flock 9 2>/dev/null
up && exit 0

if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"
  ( umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$TOKEN_FILE" )
  chown targetsvc:targetsvc "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

runuser -u targetsvc -- env CONTROL_TOKEN_FILE="$TOKEN_FILE" \
  nohup node /app/target/server.js >>"$LOG" 2>&1 &

for _ in $(seq 1 150); do
  up && exit 0
  sleep 0.1
done

echo "console failed to start on port ${PORT}; see ${LOG}" >&2
exit 1
