# Project 2 — Containerise AfricAir with Docker

> **Domains assessed:** Dockerfiles & multi-stage builds · BuildKit caching · image hardening · runtime configuration & secrets · Docker networking & Compose · image scanning & SBOMs · registries (Docker Hub, Amazon ECR)
> **Suggested duration:** 1–1.5 weeks · **Team size:** 1–2 · **Builds on:** Project 1 (nginx config, build process, API settings and secrets)

## Scenario

The platform team wants **immutable images** that are built once and promoted unchanged from dev to staging to production. **All behaviour differences between environments must come from environment variables and secrets, never from rebuilding.**

AfricAir has two deployable parts, and each becomes its own image:

| Image | Contents | Port | User |
|---|---|---|---|
| `africair-web` | The static front end (`dist/`), served by `nginxinc/nginx-unprivileged`, which also **proxies `/api/`** to the API | 8080 | 101 |
| `africair-api` | The Node.js API (`server/`): runtime config, secrets, bookings in PostgreSQL, Prometheus metrics | 4000 (app) and 9464 (metrics) | non-root |

The environment variables and secrets **change what users see**: an environment banner, an announcement bar, maintenance mode, the service fee, promo codes, the admin page, and server-side bookings. That is how you will prove your configuration works. The full list is in `server/.env.example` and in the main README ("Runtime configuration, secrets and the API").

## Know the application

| Fact | Detail |
|---|---|
| Front-end build | `corepack enable && pnpm install --frozen-lockfile && pnpm build` → `dist/` |
| API build | `pnpm build:api` → `server/dist/`. Run it with `node server/dist/index.js`. It needs `server/migrations/` at runtime. |
| Workspace | pnpm workspace (`pnpm-workspace.yaml`): the root package is the front end, and `server/` is the `@africair/api` package |
| Gates | `pnpm check`, `pnpm test`. API database tests run when `TEST_DATABASE_URL` is set. |
| Migrations | `node server/dist/migrate.js`. Idempotent and safe to run concurrently (advisory lock). |
| Health | API: `/api/healthz` (liveness) and `/api/readyz` (readiness; `503` when the database is down). Web: you add `/healthz`. |
| Shutdown | On `SIGTERM` the API fails readiness, waits `SHUTDOWN_DELAY_MS`, then drains |
| E2E | `BASE_URL=http://<host>:<port> pnpm test:e2e`. Playwright **1.64.0**; matching image: `mcr.microsoft.com/playwright:v1.64.0-noble` |

## Tasks

### 1. `Dockerfile.web`: multi-stage front end

