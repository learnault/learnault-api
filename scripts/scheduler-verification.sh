#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
POSTGRES_USER="${POSTGRES_USER:-learnault}"
POSTGRES_DB="${POSTGRES_DB:-learnault_dev}"
INTERVAL_MS="${SCHEDULER_INTERVAL_MS:-15000}"
BATCH_SIZE="${BATCH_SIZE:-40}"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_q() { dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1" | tr -d '\r'; }

export LOG_LEVEL=debug

wait_seconds=$(( (INTERVAL_MS / 1000) * 3 + 5 ))

echo "==> Bringing up the stack (LOG_LEVEL=debug)"
dc up -d --build

echo "==> Waiting for the database"
until dc exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

seed_user() {
  psql_q "
    INSERT INTO users (id, email, username, password, role, \"isVerified\", status, \"createdAt\", \"updatedAt\")
    VALUES (gen_random_uuid(), 'scheduler-evidence@example.com', 'scheduler-evidence', 'x', 'LEARNER', true, 'ACTIVE', now(), now())
    ON CONFLICT (email) DO UPDATE SET \"updatedAt\" = now()
    RETURNING id;
  "
}

echo ""
echo "############################################################"
echo "# 1. Idle instance: a due retry drains with no HTTP traffic #"
echo "############################################################"

USER_ID="$(seed_user)"

psql_q "DELETE FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE';"

psql_q "
  INSERT INTO email_deliveries
    (id, \"userId\", \"to\", subject, body, type, status, error, \"attemptCount\", \"maxAttempts\", \"nextAttemptAt\", \"createdAt\", \"updatedAt\")
  VALUES
    (gen_random_uuid(), '$USER_ID', 'idle@example.com', 'idle-instance retry', '<p>evidence</p>',
     'SCHEDULER_EVIDENCE', 'pending', 'previous attempt failed', 1, 5, now() - interval '1 minute', now(), now());
"

echo "--> Before (no HTTP traffic will be sent to the API):"
psql_q "SELECT status, \"attemptCount\", \"nextAttemptAt\" FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE';"

echo "--> Waiting ${wait_seconds}s (SCHEDULER_INTERVAL_MS=${INTERVAL_MS})"
sleep "$wait_seconds"

echo "--> After:"
psql_q "SELECT status, \"attemptCount\", \"sentAt\" FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE';"

echo "--> Scheduler log lines for the email queue:"
dc logs --no-log-prefix scheduler | grep -E '"queue": ?"email"' | tail -5 || true

IDLE_STATUS="$(psql_q "SELECT status FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE' LIMIT 1;")"
if [ "$IDLE_STATUS" != "sent" ]; then
  echo "!! Expected the due row to be drained, got status='$IDLE_STATUS'" >&2
  dc logs scheduler | tail -40
  exit 1
fi
echo "✅ Due row drained on schedule with no inbound HTTP traffic"

echo ""
echo "###############################################################"
echo "# 2. Two replicas: due rows are processed exactly once         #"
echo "###############################################################"

echo "--> Scaling the scheduler to 2 replicas"
dc up -d --scale scheduler=2
sleep 5

psql_q "DELETE FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE';"
psql_q "
  INSERT INTO email_deliveries
    (id, \"userId\", \"to\", subject, body, type, status, \"attemptCount\", \"maxAttempts\", \"nextAttemptAt\", \"createdAt\", \"updatedAt\")
  SELECT gen_random_uuid(), '$USER_ID', 'replica-' || g || '@example.com', 'replica batch ' || g, '<p>evidence</p>',
         'SCHEDULER_EVIDENCE', 'pending', 0, 5, now() - interval '1 minute', now(), now()
  FROM generate_series(1, $BATCH_SIZE) AS g;
"

echo "--> Queued $BATCH_SIZE due rows across 2 replicas; waiting ${wait_seconds}s"
sleep "$wait_seconds"

echo "--> Attempt counts (a row drained twice would show attemptCount > 1):"
psql_q "
  SELECT \"attemptCount\", count(*)
  FROM email_deliveries
  WHERE type = 'SCHEDULER_EVIDENCE'
  GROUP BY \"attemptCount\"
  ORDER BY \"attemptCount\";
"

echo "--> Skipped ticks (the replica that lost the lease race):"
SKIPPED="$(dc logs --no-log-prefix scheduler | grep -c 'queue tick skipped' || true)"
echo "    $SKIPPED skipped tick(s) logged"

DUPLICATES="$(psql_q "SELECT count(*) FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE' AND \"attemptCount\" > 1;")"
PROCESSED="$(psql_q "SELECT count(*) FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE' AND status = 'sent';")"

echo "--> processed=$PROCESSED duplicates=$DUPLICATES"

if [ "$DUPLICATES" != "0" ]; then
  echo "!! $DUPLICATES row(s) were processed more than once" >&2
  exit 1
fi
if [ "$PROCESSED" != "$BATCH_SIZE" ]; then
  echo "!! Expected $BATCH_SIZE processed rows, got $PROCESSED" >&2
  exit 1
fi
echo "✅ Two replicas processed $BATCH_SIZE rows with no duplicates"

echo ""
echo "==> Cleaning up evidence rows"
psql_q "DELETE FROM email_deliveries WHERE type = 'SCHEDULER_EVIDENCE';"
dc up -d --scale scheduler=1

echo ""
echo "✅ Scheduler verification passed"
