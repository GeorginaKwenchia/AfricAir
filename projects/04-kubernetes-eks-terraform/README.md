# Project 4 — EKS with Terraform, Helm, RDS, External Secrets & Ingress

> **Domains assessed:** Terraform (remote state, modules, IAM) · Amazon EKS (cluster design, add-ons, Pod Identity) · Amazon RDS for PostgreSQL · Helm chart authoring · Kubernetes workloads, probes, scaling, disruption, network policy · Ingress (AWS Load Balancer Controller) · External Secrets Operator with AWS Secrets Manager / SSM · secret rotation · troubleshooting
> **Suggested duration:** 2 weeks · **Team size:** 2–3 · **Builds on:** Project 2 (both images in ECR) and Project 3 (pipeline)
> **Leads into:** Project 5 (Argo CD + Prometheus/Grafana on this same cluster)

## Scenario

AfricAir moves to Kubernetes. You will:

1. build the cluster and database **exactly to the specification below**, entirely in Terraform;
2. package the app as a **Helm chart** and install it with `helm`;
3. deliver every secret from **AWS Secrets Manager** through the **External Secrets Operator (ESO)**: nothing secret in Git, Terraform state or CI logs;
4. **prove it in the browser**. AfricAir's API changes what users see based on its settings and secrets, and `/#/status` shows exactly what the pods received.

## Know the application

| Component | Image (from Project 2) | Ports | Health | Notes |
|---|---|---|---|---|
| `web` | `africair-web` (nginx, UID 101) | 8080 | `/healthz` | Static front end. In Kubernetes the **Ingress** routes `/api`, so web doesn't need to proxy. |
| `api` | `africair-api` (Node 22, non-root) | 4000 app, **9464 metrics** | liveness `/api/healthz`, readiness `/api/readyz` | Stateless; `SIGTERM` → fails readiness, waits `SHUTDOWN_DELAY_MS`, drains |
| `migrate` | `africair-api` with `node dist/migrate.js` | — | exit code | Idempotent schema migration, safe to run concurrently |

**Settings (env vars):** `APP_ENV`, `APP_VERSION`, `GIT_SHA`, `BRAND_NAME`, `ANNOUNCEMENT_TEXT`, `ANNOUNCEMENT_LEVEL`, `MAINTENANCE_MODE`, `SERVICE_FEE_USD`, `DEFAULT_LANGUAGE`, `DEFAULT_CURRENCY`, `FEATURE_*`, `SUPPORT_EMAIL`, `DB_SSL`, `DB_SSL_CA_FILE`.

**Secrets:** `DATABASE_URL` (or `PG*` variables), `ADMIN_TOKEN`, `PROMO_CODES`. Each can be supplied as `NAME=value` or `NAME_FILE=/path`. File secrets are **re-read every `SECRET_REFRESH_SECONDS`**. Full reference: `server/.env.example` and the main README.

---

## Part A — The cluster specification (build exactly this)

| Item | Specification |
|---|---|
| Region | `eu-west-1`, unless your instructor assigns another |
| Naming | `africair-<team>-staging` for the cluster; every resource tagged `Project=africair`, `Team=<team>`, `Env=staging`, `ManagedBy=terraform` |
| VPC | `10.40.0.0/16`, **3 AZs** |
| Public subnets | `10.40.0.0/24`, `10.40.1.0/24`, `10.40.2.0/24`, tagged `kubernetes.io/role/elb=1` |
| Private subnets (nodes, pods) | `10.40.16.0/20`, `10.40.32.0/20`, `10.40.48.0/20`, tagged `kubernetes.io/role/internal-elb=1` |
| Database subnets | `10.40.100.0/24`, `10.40.101.0/24`, `10.40.102.0/24` (no route to the internet) |
| NAT | **One** NAT gateway (staging cost trade-off; explain what production would need) |
| Kubernetes version | **1.33**, or the newest version in *standard* support when you start (`aws eks describe-cluster-versions`). Record your choice and why. |
| API endpoint | Public **and** private access; public access restricted to your team's IP CIDRs |
| Authentication | `authenticationMode = API` (**access entries**, no `aws-auth` ConfigMap). Your team role gets cluster admin; the Project 3 CI role gets `AmazonEKSEditPolicy` scoped to the `africair-staging` namespace. |
| Secrets encryption | Envelope encryption of Kubernetes Secrets with a **customer-managed KMS key** (rotation enabled) |
| Control-plane logs | `api`, `audit`, `authenticator` → CloudWatch, 7-day retention |
| Node group `general` | Managed node group, **Amazon Linux 2023**, `t3.large`, min **2**, desired **2**, max **4**, 30 GiB gp3, private subnets, label `workload=general` |
| Node hardening | **IMDSv2 required, hop limit 1**: pods cannot reach node credentials. Note the consequence: some controllers then need `region` and `vpcId` passed explicitly. |
| Pod networking | VPC CNI with **prefix delegation** (more pods per node) and **network policy enforcement** enabled |
| EKS managed add-ons | `vpc-cni`, `coredns`, `kube-proxy`, `eks-pod-identity-agent`, `aws-ebs-csi-driver` (Project 5 needs volumes for Prometheus), `metrics-server` |
| Storage class | `gp3` as the default StorageClass (encrypted, `WaitForFirstConsumer`) |
| Workload IAM | **EKS Pod Identity** associations (IRSA is accepted if you explain the difference): AWS Load Balancer Controller, External Secrets Operator, EBS CSI driver, backup job |
| Controllers (Helm, via Terraform `helm_release` or a documented script) | AWS Load Balancer Controller (namespace `kube-system`), External Secrets Operator (namespace `external-secrets`) |

