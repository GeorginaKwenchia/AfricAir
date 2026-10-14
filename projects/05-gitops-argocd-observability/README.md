# Project 5 — GitOps with Argo CD, plus Prometheus & Grafana

> **Domains assessed:** GitOps principles · Argo CD (Applications, app-of-apps, sync waves and hooks, self-heal, prune, rollback, RBAC) · Helm with Argo CD · kube-prometheus-stack (Prometheus Operator, ServiceMonitor, PrometheusRule, Alertmanager) · Grafana dashboards as code · secrets for platform tools via ESO · SLO thinking · incident drills
> **Suggested duration:** 1.5–2 weeks · **Team size:** 2–3 · **Builds on:** Project 4 (EKS cluster, Helm chart, ESO, RDS) and Project 3 (CI)

## Scenario

`helm upgrade` from laptops and CI has caused drift: nobody can say what's actually running. Leadership wants:

1. **Git is the source of truth.** Argo CD deploys the **same Helm chart** from Project 4 for `staging` and `production`, and any manual change in the cluster is reverted automatically.
2. **Observability.** Prometheus scrapes the AfricAir API's metrics, Grafana shows a business and technical dashboard, and Alertmanager pages the team when bookings fail or the database is unreachable.
3. **Everything is code**, including the monitoring stack, the dashboards and the alerts, all deployed by Argo CD.

## What the app gives you to observe

The API serves Prometheus metrics on port **9464** at `/metrics`. This port is **not** behind the Ingress.

| Metric | Type | Labels | Use it for |
|---|---|---|---|
| `africair_http_requests_total` | counter | `method`, `route`, `status` | Request rate, error rate (5xx) |
| `africair_http_request_duration_seconds` | histogram | `method`, `route` | p50/p95/p99 latency |
| `africair_bookings_created_total` | counter | `cabin`, `trip_type` | Bookings per minute, cabin mix |
| `africair_bookings_cancelled_total` | counter | — | Cancellations |
| `africair_booking_value_usd_total` | counter | — | Revenue rate |
| `africair_promo_validations_total` | counter | `result` = valid / invalid / rate-limited | Promo abuse detection |
| `africair_admin_requests_total` | counter | `result` = ok / denied / disabled | Brute-force detection on the admin token |
| `africair_db_up` | gauge | — | `1` ok, `0` failing, `-1` not configured |
| `africair_maintenance_mode` | gauge | — | `1` while `MAINTENANCE_MODE` is on |
| `africair_build_info` | gauge | `version`, `commit`, `app_env` | Which version is running (annotations, joins) |
| `africair_api_*` | various | — | Node.js process metrics (heap, event-loop lag, GC, CPU) |

**Generating real traffic:** run `BASE_URL=https://<host> pnpm test:e2e` in a loop, or write a small `k6` script that searches, validates promo codes and books. Every booking really increments the counters.

---

## Part A — Cluster capacity and prerequisites

Reuse the Project 4 cluster. kube-prometheus-stack and Argo CD need room:

- scale the `general` node group to **3 × `t3.large`** (min 3), or add a second node group `platform` (`t3.large`, label `workload=platform`, taint `dedicated=platform:NoSchedule`) and schedule Argo CD and monitoring onto it with tolerations and node selectors. The second option scores higher; explain the trade-off;
- the EBS CSI driver and the default `gp3` StorageClass must work. Prometheus, Alertmanager and Grafana use **PVCs**.

Make both changes in **Terraform**, not the console.

## Part B — Install Argo CD

1. Install Argo CD with its **Helm chart**, pinned to a version, into namespace `argocd`. Do it once, with Terraform `helm_release` or `helm install`. This is the only manual install in the project; afterwards Argo CD manages itself (Part C).
2. Expose the UI at `argocd.<domain>` through the existing ALB Ingress group (`group.name: africair`), with TLS. Without a domain, use `kubectl port-forward` and document it.
3. Store the **admin password** in Secrets Manager (`africair/platform/argocd`), and deliver it through an **ExternalSecret** into `argocd-secret`. Argo CD expects a **bcrypt hash**: either store the hash in Secrets Manager, or check whether ESO's template functions can hash it for you, and justify your choice. **Disable** the initial admin secret afterwards.
4. **RBAC** (`argocd-rbac-cm`):
   - a `readonly` default role;
   - a `deployer` role that can sync but not delete applications in project `africair`;
   - **stretch:** SSO with GitHub (Dex) mapped to these roles.
