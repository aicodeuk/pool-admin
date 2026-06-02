-- P0: remove the per-INSERT cleanup trigger on sync_logs.
-- It ran `DELETE FROM sync_logs WHERE created_at < now-24h` inside the write
-- transaction of EVERY sync request, serializing on D1's single writer and
-- driving "D1 is overloaded" queueing under load.
-- Retention is now enforced by the `sync_logs_cleanup` cron job instead.
DROP TRIGGER IF EXISTS sync_logs_cleanup;