### RDS specification

| Item | Specification |
|---|---|
| Engine | PostgreSQL **16** (latest minor), `db.t4g.micro`, 20 GiB gp3, storage encrypted |
| Placement | Database subnets, **single-AZ** (staging), `publicly_accessible = false` |
| Access | Security group allows 5432 **only** from the EKS **node/cluster security group**. No CIDR rules. |
| Credentials | `manage_master_user_password = true`: RDS stores and rotates the master secret in Secrets Manager. No password in code, variables or outputs. |
| TLS | Parameter group with `rds.force_ssl = 1` |
| Database | `africair` (initial DB name) |
| Backups | 7-day retention; staging: `deletion_protection = false`, `skip_final_snapshot = true` |
| Discovery | SSM parameters `/africair/staging/db/host`, `/africair/staging/db/port` and `/africair/staging/db/name` |

### Application secrets in Secrets Manager

Terraform creates the **secret container only** (`aws_secretsmanager_secret`, name `africair/staging/app`, encrypted with your KMS key). You write the **value** with the CLI, so it never enters Terraform state:

```bash
aws secretsmanager put-secret-value --secret-id africair/staging/app --secret-string \
  "{\"ADMIN_TOKEN\":\"$(openssl rand -hex 24)\",\"PROMO_CODES\":\"SAVE10:10,AFRICA20:20\"}"
```

---

## Part B — Terraform

```text
infra/terraform/
  bootstrap/        # S3 state bucket: versioned, encrypted, Block Public Access
  modules/
    network/        # VPC, subnets, NAT, tags
    eks/            # cluster, node group, add-ons, access entries, KMS
    database/       # RDS, subnet group, parameter group, security group, SSM parameters
    platform/       # Pod Identity roles + associations, controllers (helm_release), app secret container, backup bucket
  envs/staging/     # composes the modules; backend "s3" with use_lockfile = true
```

1. **State:** remote state in S3 with **native locking** (`use_lockfile = true`, Terraform ≥ 1.10). Demonstrate a lock conflict by running two `plan`s at once.
2. **Pinning:** pin `required_version`, providers and module versions. You may use `terraform-aws-modules/vpc` and `terraform-aws-modules/eks`, but you must be able to **explain every input** you set.
3. **Least-privilege workload IAM:**

   | Role | Allowed |
   |---|---|
   | ESO | `secretsmanager:GetSecretValue` and `DescribeSecret` on **only** the RDS master secret ARN and `africair/staging/app`; `kms:Decrypt` on your key; `ssm:GetParameter*` on `/africair/staging/db/*` |
   | Backup job | `s3:PutObject` on `arn:aws:s3:::<backup-bucket>/africair/staging/*` |
   | Load Balancer Controller | The upstream-recommended policy |
