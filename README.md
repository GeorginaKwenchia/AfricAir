# AfricAir

> Africa-first flight discovery and booking experience — bilingual, currency-aware, and designed around continent-wide journeys.

![AfricAir landing page](docs/images/africair-landing-page.png)

## Overview

AfricAir is a responsive flight booking site. Travellers search any airport in the world, compare outbound and return options, enter passenger details, review the full fare, and confirm. The confirmation creates a booking reference, e-ticket numbers and a downloadable PDF itinerary. **No payment is collected at any point.**

## Features

- **Worldwide coverage**: 4,008 airports with scheduled service in 233 countries and territories, from the [OurAirports](https://ourairports.com/data/) open dataset (public domain). All 247 countries and territories are listed on the Destinations page. Countries without an airport of their own (Monaco, Andorra, Vatican City…) point to their nearest gateways.
- **Airport search** by IATA code, city, airport name or country, in English or French, accent-insensitive, with keyboard navigation.
- **Search**: round trip or one way, 1–9 travellers (adults, children 2–11, infants under 2 on a lap), and four cabins. Dates are validated.
- **Results**: nonstop and connecting itineraries (via real hub airports), with durations based on distance, fares that vary by cabin, a ±3-day fare calendar, sort (best, cheapest, fastest, earliest), a stops filter, and expandable segment details with layovers.
- **Traveller details** with field-level validation: names, age rules per passenger type on the travel date, nationality, and passport/ID valid beyond the last flight. Contact email and phone are collected once per booking.
- **Review and confirm** with a fare breakdown per passenger type, taxes and service fee, and a required confirmation checkbox. No payment step.
- **PDF itinerary** (jsPDF): booking reference, status, every flight segment with airports, times, aircraft and baggage, travellers with e-ticket numbers and masked document numbers, fare summary, and important information. It downloads automatically on confirmation and can be downloaded again at any time.
- **My trips**: bookings are saved in the browser's local storage. Travellers can find a booking by reference and last name, view it, re-download the PDF, cancel it (the PDF is then marked cancelled) or remove it.
- **English / French** throughout, plus **35 display currencies** at indicative rates.
- **Shareable URLs**: a search lives in the URL (`#/flights?from=NBO&to=LOS&depart=…`), the browser back button works, and an in-progress booking survives a page reload.

## Runtime configuration, secrets and the API

The front end is static, so anything sent to the browser is public. Real configuration and secrets therefore live in a small **API** (`server/`, Node 22) that the site calls at `/api`. Without the API the site still works in **static mode** with built-in defaults (bookings stay in the browser).

**Environment variables → visible changes.** Restart the API after changing them.

| Variable | What changes in the app |
|---|---|
| `APP_ENV`, `APP_VERSION`, `GIT_SHA` | Coloured environment banner (hidden when `APP_ENV=production`); version on `/#/status` |
| `BRAND_NAME` | Brand in header, footer and browser tab |
| `ANNOUNCEMENT_TEXT`, `ANNOUNCEMENT_LEVEL` | Site-wide banner (info / warning / critical) |
| `MAINTENANCE_MODE=true` | Maintenance notice; *Confirm booking* is disabled |
| `SERVICE_FEE_USD` | The service fee line on every fare |
| `DEFAULT_LANGUAGE`, `DEFAULT_CURRENCY` | Starting language and currency for new visitors |
| `FEATURE_DESTINATIONS`, `FEATURE_MY_TRIPS`, `FEATURE_PROMO_CODES` | Show or hide those features |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE` | Help link and footer |

**Secrets → new behaviour.** Each can be given as `NAME=value` or as `NAME_FILE=/path`. File secrets are re-read every `SECRET_REFRESH_SECONDS`, so a rotated Kubernetes Secret mounted as a volume takes effect **without a restart**; env-var secrets need one.

| Secret | Effect |
|---|---|
| `DATABASE_URL` (or `PG*` variables) | Bookings are saved to PostgreSQL and can be found from any device; enables the admin page data |
| `ADMIN_TOKEN` | Unlocks `/#/admin` (bookings table and revenue stats) |
| `PROMO_CODES` (e.g. `SAVE10:10,AFRICA20:20`) | Promo box on the review page; codes are checked on the server and never sent to the browser |

**`/#/status`** shows the configuration the deployment received, and for each secret whether it is configured, where it came from (file or env), when it was loaded, and a short fingerprint (hidden in production). It never shows secret values, so it is a safe way to check that a secret arrived.

| Endpoint | Purpose |
|---|---|
| `GET /api/healthz` | Liveness: the process is up |
| `GET /api/readyz` | Readiness: `503` while the database is unreachable or during shutdown |
| `GET /api/config` | Public runtime config and secret status (no values) |
| `POST /api/promo/validate` | Checks a promo code (rate-limited) |
| `POST /api/bookings`, `GET /api/bookings/:ref?lastName=`, `POST /api/bookings/:ref/cancel` | Server-side bookings |
| `GET /api/admin/bookings` | Admin list and stats (`Authorization: Bearer <ADMIN_TOKEN>`) |
| `GET :9464/metrics` | Prometheus metrics on a separate port (not exposed publicly) |

Run it locally (see `server/.env.example` for every variable):

```bash
pnpm build:api
DATABASE_URL=postgres://user:pass@localhost:5432/africair node server/dist/migrate.js   # create the schema
APP_ENV=dev ADMIN_TOKEN=dev-token PROMO_CODES=SAVE10:10 DATABASE_URL=... pnpm dev:api
pnpm dev                     # the Vite dev server proxies /api to localhost:4000
```

## Important note

There is no live airline inventory. Schedules and fares are generated deterministically for each route, date and cabin, so the same search always returns the same flights, and they are labelled as indicative. Carriers are fictional. Nothing is ticketed and no payment is taken. Connecting to real inventory (an NDC or GDS provider) would replace `src/lib/flights.ts`.

## Run locally

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

## Quality checks

```bash
pnpm check          # TypeScript
pnpm test           # unit + API tests (set TEST_DATABASE_URL to include the PostgreSQL tests)
pnpm test:e2e       # Playwright: full booking flows on desktop + mobile (run `npx playwright install chromium` once)
pnpm build
```

## Project structure

```text
src/
  App.tsx                 # Routing, booking state, guards
  i18n.ts                 # English and French strings
  context.ts              # Language, currency and formatting context
  components/             # Header, SearchForm, AirportCombobox, Results, Travellers, Review, Trips, Destinations, Home
  data/airports.json      # Generated airport dataset (do not edit by hand)
  data/airports.ts        # Airport lookup, search, country names
  data/currencies.ts
  lib/flights.ts          # Itinerary generation and pricing
  lib/validation.ts       # Search, passenger and contact rules
  lib/pdf.ts              # PDF itinerary
  lib/bookings.ts         # Local storage persistence, references, e-ticket numbers
  lib/router.ts           # Hash routing and search URL encoding
  lib/api.ts              # API client; falls back to static defaults when /api is missing
server/                     # API: runtime config, secrets, bookings, admin, metrics (Node 22, PostgreSQL)
  src/  migrations/  .env.example
scripts/build-airports.mjs  # Regenerates airports.json: `pnpm data:airports`
e2e/booking.spec.ts         # End-to-end tests
```

## DevOps bootcamp projects

AfricAir doubles as the sample application for a five-part DevOps bootcamp. The API's environment variables and secrets **visibly change the site** (banner, announcement, maintenance mode, promo codes, admin page, database storage), and `/#/status` shows what each deployment received, so students can see whether their configuration and secret delivery actually work. Each project has its own brief, acceptance checks, knowledge questions and grading rubric:

| # | Project | Domains |
|---|---|---|
| 1 | [Linux, scripting, the build process & AWS hosting](projects/01-linux-scripting-build-aws/README.md) | Bash, systemd (env files, `LoadCredential`), nginx, PostgreSQL, EC2, IAM, S3 + CloudFront |
| 2 | [Containerise AfricAir with Docker](projects/02-docker/README.md) | Two multi-stage images, Compose with PostgreSQL and migrations, Compose secrets, hardening, scanning, ECR |
| 3 | [CI/CD with GitHub Actions and CircleCI](projects/03-cicd-github-actions-circleci/README.md) | Pipelines, service containers, caching, OIDC, build-once/promote, approvals |
| 4 | [EKS with Terraform, Helm, RDS, External Secrets & Ingress](projects/04-kubernetes-eks-terraform/README.md) | Exact EKS/RDS spec in Terraform, Helm chart, ESO + Secrets Manager with live rotation, ALB Ingress |
| 5 | [GitOps with Argo CD, plus Prometheus & Grafana](projects/05-gitops-argocd-observability/README.md) | Argo CD app-of-apps, kube-prometheus-stack, ServiceMonitor, dashboards and alerts as code, incident drills |
