# Deploy with Docker and HTTPS

Use one Linux server with Docker Compose, a domain pointing to it, and ports 80/443 available
for Caddy. The application port is only reachable on the private container network. Caddy obtains
and renews certificates for a public domain when its DNS and port requirements are met; see
[Caddy's HTTPS requirements](https://caddyserver.com/docs/automatic-https#overview).

From this folder, copy `.env.example` to `.env`. Set `TASK_DOMAIN` to the hostname only, such as
`tasks.example.com`, and `ACME_EMAIL` to your certificate contact address. Neither value is an
application password. Keep real secrets and runtime databases out of source control.

Build the application and create its first administrator interactively:

```sh
docker compose build
docker compose run --rm --no-deps taskmanager node scripts/setup.mjs
```

The setup command prompts for a name, username and password without echoing the password. It
stores the account in the same persistent volume used by the app. It refuses to run again after
the first account has been created. Start the application and proxy:

```sh
docker compose --profile https up -d
docker compose --profile https logs --tail 50
```

Visit your domain over HTTPS, sign in and add colleagues. Use the same URL on your phone.
An internal-only deployment can sit behind your company VPN; DNS and certificate provisioning
must match that network. No DNS records, certificates or external server are provisioned by
the source files alone.

## Persistent storage and backup

Compose keeps the database, backups and Caddy certificates in separate named volumes. Do not
use `docker compose down -v` during an update: that removes persistent volumes.

Run an online backup:

```sh
docker compose exec -T taskmanager node scripts/backup.mjs
```

The command prints the verified file path. Export that file to a restricted location outside
the server, replacing the filename below with the actual returned filename:

```sh
docker compose cp taskmanager:/app/backups/ACTUAL-FILENAME.sqlite ./ACTUAL-FILENAME.sqlite
```

Schedule backups on the server, for example with cron using the absolute Compose file path:

```text
0 2 * * * cd /srv/taskmanager && docker compose exec -T taskmanager node scripts/backup.mjs >> /var/log/taskmanager-backup.log 2>&1
```

This example runs at 02:00 in the server's configured timezone. Check job failures and copy
backups off the server. Retention and off-server copies are operator responsibilities.

For a restore, stop both services, keep a recovery copy of the existing data volume, and restore
the selected backup into an empty data directory as `taskmanager.sqlite`. Use the Node container's
`node` user ownership (UID/GID 1000) for restored files. Do not retain old WAL/SHM files. Restart
and verify sign-in, a task and its history before admitting normal traffic.

Current backups exclude login sessions. If you restore an older backup that included sessions,
clear them from the restored database while the app is stopped. Pass the restored file path as
the final argument. This affects only the database you specify.

```sh
node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('DELETE FROM sessions'); db.close();" data/taskmanager.sqlite
```

## Update and troubleshoot

Take and export a backup before updating the source. Then run:

```sh
docker compose --profile https up -d --build
```

`APP_ORIGIN` must exactly match the browser origin, with no trailing slash. Production startup
refuses an origin without HTTPS. The proxy preserves the incoming Host for the origin check;
see [Caddy reverse proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers).

Use the interactive setup command on the server when `APP_ORIGIN` is set or in production.
Browser setup is available only with the default loopback configuration.
If login is throttled, wait 15 minutes. The per-address limit is shared behind a proxy.
If the database cannot be opened, check the volume permissions and free disk space.

For a direct installation without Docker, Node.js 24.13 or newer is required. Set `DB_PATH`,
`APP_ORIGIN=https://your-domain` and `NODE_ENV=production`, run `node scripts/setup.mjs`, then
supervise `node server.mjs` with your service manager behind an HTTPS reverse proxy. Leave
`BIND=127.0.0.1` when the reverse proxy runs on the same host.