4. **Quality gates:** `terraform fmt -check`, `validate`, `tflint` and `trivy config infra/` (or `checkov`), with suppressions justified inline.
5. **Outputs:** cluster name, region, OIDC/issuer info, ECR URLs, and the RDS secret **ARN**, never its value. Commit a redacted `plan` to the PR.
6. **Verify the spec:** produce `docs/cluster-spec-evidence.md` with CLI output proving each row of the spec tables:
   - `aws eks describe-cluster` (version, endpoint access, logging, encryption, auth mode);
   - `describe-nodegroup` (AMI type, sizes, launch template metadata options);
   - `kubectl get nodes -L workload`;
   - `aws eks list-addons`;
   - `aws rds describe-db-instances`.

---

## Part C — The Helm chart

Create `deploy/helm/africair/` (`apiVersion: v2`, with `appVersion` set by CI):

| Template | Requirements |
|---|---|
| `web` Deployment + Service | 2 replicas, probes on `/healthz`, `readOnlyRootFilesystem` with `emptyDir` for `/tmp` and the nginx template output dir, `runAsNonRoot`, drop all capabilities, `seccompProfile: RuntimeDefault`, requests/limits |
| `api` Deployment + Service | 2 replicas; **startup**, **liveness** (`/api/healthz`) and **readiness** (`/api/readyz`) probes with different timings (justify them); `terminationGracePeriodSeconds` greater than `SHUTDOWN_DELAY_MS`; `topologySpreadConstraints` across AZs; ports `http` (4000) and `metrics` (9464) |
| `api` ConfigMap | All **settings** from `values.yaml` → `envFrom`. A `checksum/config` annotation on the pod template rolls the pods whenever settings change. |
| ExternalSecrets | See Part D. Templated from values, so the chart works in any environment. |
| Migration Job | `helm.sh/hook: pre-install,pre-upgrade` and the API image with `node dist/migrate.js`. Uses the DB secret; `backoffLimit: 3` (the ExternalSecret may still be syncing on the first attempt); `ttlSecondsAfterFinished`. |
| Ingress | `ingressClassName: alb`, see Part E. `/api` → `api`, `/` → `web`. |
| HPA | `autoscaling/v2` for `api` and `web`: 2–6 replicas at 60% CPU |
| PDB | `minAvailable: 1` for each |
| NetworkPolicy | Default deny. `web` and `api` accept traffic only from the ALB, i.e. the VPC CIDR (`target-type: ip`; explain why). `api` egress only to DNS, RDS (5432 on the database subnets) and HTTPS. Port 9464 is reachable only from the `monitoring` namespace (used in Project 5). |
| Backup CronJob | `02:00` UTC, `concurrencyPolicy: Forbid`: `pg_dump \| gzip`, then upload to `s3://<backup-bucket>/africair/staging/` using its Pod Identity role. Hint: an init container with `postgres:16-alpine` writes to an `emptyDir`, then an `amazon/aws-cli` container uploads it. |
| ServiceAccounts | One per workload, `automountServiceAccountToken: false` where not needed |

`values.yaml` holds safe defaults; `values-staging.yaml` holds the staging settings:

```yaml
api:
  env:
    APP_ENV: staging
    BRAND_NAME: AfricAir Staging
    ANNOUNCEMENT_TEXT: "Running on Amazon EKS — staging"
    ANNOUNCEMENT_LEVEL: info
    SERVICE_FEE_USD: "7"
    DEFAULT_CURRENCY: KES
    MAINTENANCE_MODE: "false"
    DB_SSL: require          # stretch: verify, with the RDS CA bundle mounted from a ConfigMap
```

`helm lint`, `helm template … | kubeconform -strict -summary`, and `helm install --dry-run=server` must pass. **Stretch:** add a `values.schema.json` that rejects an invalid `ANNOUNCEMENT_LEVEL`.

---

## Part D — External Secrets Operator (the core of this project)

1. **`ClusterSecretStore`s:**
   - `aws-secrets-manager`: provider `aws`, service `SecretsManager`, your region, authenticated through ESO's Pod Identity role;
   - `aws-parameter-store`: the same, for `ParameterStore`.

   Both must show `Ready=True`.
2. **`ExternalSecret` `africair-db`:** this becomes **environment variables** on the API.
   - It combines the RDS-managed secret (`username`, `password`) with the SSM parameters (`host`, `port`, `name`).
   - Use `target.template` to render **one** Secret with `DATABASE_URL`. The password must be URL-encoded; explain why.
   - `refreshInterval: 1h`.