5. Create an **AppProject** `africair`:
   - allowed source repo: your fork only;
   - allowed destinations: `africair-staging` and `africair-production` on this cluster;
   - a cluster-resource allowlist: Namespace only;
   - a **sync window** that denies production syncs on weekends.

## Part C — GitOps layout (app-of-apps)

Commit this structure; Argo CD tracks it:

```text
gitops/
  bootstrap/root-app.yaml            # the only Application applied by hand: points at gitops/apps
  apps/
    argocd.yaml                      # Argo CD manages its own Helm release (self-management)
    external-secrets.yaml            # ESO chart (moved from Project 4's Terraform; explain the hand-over)
    aws-load-balancer-controller.yaml
    monitoring.yaml                  # kube-prometheus-stack
    africair-staging.yaml            # the Project 4 chart + values-staging.yaml
    africair-production.yaml         # the same chart + values-production.yaml
  values/
    monitoring.yaml
    africair-staging.yaml
    africair-production.yaml
  platform/
    cluster-secret-stores.yaml       # ESO stores (sync wave -1)
    grafana-dashboards/              # ConfigMaps with dashboard JSON
    alerts/                          # PrometheusRule manifests
```

Requirements:

| Requirement | Detail |
|---|---|
| Same chart, two environments | Both Applications use `deploy/helm/africair` at a **Git revision**, with different value files. Production pins a **tag**, e.g. `targetRevision: v1.2.0`. |
| Staging sync policy | `automated: { prune: true, selfHeal: true }`, plus `syncOptions: [CreateNamespace=true, ServerSideApply=true]` |
| Production sync policy | **Manual sync** only. The sync window from Part B applies. |
| Ordering | **Sync waves**: `ClusterSecretStore`s (-2) → `ExternalSecret`s (-1) → migration Job as an Argo CD **`PreSync` hook** (replacing the Helm hook; explain why Argo CD ignores some Helm hooks and maps others) → Deployments (0) |
| Image updates | CI (Project 3) updates `image.tag` in `gitops/values/africair-staging.yaml` with a commit or PR. **Stretch:** Argo CD Image Updater. |
| Health | Custom health check (Lua in `argocd-cm`) so an `ExternalSecret` that isn't `Ready` marks the app **Degraded** |
| Notifications | Argo CD Notifications sends Slack or email on `on-sync-failed` and `on-health-degraded` |

`values/africair-production.yaml` must differ visibly from staging, so you can tell the environments apart in the browser:

```yaml
api:
  env:
    APP_ENV: production          # no environment banner
    BRAND_NAME: AfricAir
    ANNOUNCEMENT_TEXT: ""
    SERVICE_FEE_USD: "15"
    DEFAULT_CURRENCY: USD
  secrets:
    appSecretName: africair/production/app   # a different Secrets Manager secret
```

## Part D — Prometheus, Alertmanager and Grafana

Deploy **kube-prometheus-stack** (pinned chart version) through Argo CD into namespace `monitoring`:

| Component | Requirements |
|---|---|
| Prometheus | 7-day retention, 20 GiB gp3 PVC, resource requests/limits, `serviceMonitorSelectorNilUsesHelmValues: false` (explain it) |
| Grafana | Admin credentials from **ESO** (`africair/platform/grafana`), never in values. 5 GiB PVC. Dashboard sidecar enabled. Exposed at `grafana.<domain>`, or via port-forward. |
| Alertmanager | Receiver config (Slack webhook or SMTP password) from **ESO**. Routes: `severity=critical` → page, `warning` → chat. Inhibit warnings while a critical alert fires for the same `namespace`. |

### D1. Scrape the API

Add a **ServiceMonitor** to the AfricAir Helm chart, enabled by `metrics.serviceMonitor.enabled: true`:

