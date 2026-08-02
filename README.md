# CrewMade Automate Hub

Admin and user portal for managing n8n workflows, executions, credentials, prompts, webhooks, MCP servers, and knowledge-base content.

## Local setup

1. Create a local Postgres database:

```bash
createdb crewmade_nexus
```

2. Create `.env.local`:

```bash
cp .env.example .env.local
```

Set `DATABASE_URL`, `SESSION_SECRET`, and `CREDENTIAL_ENCRYPTION_KEY`.

Generate an encryption key with:

```bash
openssl rand -hex 32
```

3. Install and migrate:

```bash
npm install
npm run db:migrate
npm run dev
```

For local development, the migration seeds:

```txt
Email: admin@localhost.local
Password: admin123
```

For production, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` before the first migration. The seed password is not shown on the login page or printed in production logs.

## Current modules

- Signup/signin with admin/user roles
- Per-user encrypted n8n base URL and API key storage
- Admin user list and cross-user n8n instance visibility
- User-scoped n8n workflows and executions
- Dashboard summary
- n8n workflow grid with preview and archived workflow filtering
- Admin workflow transfer to one or many users through the transfer webhook
- Duplicate transfer protection with per-user workflow access records
- Schema-driven internal tool forms for admin and transferred user workflows
- Admin-granted internal tool access for users without their own n8n, executed through admin n8n webhooks
- User-side credential mapping and activation flow for transferred workflows
- n8n credential metadata viewer without exposing secret values
- Monitoring and observability panels
- Admin audit log and workflow operation attempts
- Knowledge base
- Prompt library
- Email templates
- App API keys
- Outbound webhooks
- MCP server registry
- Credential store metadata with encrypted shared data

## Useful commands

```bash
npm run db:migrate
npm run dev
npm run build
npm run smoke
```

`npm run smoke` is intentionally non-destructive by default. It checks login, core APIs, schema visibility, credentials, audit, and CRUD modules. To run the real workflow-transfer mutation, use:

```bash
RUN_TRANSFER=1 npm run smoke
```

Only run the transfer mutation against a disposable workflow/user pair or a target n8n instance where creating a copy is acceptable.

## Docker server setup

1. Copy the Docker env template:

```bash
cp .env.docker.example .env
```

2. Edit `.env` and set strong values:

```bash
openssl rand -hex 32
```

Use the generated value for `CREDENTIAL_ENCRYPTION_KEY`. Set `SESSION_SECRET` and `POSTGRES_PASSWORD` to strong private values too.

3. Build and run:

```bash
docker compose up -d --build
```

The app container waits for Postgres, runs migrations, then starts Next.js on `APP_PORT` default `3000`.

4. View logs:

```bash
docker compose logs -f app
```

5. Stop:

```bash
docker compose down
```

Postgres data is stored in the named Docker volume `crewmade_postgres_data`.

## Server auto-deploy

The production server can run a systemd timer that checks GitHub `main` and redeploys when a new commit is available.

Current server deployment path:

```txt
/opt/crewmade-automate-hub
```

Useful server commands:

```bash
cd /opt/crewmade-automate-hub
docker compose ps
docker compose logs -f app
systemctl status crewmade-automate-hub-deploy.timer
tail -f /var/log/crewmade-automate-hub-deploy.log
```

Manual deploy on the server:

```bash
/usr/local/bin/crewmade-automate-hub-deploy
```

## Production environment

Set these before deployment:

```txt
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB_NAME
SESSION_SECRET=<long random string>
SESSION_COOKIE_SECURE=false
CREDENTIAL_ENCRYPTION_KEY=<64 hex characters>
TRANSFER_WEBHOOK_URL=https://n8n.crewmadeautomate.online/webhook/transfer-submit-to-user
```

Use `SESSION_COOKIE_SECURE=false` for plain HTTP/IP deployments. Set it to `true` only when the app is behind HTTPS. Keep `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` stable after launch. Changing the encryption key will make stored n8n/API secrets unreadable.

## Database handover

The app uses versioned SQL files in `scripts/migrations/` plus the base setup in `scripts/migrate.mjs`.

Important tables:

- `users`: admin/user accounts.
- `n8n_instances`: encrypted n8n base URL/API key connections owned by each user.
- `workflow_schemas`: admin/global workflow form schemas synced from the admin n8n schema source.
- `user_transferred_workflows`: workflow access and target workflow IDs per user.
- `user_workflow_schemas`: per-user form schemas with user-specific webhook URLs.
- `user_internal_tool_access`: admin-granted internal tools that run on admin n8n for users without n8n.
- `workflow_operation_attempts`: transfer, credential mapping, activation, and delete attempt history.
- `audit_log`: high-level admin and application events.

Back up Postgres before production changes:

```bash
pg_dump "$DATABASE_URL" > crewmade_nexus_backup.sql
```

Restore with:

```bash
psql "$DATABASE_URL" < crewmade_nexus_backup.sql
```

## Real n8n verification checklist

Before client handover, verify with a safe target user and a disposable or approved workflow:

- Save admin and user n8n credentials and confirm verification passes.
- Sync workflow schemas from admin n8n.
- Transfer a workflow to one user and confirm `user_transferred_workflows` and `user_workflow_schemas` are created.
- Transfer the same workflow again and confirm it is skipped as duplicate.
- Open the transferred user account and confirm only that user's forms/workflows are visible.
- Grant an internal tool to a user without n8n and confirm the user's form submits to the admin n8n webhook.
- Test credential mapping plus activation for a workflow that needs OpenAI/Google Sheets credentials.
- Delete a transferred test workflow from the admin access screen and confirm the n8n workflow and Automate Hub access record are removed.