3. **`ExternalSecret` `africair-app`:** this becomes **mounted files** on the API.
   - It reads `ADMIN_TOKEN` and `PROMO_CODES` from `africair/staging/app`, with `refreshInterval: 1m`.
   - Mount it as a **volume** at `/var/run/secrets/africair/`, and set `ADMIN_TOKEN_FILE` and `PROMO_CODES_FILE` to the mounted paths, with `SECRET_REFRESH_SECONDS: "15"`.
4. **Never print secret values in evidence.** Use `kubectl get secret africair-app -o json | jq '.data | keys'`, the fingerprints on `/#/status`, and `kubectl get externalsecret` status columns.

### Prove it in the browser

| # | Action | What must happen (screenshot each) |
|---|---|---|
| 1 | Open `https://<host>/#/status` | Environment `staging`; storage **PostgreSQL database**; database **Connected** (source env); admin token and promo codes **Configured** (source **mounted file**), with fingerprints |
| 2 | Look at the home page | Amber **STAGING** banner showing the version/commit from CI, the announcement, brand "AfricAir Staging", KES prices |
| 3 | Book with promo code `SAVE10` | Discount line in the fare and in the PDF. The booking appears at `/#/admin` (sign in with the token from Secrets Manager). Then query it directly in RDS from a throwaway `psql` pod. |
| 4 | Set `MAINTENANCE_MODE: "true"` in `values-staging.yaml`, then `helm upgrade` | Pods roll (thanks to the checksum annotation), and booking is blocked with a maintenance notice |
| 5 | **Rotate `ADMIN_TOKEN`** in Secrets Manager (`put-secret-value`) | Within about 2 minutes (ESO refresh + kubelet volume sync + app refresh) the **fingerprint changes without any pod restart**, the old token is rejected, and the new one works. Record the timeline and explain each delay. |
| 6 | **Rotate the RDS master password** (`aws secretsmanager rotate-secret --secret-id <rds-secret-arn>`) | ESO updates `africair-db` (compare `resourceVersion`), but the running pods keep the **old** env var. After the rotation the old password stops working, so new database connections fail: `/api/readyz` turns 503 and `/#/status` shows the database error. Fix it with `kubectl rollout restart`, then automate it: either Stakater **Reloader**, or a checksum annotation. Explain why env-var secrets need a restart and mounted files don't. |
| 7 | Remove ESO's permission to read `africair/staging/app` | `ExternalSecret` → `SecretSyncedError`. The **existing** Kubernetes Secret, and the app, keep working. Explain why that is good and also dangerous. Restore the permission. |

---

## Part E — Ingress with the AWS Load Balancer Controller

- `ingressClassName: alb`, with annotations:
  - `alb.ingress.kubernetes.io/scheme: internet-facing`
  - `target-type: ip`
  - `group.name: africair`
  - per-service health checks via Service annotations: `/healthz` for web, `/api/readyz` for api. Explain why readiness, not liveness, for the ALB.
- Paths: `/api` (Prefix) → `api:4000`, and `/` → `web:8080`.
- **With a domain:** an ACM certificate (DNS validation in Terraform), `listen-ports` for HTTP and HTTPS, `ssl-redirect: '443'`, and host `staging.<domain>`. **Stretch:** ExternalDNS.
- **Without a domain:** use the ALB hostname and explain what you lose (TLS, host routing).
- Set `deregistration_delay.timeout_seconds` (target-group attribute) consistently with the API's `SHUTDOWN_DELAY_MS`. Then run `hey -z 60s https://<host>/api/config` during `kubectl rollout restart deploy/api`: **zero** non-2xx responses.
- Run the full e2e suite: `BASE_URL=https://<host> pnpm test:e2e`.

---

## Troubleshooting drills (the instructor injects these; you diagnose them)

For each one, record the symptom, the commands you used (`kubectl describe/events/logs`, controller logs, `aws` CLI), the root cause and the fix.