| Stage | Purpose |
|---|---|
| `deps` | Node 22 LTS. Copy **only** `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `server/package.json`, then run `pnpm install --frozen-lockfile` with a BuildKit **cache mount** for the pnpm store |
| `test` | Copy the source and run `pnpm check` and `pnpm test`. **The image build must fail if a test fails.** |
| `build` | Run `pnpm build` and write `dist/version.json` from the build args `VERSION`, `GIT_SHA` and `BUILD_DATE` |
| `runtime` | `nginxinc/nginx-unprivileged:<pinned>-alpine` with only `dist/` and your nginx templates. No Node, no source. |

- Add OCI labels (`org.opencontainers.image.revision`, `.version`, `.created`, `.source`), a `HEALTHCHECK` on `/healthz` (BusyBox `wget`), and `EXPOSE 8080`.
- The nginx config, as **envsubst templates** (`/etc/nginx/templates/*.template`), must have:
  - `/healthz`, gzip, `immutable` caching for `/assets/`, `no-cache` for `index.html` and `version.json`, and security headers;
  - `location /api/` proxied to `${API_UPSTREAM}` (e.g. `http://api:4000`), with `X-Forwarded-For` set;
  - an `X-Environment: ${APP_ENV}` response header.

### 2. `Dockerfile.api`: multi-stage API

| Stage | Purpose |
|---|---|
| `build` | Install workspace dependencies, then run `pnpm build:api` |
| `prod-deps` | A **production-only** `node_modules` for `@africair/api`: no TypeScript, no Vite, no React. Hint: `pnpm deploy --filter @africair/api --prod <dir>`; check the pnpm docs for the flags your pnpm version needs. |
| `runtime` | `node:22-alpine` (or a distroless Node 22 image) containing `dist/`, `migrations/`, `package.json` and the prod `node_modules`. `USER node`. `EXPOSE 4000 9464`. `HEALTHCHECK` on `/api/healthz`. |

- The default command runs the API. The **same image** runs migrations with `node dist/migrate.js`.
- Run Node **directly** as PID 1 (`CMD ["node", "dist/index.js"]`). See drill 6 for why `pnpm start` is a bad idea.
- Target an API image **under 120 MB**. Report what the remaining megabytes are.

### 3. `.dockerignore`

Exclude `node_modules` (at every level), `dist`, `server/dist`, `.git`, `test-results`, `playwright-report`, and `.env*`, except `.env.example`. Prove the effect on the build-context size.

### 4. Compose: the whole stack

Create `compose.yaml`:

| Service | Details |
|---|---|
| `db` | `postgres:16-alpine`. Its password comes from a **Compose secret** (`POSTGRES_PASSWORD_FILE`). Named volume. `healthcheck` using `pg_isready`. |
| `migrate` | The API image with `command: ["node", "dist/migrate.js"]`. Runs once after `db` is healthy (`depends_on: condition: service_healthy`). |
| `api` | The API image, **2 replicas**. Starts only after `migrate` has **completed successfully** (`condition: service_completed_successfully`). Settings come from `env_file: config/staging.env`, and secrets are mounted as **Compose secrets** (see task 5). |
| `web` | The web image, published on host port `8080`, with `API_UPSTREAM=http://api:4000` |
| `e2e` | The Playwright image with the repo mounted at `/work`. Runs `corepack enable && pnpm install --frozen-lockfile && BASE_URL=http://web:8080 pnpm test:e2e` once `web` is healthy. |

- Use a user-defined network. Neither `db` nor `api` publishes a port to the host; prove both are reachable only through `web`.
- **Load-balancing check:** with 2 `api` replicas, make nginx show which replica answered (e.g. `add_header X-Upstream $upstream_addr` on `/api/`). Run `curl -sI localhost:8080/api/config` ten times.

  > ⚠️ You'll likely see **only one** upstream. nginx resolves `api` **once, at startup**. Fix it with Docker's embedded DNS (`resolver 127.0.0.11 valid=10s;`) and a **variable** in `proxy_pass`. Explain why the variable matters.
- One command runs the tests and returns their exit code: `docker compose --profile test up --build --exit-code-from e2e`.

### 5. Environment variables and secrets you can **see**

`config/staging.env` holds settings only, never secrets:

```ini
APP_ENV=staging
APP_VERSION=1.0.0
BRAND_NAME=AfricAir Staging
ANNOUNCEMENT_TEXT=You are on the Docker Compose staging stack
ANNOUNCEMENT_LEVEL=warning
SERVICE_FEE_USD=5
DEFAULT_CURRENCY=NGN
```

Secrets are **files** in `secrets/` (git-ignored; commit a `secrets.example/` with dummy values). Mount them with Compose `secrets:` and point the app at them:

| Secret file | Mounted at | API variable |
|---|---|---|
| `secrets/db_password` | `/run/secrets/db_password` | Used to build `DATABASE_URL`. Hint: give the API a `database_url` secret, or use the `PG*` variables plus a password file. |
| `secrets/admin_token` | `/run/secrets/admin_token` | `ADMIN_TOKEN_FILE=/run/secrets/admin_token` |
| `secrets/promo_codes` | `/run/secrets/promo_codes` | `PROMO_CODES_FILE=/run/secrets/promo_codes` |

Prove each one in the browser at `http://localhost:8080`, with a screenshot for each:

1. The **orange STAGING banner**, the announcement, the brand "AfricAir Staging", prices starting in NGN, and a $5 service fee on the review page.
2. `/#/status`: storage "PostgreSQL database", and all secrets *Configured*, from a **mounted file**.
3. Book a flight with promo code `SAVE10`. The discount appears in the fare and in the PDF. Sign in at `/#/admin` with your token and see the booking.
4. Change `MAINTENANCE_MODE=true` in the env file, then `docker compose up -d api`: booking is blocked. Explain why `docker compose restart` is **not** enough after editing an env file.
5. **Rotate the admin token** by writing a new value into `secrets/admin_token`, **without** restarting anything. Within `SECRET_REFRESH_SECONDS` the fingerprint on `/#/status` changes, the old token gets *Invalid admin token*, and the new one works.
6. Stop `db` (`docker compose stop db`). `/api/readyz` returns `503`, `/#/status` shows the database error, and booking fails with a clear message. Start `db` again and everything recovers without restarting `api`.
7. `docker compose exec api env | grep -i token` must show **no secret values**. Explain why `_FILE` secrets are safer than env-var secrets: `docker inspect`, `/proc/<pid>/environ`, crash dumps.

### 6. Hardening: both containers must run like this

```bash
docker run --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 0.5 --pids-limit 100 ...
```

> ⚠️ The web container will break at first: the envsubst entrypoint writes into `/etc/nginx/conf.d`. Find the cause and fix it **without** dropping `--read-only`. Hint: `NGINX_ENVSUBST_OUTPUT_DIR`. Document the root cause.

### 7. Size, layers and cache

- Web image **under 50 MB**, API image **under 120 MB**. Explain the three biggest layers of each (`docker history`).
- Change one line in `src/components/Home.tsx`: the dependency layers must be `CACHED` in **both** builds. Then change `server/src/app.ts` and explain which image rebuilds what.

### 8. Scan, SBOM and lint

- `trivy image --severity HIGH,CRITICAL --exit-code 1` passes for both images, with any `.trivyignore` entries justified.
- Produce an SBOM for each (`docker buildx build --sbom=true` or `syft`). Which image has more packages, and why?
- `hadolint` passes on both Dockerfiles.

### 9. Registries

- Multi-arch (`linux/amd64` and `linux/arm64`) builds of both images, pushed to **Docker Hub**. Check them with `docker buildx imagetools inspect`.
- **Amazon ECR:**
  - two private repositories, with **scan on push**, **immutable tags**, and a lifecycle policy that keeps the last 10 tagged images and expires untagged ones after 1 day;
  - push both images tagged `<git-sha>` and `1.0.0`;
  - pull them on your Project 1 EC2 instance with its **instance role**.
- Explain your tag strategy and why `latest` is never deployed.

## Debugging drills

Reproduce each one, capture the error, explain it, and fix it:

1. The web container returns **403** for every page (file ownership after `COPY`).
2. The web container exits immediately after you change the listen port to `80` (non-root user plus a privileged port).
3. `api` starts before `migrate` finishes: the first bookings fail with `relation "bookings" does not exist`. Fix the startup order.
4. The image works on an arm64 Mac but fails with `exec format error` on EC2 (amd64).
5. `/api/*` returns **502** right after `docker compose up --scale api=3`, then works. Explain, and fix with the resolver (task 4).
6. With `CMD ["pnpm", "start"]` instead of `node`, `docker stop api` takes 10 seconds and the logs never show "shutdown requested". Explain signal handling and PID 1. Compare with `docker run --init`.
7. The API logs `password authentication failed`, but the password file is correct. Hint: a trailing newline written by `echo`; compare `echo` with `printf`. Note that the API trims secret files; what about Postgres's `POSTGRES_PASSWORD_FILE`?

## Acceptance checks (the instructor will run these)

```bash
docker compose up -d --build && sleep 20
curl -fsS localhost:8080/healthz
curl -s  localhost:8080/api/config | jq '{appEnv, brandName, storage, secrets: (.secrets | map_values(.source? // .status))}'
curl -sI localhost:8080/ | grep -i x-environment                  # staging
for i in $(seq 6); do curl -sI localhost:8080/api/config | grep -i x-upstream; done   # at least 2 different upstreams
docker compose exec api sh -c 'id -u; env' | grep -Ei 'token|password|promo'          # uid != 0, no secret VALUES
docker image inspect africair-web africair-api --format '{{.Config.User}} {{.Size}}'
docker compose --profile test up --build --exit-code-from e2e; echo $?                # 0
trivy image --severity CRITICAL --exit-code 1 africair-api
```

## Knowledge check (`ANSWERS.md`)

1. `CMD` vs `ENTRYPOINT`: how do they interact in the nginx image's entrypoint scripts?
2. Why copy lockfiles before the source? What is a cache mount, and how is it different from a layer?
3. Env-var secrets vs file secrets: list three ways an env-var secret can leak.
4. Why does `depends_on` not wait for "ready" unless you use `condition`? What do `service_healthy` and `service_completed_successfully` each guarantee?
5. Why does the API expose metrics on a **separate port**?
6. Why are migrations a separate one-shot container instead of `MIGRATE_ON_START=true` in every replica? What would happen with 5 replicas starting at once?

## Deliverables

Pull request containing:

- `Dockerfile.web`, `Dockerfile.api`, `.dockerignore`, `deploy/nginx/*.template`, `compose.yaml`, `config/*.env`, `secrets.example/`, and the `.trivyignore` / `.hadolint.yaml` files if you need them
- `docs/docker.md`: how to build, run, configure, rotate secrets, test and push
- `ANSWERS.md` with screenshots for every visible check in task 5, and evidence for every drill
- links to the Docker Hub and ECR images

## Grading rubric (100 pts)

| Area | Points |
|---|---|
| Both multi-stage builds: tests gate the build, cache efficiency, prod-only deps | 20 |
| Images: size, non-root, labels, healthchecks, PID 1 / signals | 10 |
| Compose: startup order, migration job, replicas, DNS-based load balancing, e2e exit code | 15 |
| Env vars and secrets: all seven visible checks, file secrets, live rotation | 20 |
| Hardened runtime incl. the read-only root-cause write-up | 10 |
| Scanning, SBOM, hadolint | 10 |
| Registries: multi-arch, ECR policies, instance-role pull | 10 |
| Debugging drills | 5 |

## Cost and cleanup

ECR storage costs cents; keep the repositories for Projects 3–5. Locally: `docker compose down -v` and `docker system prune -a`.