- it selects the `api` Service on port name `metrics`, interval 15s;
- it adds the labels `app_env` and `namespace` via `relabelings`;
- your Project 4 NetworkPolicy must allow port 9464 **from the `monitoring` namespace only**. Prove that Prometheus can scrape, and that a pod in `default` cannot reach port 9464.

In the Prometheus UI, **Status → Targets** shows both staging and production `api` pods as `UP`.

### D2. Dashboards as code

Build a Grafana dashboard **"AfricAir — Service overview"** and commit its JSON as a ConfigMap labelled `grafana_dashboard: "1"`. Use template variables `namespace` and `pod`, and include:

| Row | Panels (write the PromQL yourself) |
|---|---|
| Traffic | Requests/s by route; 5xx error ratio; p95 latency by route (from the histogram buckets) |
| Business | Bookings per minute by cabin; revenue per hour (USD); promo validations by result; cancellations |
| Dependencies | `africair_db_up` as a stat panel with value mappings (1 = UP, 0 = DOWN, -1 = not configured); maintenance-mode indicator |
| Runtime | Pod restarts and container memory/CPU (from kube-state-metrics and cAdvisor); Node.js event-loop lag |
| Deployments | An **annotation** query on `changes(africair_build_info[5m]) > 0`, or on Argo CD sync events, so deploys show on every graph |

### D3. Alerts as code

Add a `PrometheusRule` with at least these alerts, each with `severity`, `summary`, `description` and a `runbook_url` pointing to your `docs/runbook.md`:

| Alert | Condition (you write the expression) | For | Severity |
|---|---|---|---|
| `AfricairApiDown` | No `up` series for the api job, or all targets down | 2m | critical |
| `AfricairDatabaseDown` | `africair_db_up == 0` on any pod | 2m | critical |
| `AfricairHighErrorRate` | 5xx ratio > 5% over 5m | 5m | warning |
| `AfricairHighLatency` | p95 > 500 ms over 10m | 10m | warning |
| `AfricairNoBookings` | Zero bookings in 30m while requests > 0 (only `app_env="production"`) | 30m | warning |
| `AfricairPromoAbuse` | Rate-limited promo validations > 1/s | 5m | warning |
| `AfricairAdminBruteForce` | Denied admin requests > 0.2/s | 5m | critical |
| `AfricairMaintenanceModeOn` | `africair_maintenance_mode == 1` in production | 15m | info |

Unit-test the rules with **`promtool test rules`** (`alerts/tests/*.yaml`), run in CI.

### D4. SLO (stretch)

Define an availability SLO of **99.5%** for `/api/*`, excluding health checks. Add recording rules and multi-window burn-rate alerts (1h/5m and 6h/30m), plus an error-budget panel.

## Part E — Drills (all changes go through Git unless the drill says otherwise)

| # | Drill | Expected evidence |
|---|---|---|
| 1 | `kubectl scale deploy/api --replicas=5 -n africair-staging` (manual drift) | Argo CD shows **OutOfSync**, then self-heals back to the Git value. Screenshot the app diff/history. |
| 2 | Commit `ANNOUNCEMENT_TEXT: "Flash sale: 20% off with AFRICA20"` to `values/africair-staging.yaml` | Argo CD syncs automatically, the pods roll via the checksum, and the banner appears in the browser. Time from commit to visible change? |
| 3 | Commit `MAINTENANCE_MODE: "true"` | Booking is blocked in the browser, the `africair_maintenance_mode` panel turns on, and `AfricairMaintenanceModeOn` fires in production only after promoting to prod |
| 4 | Promote to production: move `targetRevision` to a new tag, then do a **manual sync** | The production UI has no banner and shows USD prices; the Deployments annotation appears on the dashboards |
| 5 | Bad release: set the API image to a non-existent tag | The app goes **Degraded**, a notification is sent, and the old pods keep serving. Roll back with **`git revert`** (not the Argo CD UI) and explain why. |
| 6 | Break the database: remove the RDS security-group rule in **Terraform**, or rotate the RDS password without restarting the pods | `/api/readyz` turns 503, `AfricairDatabaseDown` fires and reaches your receiver, and Grafana shows `db_up = 0`. Restore, and watch it resolve. |
| 7 | Rotate `ADMIN_TOKEN` in Secrets Manager | No Git change and no sync are needed; the fingerprint on `/#/status` changes (as in Project 4). Then run a script that hammers `/api/admin/bookings` with wrong tokens: `AfricairAdminBruteForce` fires. |
| 8 | Delete the `africair-staging` namespace | Argo CD recreates everything; ESO resyncs the secrets; the migration hook runs and is idempotent; e2e passes again |
| 9 | Load test with `k6` (5 minutes, ramp to 50 VUs) | HPA scales the api; the dashboard shows the latency/throughput curve; no `HighErrorRate` alert |

