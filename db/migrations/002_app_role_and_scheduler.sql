-- Dedicated login for the app (instead of the admin postgres user). Password is set out of band.
create role labloop_app login bypassrls password '<set-out-of-band>';
grant usage on schema public, extensions to labloop_app;
grant select, insert, update, delete, truncate on all tables in schema public to labloop_app;
revoke update, delete on audit_log from labloop_app;  -- history is append-only for the app
grant usage, select on all sequences in schema public to labloop_app;
grant execute on all functions in schema public to labloop_app;

-- Scheduler: Postgres calls the app's tick endpoint every 10 minutes (also keeps free-tier hosting awake).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select vault.create_secret('<CRON_SECRET>', 'labloop_cron_secret');
select cron.schedule('labloop-tick', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://labloop-9iqv.onrender.com/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'labloop_cron_secret')),
    timeout_milliseconds := 60000);
$$);
