#!/usr/bin/env bash
set -uo pipefail

command -v docker >/dev/null 2>&1 || export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"

PGUSER_="${POSTGRES_USER:-learnault}"
PGDB_="${POSTGRES_DB:-learnault_dev}"
PGPORT_="${POSTGRES_PORT:-5433}"
INTERVAL="${SCHEDULER_INTERVAL_MS:-4000}"
BATCH="${BATCH_SIZE:-40}"
LOGDIR="$(mktemp -d)"

export DATABASE_URL="postgresql://${PGUSER_}:learnault@localhost:${PGPORT_}/${PGDB_}?schema=public"
export NODE_ENV=production
export LOG_LEVEL=debug
export SCHEDULER_INTERVAL_MS="$INTERVAL"
export SCHEDULER_LEASE_MS=10000

q() { docker compose exec -T db psql -U "$PGUSER_" -d "$PGDB_" -qAt -c "$1" | tr -d '\r'; }

echo "==> Starting PostgreSQL"
docker compose up -d db >/dev/null 2>&1
until docker compose exec -T db pg_isready -U "$PGUSER_" -d "$PGDB_" >/dev/null 2>&1; do sleep 1; done

if [ -z "$(q "SELECT to_regclass('public.queue_leases');")" ]; then
  echo "==> Syncing schema"
  npx prisma db push --accept-data-loss >/dev/null 2>&1
fi

q "DELETE FROM email_deliveries WHERE type='SCHED_EVIDENCE';" >/dev/null
q "DELETE FROM users WHERE username='sched-evidence';" >/dev/null
USR="$(q "INSERT INTO users (id,email,username,password,role,\"isVerified\",status,\"createdAt\",\"updatedAt\")
          VALUES (gen_random_uuid(),'sched-evidence@example.com','sched-evidence','x','LEARNER',true,'ACTIVE',now(),now())
          RETURNING id;" | head -1)"

echo ""
echo "============================================================"
echo " SCENARIO 1 — idle instance: failed delivery retried on time"
echo "============================================================"

q "INSERT INTO email_deliveries (id,\"userId\",\"to\",subject,body,type,status,error,\"attemptCount\",\"maxAttempts\",\"nextAttemptAt\",\"createdAt\",\"updatedAt\")
   VALUES (gen_random_uuid(),'$USR','idle@example.com','retry me','<p>x</p>','SCHED_EVIDENCE','pending','previous attempt failed',1,5,now()-interval '1 minute',now(),now());" >/dev/null

printf 'API on :5000   : '
if curl -s -m 2 http://localhost:5000/health/live >/dev/null 2>&1; then echo "RUNNING (stop it for a clean result)"; else echo "not running — no HTTP traffic is possible"; fi
printf 'before         : %s\n' "$(q "SELECT 'status='||status||'  attemptCount='||\"attemptCount\"||'  error='||error FROM email_deliveries WHERE type='SCHED_EVIDENCE';")"

./node_modules/.bin/tsx src/workers/scheduler.worker.ts > "$LOGDIR/a.log" 2>&1 &
PID_A=$!
echo "scheduler      : started (interval ${INTERVAL}ms, no API process)"
sleep 10

printf 'after          : %s\n' "$(q "SELECT 'status='||status||'  attemptCount='||\"attemptCount\" FROM email_deliveries WHERE type='SCHED_EVIDENCE';")"
echo "email tick     :"
grep '"queue":"email"' "$LOGDIR/a.log" | head -1

kill -TERM "$PID_A" 2>/dev/null; wait "$PID_A" 2>/dev/null
echo "after SIGTERM  : $(q "SELECT count(*)||'/6 leases released' FROM queue_leases WHERE \"leaseToken\" IS NULL;")"

S1="$(q "SELECT status FROM email_deliveries WHERE type='SCHED_EVIDENCE' LIMIT 1;")"
[ "$S1" = "sent" ] && echo "RESULT         : PASS — drained on schedule with zero inbound HTTP" \
                   || echo "RESULT         : FAIL — status=$S1"

echo ""
echo "============================================================"
echo " SCENARIO 2 — two replicas: no duplicate processing"
echo "============================================================"

q "DELETE FROM email_deliveries WHERE type='SCHED_EVIDENCE';" >/dev/null
q "INSERT INTO email_deliveries (id,\"userId\",\"to\",subject,body,type,status,\"attemptCount\",\"maxAttempts\",\"nextAttemptAt\",\"createdAt\",\"updatedAt\")
   SELECT gen_random_uuid(),'$USR','r'||g||'@example.com','batch '||g,'<p>x</p>','SCHED_EVIDENCE','pending',0,5,now()-interval '1 minute',now(),now()
   FROM generate_series(1,$BATCH) g;" >/dev/null

echo "queued         : $(q "SELECT count(*) FROM email_deliveries WHERE type='SCHED_EVIDENCE';") due rows"

SCHEDULER_OWNER_ID=replica-A ./node_modules/.bin/tsx src/workers/scheduler.worker.ts > "$LOGDIR/1.log" 2>&1 &
P1=$!
SCHEDULER_OWNER_ID=replica-B ./node_modules/.bin/tsx src/workers/scheduler.worker.ts > "$LOGDIR/2.log" 2>&1 &
P2=$!
echo "replicas       : replica-A and replica-B running concurrently"
sleep 14
kill -TERM "$P1" "$P2" 2>/dev/null; wait "$P1" "$P2" 2>/dev/null

echo "attemptCounts  : $(q "SELECT string_agg('attemptCount='||\"attemptCount\"||' -> '||c||' rows',', ') FROM (SELECT \"attemptCount\",count(*) c FROM email_deliveries WHERE type='SCHED_EVIDENCE' GROUP BY 1 ORDER BY 1) t;")"
A_SKIP=$(grep -c 'tick skipped' "$LOGDIR/1.log" 2>/dev/null || true)
B_SKIP=$(grep -c 'tick skipped' "$LOGDIR/2.log" 2>/dev/null || true)
echo "lease races    : replica-A skipped ${A_SKIP:-0}, replica-B skipped ${B_SKIP:-0}"

DONE_=$(q "SELECT count(*) FROM email_deliveries WHERE type='SCHED_EVIDENCE' AND status='sent';")
DUPE_=$(q "SELECT count(*) FROM email_deliveries WHERE type='SCHED_EVIDENCE' AND \"attemptCount\">1;")

q "DELETE FROM email_deliveries WHERE type='SCHED_EVIDENCE';" >/dev/null
q "DELETE FROM users WHERE username='sched-evidence';" >/dev/null
rm -rf "$LOGDIR"

if [ "$DUPE_" = "0" ] && [ "$DONE_" = "$BATCH" ]; then
  echo "RESULT         : PASS — $DONE_/$BATCH processed exactly once, 0 duplicates"
  exit 0
fi
echo "RESULT         : FAIL — processed=$DONE_ duplicates=$DUPE_"
exit 1