1. `ImagePullBackOff`: a wrong tag, or the node role lacks ECR pull permissions.
2. The Ingress has **no ADDRESS**: missing IngressClass, subnet tags, or the controller can't find the VPC because of IMDS hop limit 1.
3. ALB returns **502/504**: a target-group health check path mismatch, or the NetworkPolicy blocks the ALB's source IPs.
4. `ExternalSecret` shows `SecretSyncedError`: the policy resource ARN is missing the `-xxxxxx` suffix, the KMS decrypt permission is missing, or the Pod Identity association names the wrong namespace or service account.
5. The migration hook times out: the RDS security group, `DB_SSL` vs `rds.force_ssl`, or the secret wasn't synced yet.
6. `/api/readyz` returns 503 on every pod, but `healthz` is 200: the database password was rotated (Part D #6).
7. HPA shows `<unknown>/60%`: metrics-server is missing, or there are no CPU **requests**.
8. `terraform destroy` fails with `DependencyViolation`: the ALB and its security groups were created by the controller. Fix the teardown order.

## Acceptance checks (the instructor will run these)

```bash
terraform -chdir=infra/terraform/envs/staging plan -detailed-exitcode     # 0 = no drift
aws eks describe-cluster --name africair-<team>-staging \
  --query 'cluster.{v:version,auth:accessConfig.authenticationMode,enc:encryptionConfig,logs:logging}'
kubectl get nodes -L workload -o wide                                     # private IPs, AL2023, t3.large
kubectl -n africair-staging get deploy,po,svc,ing,hpa,pdb,netpol,externalsecret,job,cronjob
kubectl get clustersecretstore                                            # Ready=True
curl -s https://<host>/api/config | jq '{appEnv, storage, secrets}'       # sources: env (db), file (admin/promo)
git grep -nE 'ADMIN_TOKEN=|PROMO_CODES=|password\s*=' -- infra deploy     # nothing
aws rds describe-db-instances --query 'DBInstances[].PubliclyAccessible'  # [false]
BASE_URL=https://<host> pnpm test:e2e                                     # all pass
aws s3 ls s3://<backup-bucket>/africair/staging/                          # at least one dump
```

## Knowledge check (`ANSWERS.md`)

1. Readiness vs liveness vs startup probes: why must liveness **not** depend on the database? What does the API's `/api/readyz` do when RDS is down?
2. Pod Identity vs IRSA: how does each deliver credentials, and how do you scope a role to one service account?
3. Why does ESO beat Terraform creating `kubernetes_secret`, or Sealed Secrets in Git? What are the trade-offs?
4. Env-var vs mounted-file secrets: list the full propagation path and delays for each (Secrets Manager → ESO → Secret → kubelet → app).
5. What does IMDSv2 hop limit 1 protect against, and what did it break?
6. `target-type: ip` vs `instance`: what changes in the network path, the security groups and the NetworkPolicy?
7. Why can't Terraform cleanly destroy resources that in-cluster controllers create, and how do you design around it?
8. Estimate this environment's daily cost and name the three biggest items.

## Deliverables

- `infra/terraform/**`, `deploy/helm/africair/**`, `docs/cluster-spec-evidence.md`
- a `Makefile` with `tf-plan`, `tf-apply`, `helm-install` and **`destroy`**. `destroy` must delete Ingresses first, wait until no ALBs remain, then run `terraform destroy`.
- `docs/runbook.md`: deploy, roll back (`helm rollback`), rotate each secret, restore a backup, scale, and the troubleshooting drills
- `ANSWERS.md` with screenshots for every row of "Prove it in the browser"
- an architecture diagram (VPC/subnets, ALB, EKS, RDS, Secrets Manager → ESO → pods, S3)

## Grading rubric (100 pts)

| Area | Points |
|---|---|
| Cluster and RDS built **to spec**, with evidence | 20 |
| Terraform quality: state/locking, pinning, modules, linting, no secrets in state | 15 |
| Helm chart: probes, security context, checksum rollouts, hooks, HPA/PDB/NetworkPolicy | 15 |
| ESO: stores, templated DB secret, file-mounted app secret, all 7 browser proofs | 25 |
| Ingress/ALB: health checks, zero-downtime rollout, TLS if domain, e2e green | 10 |
| Backup CronJob, troubleshooting drills, runbook, clean teardown | 15 |

## Cost and cleanup ⚠️

EKS control plane, NAT gateway, 2 × `t3.large`, RDS and an ALB typically cost **several US dollars per day** (check the AWS Pricing Calculator). Create an **AWS Budget** alert first. **Keep the cluster if you go straight on to Project 5**; otherwise run `make destroy` at the end of every session and confirm that `aws elbv2 describe-load-balancers`, `aws ec2 describe-nat-gateways` and `aws rds describe-db-instances` are empty.