## Acceptance checks (the instructor will run these)

```bash
argocd app list                                                     # all Synced/Healthy (production may be OutOfSync by design until promoted)
argocd app get africair-staging --show-operation
kubectl -n monitoring get prometheus,alertmanager,servicemonitor,prometheusrule
kubectl -n africair-staging get servicemonitor
promtool test rules gitops/platform/alerts/tests/*.yaml             # pass
# Prometheus (port-forward 9090): every query below returns data
#   sum(rate(africair_http_requests_total[5m])) by (route)
#   histogram_quantile(0.95, sum(rate(africair_http_request_duration_seconds_bucket[5m])) by (le, route))
#   sum(increase(africair_bookings_created_total[1h])) by (cabin)
#   max(africair_db_up) by (namespace)
git grep -nE 'adminPassword|webhook_url|password:' -- gitops       # nothing secret in Git
curl -s https://<staging-host>/api/config | jq .appEnv              # "staging"
curl -s https://<prod-host>/api/config | jq .appEnv                 # "production"
```

## Knowledge check (`ANSWERS.md`)

1. Pull-based GitOps vs push-based CI deploys (Project 3): what does each give you for audit, drift, credentials and blast radius?
2. Why are secrets **not** stored in Git even with GitOps? How do ESO and Argo CD fit together?
3. Sync waves vs hooks vs Helm hooks: what runs when, and what happens to a failed `PreSync` Job?
4. `selfHeal` and `prune`: when is each dangerous? Why is production manual-sync here?
5. Why `rate()` and not `irate()` for alerts? Why must a histogram quantile aggregate with `sum by (le)`?
6. What happens to your alerts if Prometheus itself is down? How would you detect that (a dead man's switch / `Watchdog` alert)?
7. Cardinality: why is `route` a safe label but `reference` (booking reference) is not?

## Deliverables

- `gitops/**` (root app, Applications, AppProject, values, dashboards, alerts and rule tests)
- updated `deploy/helm/africair/` (ServiceMonitor, values for the metrics port, NetworkPolicy for `monitoring`)
- Terraform changes for node capacity, Argo CD bootstrap and the secret containers for Argo CD, Grafana and Alertmanager
- `docs/runbook.md` with a section per alert (meaning, first checks, mitigation), linked from `runbook_url`
- `ANSWERS.md`: screenshots of the Argo CD app tree, sync history, the Grafana dashboard under load, alerts firing and resolving, and every drill
- a 10-minute demo: a Git commit changes the live site, a manual change self-heals, an alert fires and resolves

## Grading rubric (100 pts)

| Area | Points |
|---|---|
| Argo CD install, RBAC, AppProject, secrets via ESO, self-management | 15 |
| App-of-apps layout, same chart for two environments, waves/hooks, sync policies | 20 |
| kube-prometheus-stack via GitOps, PVCs, ESO-managed credentials | 10 |
| ServiceMonitor + NetworkPolicy, targets UP | 10 |
| Grafana dashboard as code (all rows, correct PromQL) | 15 |
| Alerts as code with `promtool` tests and working routing | 15 |
| Drills 1–9 with evidence | 15 |

## Cost and cleanup ⚠️

The platform adds about 1–2 nodes and some EBS volumes on top of Project 4. Run `make destroy` from Project 4 when you finish. **Delete the Argo CD root app with cascade first**, so the controllers remove their ALBs and volumes, **then** run Terraform. Confirm that no load balancers, NAT gateways, EBS volumes or RDS instances remain.
