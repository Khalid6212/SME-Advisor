# Local setup

Getting the API running on a development machine. Fifteen minutes, most of it
waiting for an installer.

Production is a different shape — in-Kingdom managed Postgres and object
storage (D11). Nothing here is a deployment artifact.

---

## 1. A database

Pick one. Docker is closest to how this deploys; the native installer is
lighter if you would rather not run Docker Desktop.

### Docker

```bash
winget install --id Docker.DockerDesktop
```

Restart, start Docker Desktop, then from the repo root:

```bash
docker compose up -d
```

`docker compose logs -f postgres` if it does not come up. Stop with
`docker compose down`; add `-v` to also drop the data and start clean.

### Native Postgres

```bash
winget install --id PostgreSQL.PostgreSQL.17
```

The installer asks for a superuser password — remember it, it goes in
`DATABASE_URL`. Then create the database:

```bash
createdb -U postgres sme_advisor
```

### Hosted (Neon, Supabase, Vercel Postgres)

No install at all, and the quickest way to get moving. Create a Postgres
database, copy the connection string into `DATABASE_URL`, run the migration.
TLS is enabled automatically for any non-localhost host.

Vercel Postgres is Neon underneath, reached through Vercel's marketplace — the
same thing with an extra step if you do not already have a Vercel project.

**Development only.** Real client financials must not sit outside the Kingdom;
that is the whole point of D11. The same applies to hosting the API on Vercel:
besides residency, an interview turn runs an agent loop of up to eight tool
round trips, which sits badly against serverless function duration limits. The
SPA is static and can be hosted anywhere, including Vercel — that separation is
why the API was split out in the first place.

---

## 2. Environment

`api/.env` already exists with a generated `SESSION_SECRET` and sensible
defaults. Two values need filling in:

- `DATABASE_URL` — matches whichever route you took above. The Docker default
  is already set.
- `ANTHROPIC_API_KEY` — from console.anthropic.com. Needed only for the
  interview endpoint; auth and everything else work without it.

`.env` is gitignored. Keep it that way.

---

## 3. Migrate and run

From the repo root:

```bash
npm install
npm run migrate
npm run dev:api
```

`npm run migrate` is idempotent — it tracks applied files in
`schema_migrations` and skips them on the next run.

Check it is alive:

```bash
curl http://localhost:3001/health
```

---

## 4. Try the auth flow

No SMTP is configured in development, so the magic link **prints to the API
console** rather than being emailed.

```bash
curl -X POST http://localhost:3001/auth/magic-link -H "content-type: application/json" -d "{\"email\":\"you@example.com\"}"
```

Copy the link from the API log and open it. It sets a session cookie and
redirects to `APP_ORIGIN` — which will not be running yet, so expect the
browser to fail to connect. The cookie is set regardless.

To exercise the API with that session, save the cookie:

```bash
curl -c cookies.txt "http://localhost:3001/auth/verify?token=PASTE_TOKEN"
curl -b cookies.txt http://localhost:3001/auth/me
```

---

## 5. Start an interview

Needs `ANTHROPIC_API_KEY`.

```bash
curl -b cookies.txt -X POST http://localhost:3001/me/clients \
  -H "content-type: application/json" \
  -d "{\"name\":\"Al Faris Workshops\",\"brief\":\"We run two auto workshops in Dammam, mostly fleet contracts.\"}"
```

That creates the client, opens an interview, sends the brief as the first turn,
and returns the agent's opening questions. Continue with:

```bash
curl -b cookies.txt -X POST http://localhost:3001/me/clients/CLIENT_ID/interview/turn \
  -H "content-type: application/json" \
  -d "{\"message\":\"Around 400,000 riyals a month, mostly from three fleet customers.\"}"
```

---

## Making yourself a manager

New accounts are created as clients. To reach the manager side later:

```sql
UPDATE users SET role = 'manager' WHERE email = 'you@example.com';
```

---

## Things that go wrong

**`npm run migrate` fails on `CREATE EXTENSION`** — the role needs superuser,
or the extension is unavailable. `postgres` in Docker and the native installer
both have it. Some hosted providers pre-install `pgcrypto` and `citext`, in
which case `IF NOT EXISTS` makes the statement a no-op.

**`ECONNREFUSED` on migrate** — the database is not up yet. Docker's
healthcheck takes a few seconds after `up -d` returns.

**Interview turn returns `agent_unavailable`** — check the API log. Usually a
missing or invalid `ANTHROPIC_API_KEY`. The user's message is deliberately not
persisted when a turn fails, so retrying re-sends it rather than duplicating.

**Cookie not sticking** — `APP_ORIGIN` must exactly match where the SPA runs.
CORS is exact-origin because credentials are enabled, and a mismatch silently
drops the cookie.
