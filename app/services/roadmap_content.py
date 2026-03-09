"""Deterministic, skill-specific roadmap content library.

Provides:
- skill_tasks(skill, role, mastery_level)  → 7-day learning plan
- skill_project(skill, role, difficulty, idx, mastery_level)  → RoadmapProject-like dict
- skill_resources(skill, difficulty)  → list of direct resource dicts

All content is non-generic: each skill gets tailored tasks, unique project
titles/descriptions, 4-level hints, and exact documentation/tutorial URLs
rather than generic platform homepages.

Adding a new skill: add an entry to SKILL_DB below.
"""

from __future__ import annotations

import hashlib
import random as _random


# ─────────────────────────────────────────────────────────────────────────────
# SKILL DATABASE
# Each entry: tasks_by_level, projects (pool), resources_by_level
# mastery 0-1 → beginner, 2-3 → intermediate, 4 → advanced
# ─────────────────────────────────────────────────────────────────────────────

SKILL_DB: dict[str, dict] = {
    "terraform": {
        "tasks": {
            "beginner": [
                "Day 1: What is Infrastructure as Code? Read the Terraform intro at developer.hashicorp.com/terraform/intro",
                "Day 2: Install Terraform locally; run `terraform version` and `terraform init` on an empty dir",
                "Day 3: Write your first .tf file — provision a local null_resource with a provisioner",
                "Day 4: Learn about state files (terraform.tfstate) and what they track",
                "Day 5: Use `terraform plan` and `terraform apply` on a real cloud resource (e.g. AWS S3 bucket)",
                "Day 6: Add variables.tf and outputs.tf to your configuration; refactor hardcoded values",
                "Day 7: Review Terraform best practices: .gitignore state files, use remote state",
            ],
            "intermediate": [
                "Day 1: Study Terraform modules — create a reusable VPC module with input/output variables",
                "Day 2: Set up remote state using an S3 backend with DynamoDB locking",
                "Day 3: Implement workspaces (`terraform workspace new staging`) to manage environments",
                "Day 4: Use `count` and `for_each` to manage multiple similar resources dynamically",
                "Day 5: Write data sources to import existing cloud resources into state",
                "Day 6: Add lifecycle rules (`create_before_destroy`, `prevent_destroy`) to critical resources",
                "Day 7: Run `terraform validate` and `tflint`; fix all warnings before applying",
            ],
            "advanced": [
                "Day 1: Design a multi-environment Terraform monorepo with shared modules and per-env root configs",
                "Day 2: Implement a CI/CD pipeline that runs `terraform plan` on PRs and `apply` on merge",
                "Day 3: Use Terratest (Go) to write infrastructure unit tests for your modules",
                "Day 4: Implement policy-as-code with Sentinel or OPA to enforce tagging standards",
                "Day 5: Migrate an existing manually-created resource into Terraform state via `terraform import`",
                "Day 6: Benchmark and optimise apply times using `-parallelism` and module splitting",
                "Day 7: Document your module with `terraform-docs`; publish to the Terraform Registry",
            ],
        },
        "projects": [
            {
                "title": "Three-Tier Infrastructure Deployment",
                "description": "Provision a VPC with public/private subnets, an EC2 web tier, RDS database tier, and an S3 assets bucket — all via Terraform modules.",
                "objectives": [
                    "Create a reusable VPC module with configurable CIDR ranges",
                    "Deploy an EC2 instance behind an Application Load Balancer",
                    "Provision an RDS MySQL instance in a private subnet",
                    "Manage all credentials via AWS Secrets Manager (no hardcoded secrets)",
                ],
                "deliverables": [
                    "GitHub repo with modules/ directory containing vpc, ec2, and rds submodules",
                    "README with architecture diagram and `terraform apply` instructions",
                    "Screenshot/log of successful `terraform plan` and `apply` output",
                ],
                "evaluation_criteria": [
                    "Modules are reusable with documented input/output variables",
                    "Remote state backend is configured (S3 + DynamoDB lock)",
                    "No secrets or .tfstate files are committed to the repo",
                    "Resources are tagged consistently",
                ],
                "hints": {
                    "level_1": "Start with the VPC module: define a variable for `cidr_block` and output `vpc_id` and `subnet_ids`. Every other module will consume these outputs.",
                    "level_2": "Use `terraform.tfvars` for environment-specific values (region, instance_type). Pass module outputs to other modules using `module.<name>.<output>` syntax.",
                    "level_3": "Structure: root `main.tf` calls three modules. Each module has its own `variables.tf`, `main.tf`, `outputs.tf`. Use a `locals {}` block in root for shared tags.",
                    "level_4": "Common pitfalls: (1) circular module deps — avoid by passing data up via outputs. (2) RDS in public subnet by accident — check `publicly_accessible = false`. (3) ALB not routing — check security group ingress on port 80/443.",
                },
                "archetype": "cloud_infrastructure",
                "estimated_hours": 10,
            },
            {
                "title": "Auto-Scaling Kubernetes Cluster on EKS",
                "description": "Use Terraform to provision an EKS cluster with managed node groups that auto-scale, plus an ALB Ingress Controller via Helm provider.",
                "objectives": [
                    "Provision an EKS cluster using the community terraform-aws-eks module",
                    "Configure cluster autoscaler with min/max node counts",
                    "Deploy the AWS Load Balancer Controller via the Terraform Helm provider",
                    "Add IRSA (IAM Roles for Service Accounts) for pod-level permissions",
                ],
                "deliverables": [
                    "Terraform configuration that provisions a working EKS cluster",
                    "README with cost estimate and teardown instructions",
                    "Proof of autoscaling: screenshot showing node count before/after a load test",
                ],
                "evaluation_criteria": [
                    "Cluster is accessible via `kubectl` after `terraform apply`",
                    "IRSA is used instead of node instance profiles for pod permissions",
                    "Auto-scaling policy is documented and verified",
                    "Module versions are pinned",
                ],
                "hints": {
                    "level_1": "IRSA works by annotating the Kubernetes service account with an IAM role ARN. Think through what permissions the LB controller needs vs. what your app pods need.",
                    "level_2": "Use the `terraform-aws-eks` community module (avoid writing EKS config from scratch). Pin the module version and review the `node_groups` input.",
                    "level_3": "Structure: `eks.tf` calls the module; `iam.tf` defines IRSA roles; `helm.tf` uses the `kubernetes` and `helm` providers after the cluster is ready (add `depends_on`).",
                    "level_4": "Debugging: (1) Helm provider auth errors → make sure `exec` auth is used for EKS (`aws eks get-token`). (2) Nodes not joining → check IAM node role policies. (3) LB not provisioning → verify ALB controller service account annotation.",
                },
                "archetype": "kubernetes_platform",
                "estimated_hours": 14,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "Terraform: Get Started with AWS", "url": "https://developer.hashicorp.com/terraform/tutorials/aws-get-started", "description": "Official step-by-step AWS tutorial series — installs Terraform and provisions real resources.", "time_to_consume": "60–90m"},
                {"type": "documentation", "title": "Terraform Configuration Language", "url": "https://developer.hashicorp.com/terraform/language", "description": "Reference for HCL syntax, resource blocks, variables, and expressions.", "time_to_consume": "30–45m"},
                {"type": "article", "title": "Terraform Registry — AWS Provider", "url": "https://registry.terraform.io/providers/hashicorp/aws/latest/docs", "description": "Every AWS resource type with full argument/attribute docs.", "time_to_consume": "Reference"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Terraform Modules Guide", "url": "https://developer.hashicorp.com/terraform/language/modules/develop", "description": "How to create, compose, and version reusable Terraform modules.", "time_to_consume": "30m"},
                {"type": "documentation", "title": "Terraform Remote State & S3 Backend", "url": "https://developer.hashicorp.com/terraform/language/backend/s3", "description": "Configure remote state with S3 and DynamoDB state locking.", "time_to_consume": "20m"},
                {"type": "article", "title": "Terraform Best Practices", "url": "https://developer.hashicorp.com/terraform/cloud-docs/recommended-practices", "description": "HashiCorp's official recommendations for module structure and team workflows.", "time_to_consume": "30m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "Terratest — Infrastructure Testing", "url": "https://terratest.gruntwork.io/docs/", "description": "Write automated tests for your Terraform modules in Go.", "time_to_consume": "45–60m"},
                {"type": "documentation", "title": "Terraform CDK (CDKTF)", "url": "https://developer.hashicorp.com/terraform/cdktf", "description": "Define Terraform infrastructure using familiar programming languages.", "time_to_consume": "45m"},
                {"type": "article", "title": "Sentinel Policy-as-Code", "url": "https://developer.hashicorp.com/sentinel/docs", "description": "Enforce compliance rules on Terraform plans before they apply.", "time_to_consume": "30m"},
            ],
        },
    },

    "aws": {
        "tasks": {
            "beginner": [
                "Day 1: Create a free-tier AWS account; explore IAM — create a non-root user with programmatic access",
                "Day 2: Learn S3 fundamentals — create a bucket, upload files, set a bucket policy",
                "Day 3: Launch your first EC2 instance (t2.micro); SSH in and run a web server",
                "Day 4: Study VPCs — understand subnets, route tables, Internet Gateways, and security groups",
                "Day 5: Set up an RDS instance in a private subnet; connect from EC2 via the same VPC",
                "Day 6: Create a Lambda function triggered by an S3 event; test the full flow",
                "Day 7: Read the AWS Well-Architected Framework pillars summary",
            ],
            "intermediate": [
                "Day 1: Design a multi-AZ architecture diagram for a web app with ALB + Auto Scaling + RDS Multi-AZ",
                "Day 2: Implement CloudFront in front of an S3 static site with custom error pages",
                "Day 3: Set up CloudWatch Alarms + SNS notifications for EC2 CPU utilisation",
                "Day 4: Build a serverless API: API Gateway → Lambda → DynamoDB with proper IAM roles",
                "Day 5: Implement IAM least-privilege policies using Policy Simulator to test permissions",
                "Day 6: Use SQS + Lambda to build a simple event-driven processing pipeline",
                "Day 7: Run AWS Trusted Advisor and Security Hub checks; remediate top findings",
            ],
            "advanced": [
                "Day 1: Architect and document a production-grade AWS Landing Zone with Control Tower concepts",
                "Day 2: Implement AWS Organizations with Service Control Policies to enforce guardrails",
                "Day 3: Build a multi-region active-active architecture with Route 53 health checks + latency routing",
                "Day 4: Set up AWS WAF + Shield and test against common OWASP rules",
                "Day 5: Implement a full observability stack: X-Ray + CloudWatch Insights + Dashboards",
                "Day 6: Design and document a disaster recovery runbook with RTO/RPO targets",
                "Day 7: Cost-optimise a sample architecture: Reserved Instances, Savings Plans, right-sizing",
            ],
        },
        "projects": [
            {
                "title": "Serverless Image Processing Pipeline",
                "description": "Build a fully serverless pipeline that accepts image uploads via a pre-signed S3 URL, processes them (resize + extract metadata) with Lambda, stores results in DynamoDB, and serves a status API via API Gateway.",
                "objectives": [
                    "Generate pre-signed S3 upload URLs from a Lambda-backed API endpoint",
                    "Trigger a processing Lambda on s3:ObjectCreated events",
                    "Store image metadata (dimensions, size, ETag) in DynamoDB with a TTL field",
                    "Expose a GET /status/{id} endpoint that returns processing status",
                ],
                "deliverables": [
                    "SAM template or Terraform config deploying all resources",
                    "README with curl examples for upload and status check",
                    "CloudWatch Logs screenshot showing a successful end-to-end run",
                ],
                "evaluation_criteria": [
                    "IAM roles follow least-privilege (Lambda has only the needed S3/DynamoDB permissions)",
                    "Error handling covers S3 trigger failures and DynamoDB write errors",
                    "API returns 200 with metadata within 5 seconds of upload completion",
                    "No credentials are hardcoded; environment variables or Parameter Store used",
                ],
                "hints": {
                    "level_1": "Think about the event chain: browser → API Gateway (pre-sign) → S3 upload → S3 event → Lambda processor → DynamoDB. Map each arrow to a specific AWS service interaction.",
                    "level_2": "For the pre-signed URL, use `boto3.client('s3').generate_presigned_url('put_object', ...)`. The upload Lambda needs `s3:GetObject` to read the file after the trigger fires.",
                    "level_3": "Architecture: two Lambda functions (signer + processor), one S3 bucket, one DynamoDB table (PK: image_id), one API Gateway HTTP API. The signer returns `{upload_url, image_id}` so the client can poll status.",
                    "level_4": "Debugging: (1) Lambda not triggered → check S3 event notification config and that the bucket/Lambda are in the same region. (2) DynamoDB write errors → verify Lambda execution role has `dynamodb:PutItem`. (3) API 500 → enable Lambda function URL logging or API Gateway access logs.",
                },
                "archetype": "serverless_pipeline",
                "estimated_hours": 12,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "AWS Getting Started Resource Center", "url": "https://aws.amazon.com/getting-started/", "description": "Official tutorials for EC2, S3, Lambda, and RDS with free-tier usage.", "time_to_consume": "60m"},
                {"type": "course_module", "title": "AWS Cloud Practitioner Essentials", "url": "https://explore.skillbuilder.aws/learn/courses/134", "description": "Free foundational AWS course on AWS Skill Builder.", "time_to_consume": "6h (split over week)"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "AWS Well-Architected Framework", "url": "https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html", "description": "The five pillars every AWS architect must know.", "time_to_consume": "45–90m"},
                {"type": "article", "title": "AWS Workshops — Serverless", "url": "https://workshops.aws/categories/Serverless", "description": "Hands-on labs for Lambda, API Gateway, Step Functions.", "time_to_consume": "120m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "AWS Solutions Library", "url": "https://aws.amazon.com/solutions/", "description": "Reference architectures with CloudFormation templates for common patterns.", "time_to_consume": "Reference"},
                {"type": "article", "title": "AWS re:Post — Architecture", "url": "https://repost.aws/tags/TApLMGNcvuRUqAK0O-Sv-kKw/architecture", "description": "Community discussions and answers on real-world AWS architecture challenges.", "time_to_consume": "30m browsing"},
            ],
        },
    },

    "azure": {
        "tasks": {
            "beginner": [
                "Day 1: Create a free Azure account; navigate the portal; create a Resource Group",
                "Day 2: Deploy an Azure App Service for a simple static HTML site using the portal",
                "Day 3: Create an Azure Storage Account; upload a blob and access it via URL",
                "Day 4: Provision a Virtual Machine; enable Just-In-Time (JIT) SSH access",
                "Day 5: Create an Azure SQL Database; connect via Azure Data Studio",
                "Day 6: Create an Azure Function (HTTP trigger) and test it in the portal",
                "Day 7: Read the Microsoft Azure Well-Architected Framework overview",
            ],
            "intermediate": [
                "Day 1: Build and deploy a containerized app to Azure Container Apps (not AKS yet)",
                "Day 2: Set up Azure DevOps Pipelines: CI that builds a Docker image + pushes to ACR",
                "Day 3: Configure Azure Monitor + Application Insights for a running app",
                "Day 4: Implement RBAC on a Resource Group — assign Reader/Contributor roles correctly",
                "Day 5: Use Azure Key Vault for secrets; access from an app via Managed Identity (no SDK credentials)",
                "Day 6: Set up Azure Front Door in front of two regional backends for latency-based routing",
                "Day 7: Conduct an Azure Security Center review; address Medium findings",
            ],
            "advanced": [
                "Day 1: Design a Landing Zone with Management Groups, Subscriptions, and Policy Assignments",
                "Day 2: Implement Azure Policy and Blueprints to enforce tag requirements and allowed regions",
                "Day 3: Build a hub-and-spoke network topology with Azure Virtual WAN",
                "Day 4: Implement a full AKS cluster with Azure CNI, AGIC ingress, and Workload Identity",
                "Day 5: Set up Private Endpoints for all PaaS services; verify no public endpoint access",
                "Day 6: Implement Defender for Cloud and set up a custom workbook for security posture",
                "Day 7: Design a multi-region DR strategy using Azure Site Recovery + Traffic Manager",
            ],
        },
        "projects": [
            {
                "title": "Event-Driven Microservices on Azure Container Apps",
                "description": "Deploy two microservices (order-service and notification-service) that communicate via Azure Service Bus. Both run on Azure Container Apps with autoscaling triggered by queue depth.",
                "objectives": [
                    "Containerize two services and push images to Azure Container Registry",
                    "Deploy both to Azure Container Apps with Dapr sidecar enabled",
                    "Configure KEDA scaling rules based on Service Bus queue length",
                    "Use Managed Identity so no connection strings are stored in code",
                ],
                "deliverables": [
                    "GitHub repo with Dockerfiles, Bicep/Terraform templates, and GitHub Actions CI",
                    "README with architecture diagram and deploy instructions",
                    "Screenshot showing scale-out triggered by sending 20 messages to the queue",
                ],
                "evaluation_criteria": [
                    "No connection strings or secrets in code or env vars (Managed Identity used throughout)",
                    "KEDA scaling is verified and documented",
                    "CI pipeline builds and pushes images successfully on git push",
                    "Bicep/Terraform deploys idempotently (re-apply produces no changes)",
                ],
                "hints": {
                    "level_1": "Think about the event flow: order-service publishes a message to Service Bus → notification-service picks it up, processes it. Dapr abstracts the Service Bus SDK away from your code.",
                    "level_2": "Use `az containerapp create` or Bicep `Microsoft.App/containerApps`. Set the `scale.rules` property to a `azure-servicebus` KEDA rule with `queueLength: 5`.",
                    "level_3": "Structure: ACR (images), Service Bus namespace + queue, two Container Apps (each with Dapr enabled), a User-Assigned Managed Identity with `Azure Service Bus Data Owner` role, a Container Apps Environment.",
                    "level_4": "Debugging: (1) Dapr sidecar not connecting → verify `dapr.io/app-port` annotation matches your app's listening port. (2) Managed Identity not working → check the role assignment is on the namespace, not just the queue. (3) KEDA not scaling → confirm the trigger secret is the connection string and queueLength integer is correct.",
                },
                "archetype": "event_driven_microservices",
                "estimated_hours": 14,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "course_module", "title": "Microsoft Learn — Azure Fundamentals (AZ-900)", "url": "https://learn.microsoft.com/en-us/training/paths/azure-fundamentals-describe-azure-architecture-services/", "description": "Free learning path: core services, pricing, compliance.", "time_to_consume": "5–8h total"},
                {"type": "documentation", "title": "Azure Portal Quickstarts", "url": "https://learn.microsoft.com/en-us/azure/guides/developer/azure-developer-guide", "description": "Developer onboarding guide with service quickstarts.", "time_to_consume": "45m"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Azure Architecture Center", "url": "https://learn.microsoft.com/en-us/azure/architecture/", "description": "Reference architectures and design patterns for production workloads.", "time_to_consume": "Reference"},
                {"type": "course_module", "title": "Microsoft Learn — AZ-204 Developer", "url": "https://learn.microsoft.com/en-us/training/paths/create-serverless-applications/", "description": "Functions, Service Bus, Key Vault, and App Service — hands on.", "time_to_consume": "3–5h"},
            ],
            "advanced": [
                {"type": "documentation", "title": "Azure Landing Zone Accelerator", "url": "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/", "description": "Enterprise landing zone architecture and Bicep templates.", "time_to_consume": "90m"},
                {"type": "documentation", "title": "Microsoft Defender for Cloud — Hardening", "url": "https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-cloud-introduction", "description": "Security posture management and threat protection guide.", "time_to_consume": "30m"},
            ],
        },
    },

    "docker": {
        "tasks": {
            "beginner": [
                "Day 1: Install Docker Desktop; run `docker run hello-world` and `docker run -it ubuntu bash`",
                "Day 2: Write a Dockerfile for a Python Flask app; build and run it locally",
                "Day 3: Understand layers — run `docker history <image>` to see how layers are stacked",
                "Day 4: Use Docker Compose to run a web app + PostgreSQL in a single `docker compose up`",
                "Day 5: Learn `docker exec`, `docker logs`, and `docker inspect` for debugging running containers",
                "Day 6: Study multi-stage builds — reduce an image from 1GB to under 100MB",
                "Day 7: Push your image to Docker Hub; pull it on a different machine (or Cloud Shell)",
            ],
            "intermediate": [
                "Day 1: Study Docker networking modes (bridge, host, overlay); test with `docker network create`",
                "Day 2: Implement health checks in your Dockerfile and in Docker Compose",
                "Day 3: Set up a local Docker registry; push and pull private images",
                "Day 4: Write a multi-service Docker Compose with depends_on, environment files, and named volumes",
                "Day 5: Profile container resource usage with `docker stats`; set CPU and memory limits",
                "Day 6: Sign images with Docker Content Trust (`DOCKER_CONTENT_TRUST=1`) and verify",
                "Day 7: Scan your image for CVEs with `docker scout cves <image>` or Trivy",
            ],
            "advanced": [
                "Day 1: Implement a complete CI pipeline: GitHub Actions → build image → scan → push to GHCR",
                "Day 2: Study rootless containers and Docker's seccomp/AppArmor profiles for hardening",
                "Day 3: Use BuildKit advanced features: `--secret`, `--ssh`, and inline cache",
                "Day 4: Write a distroless multi-stage Dockerfile (no shell in final image)",
                "Day 5: Set up a private Harbor registry with vulnerability scanning enabled",
                "Day 6: Implement automated image promotion: dev → staging → prod with tag strategy",
                "Day 7: Conduct a Docker security audit using CIS Docker Benchmark checklist",
            ],
        },
        "projects": [
            {
                "title": "Production-Ready Multi-Service Docker Stack",
                "description": "Containerize a full-stack application (React frontend, FastAPI backend, PostgreSQL, Redis cache) with a Docker Compose setup that passes health checks, uses secrets properly, and has a minimal final image size.",
                "objectives": [
                    "Write multi-stage Dockerfiles for both frontend and backend",
                    "Implement health checks so dependent services wait correctly",
                    "Use Docker secrets or `.env` files (not hardcoded) for credentials",
                    "Achieve a final backend image under 150MB using Alpine or distroless",
                ],
                "deliverables": [
                    "GitHub repo with all Dockerfiles and docker-compose.yml",
                    "README with `docker compose up --build` instructions and expected output",
                    "`docker images` screenshot showing image sizes before and after optimisation",
                ],
                "evaluation_criteria": [
                    "Multi-stage builds are used (separate builder and runtime stages)",
                    "All containers have health checks and restart policies",
                    "No runtime secrets in Dockerfiles or image layers",
                    "Services come up in correct dependency order on cold start",
                ],
                "hints": {
                    "level_1": "Think about what each image needs at runtime vs. build time. Your Python backend only needs the compiled app and its runtime deps — not `gcc` or build tools.",
                    "level_2": "Multi-stage: `FROM python:3.12 AS builder` installs deps into a virtualenv; `FROM python:3.12-slim` copies only the venv. Use `COPY --from=builder /venv /venv`.",
                    "level_3": "Compose structure: `db` (postgres:16-alpine with `POSTGRES_PASSWORD` from `.env`), `cache` (redis:7-alpine), `api` (your image, depends_on db+cache with condition: service_healthy), `web` (nginx serving React build, depends_on api).",
                    "level_4": "Debugging: (1) `depends_on` not working → use `condition: service_healthy` not just `service_started`. (2) App can't reach DB by hostname → both must be on the same named Docker network. (3) File permission errors → your app user inside the container may differ from the mounted volume owner.",
                },
                "archetype": "fullstack_containerization",
                "estimated_hours": 10,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "Docker Get Started (Official)", "url": "https://docs.docker.com/get-started/", "description": "Part 1-10 of the official tutorial: build, run, compose, and push.", "time_to_consume": "90m"},
                {"type": "documentation", "title": "Dockerfile Best Practices", "url": "https://docs.docker.com/build/building/best-practices/", "description": "Official guide to writing efficient, secure Dockerfiles.", "time_to_consume": "30m"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Docker Compose Getting Started", "url": "https://docs.docker.com/compose/gettingstarted/", "description": "Multi-service local development with Compose v2.", "time_to_consume": "45m"},
                {"type": "documentation", "title": "Docker BuildKit — Advanced Features", "url": "https://docs.docker.com/build/buildkit/", "description": "Secrets, SSH forwarding, inline cache — used in production pipelines.", "time_to_consume": "30m"},
            ],
            "advanced": [
                {"type": "article", "title": "Docker Security Best Practices", "url": "https://docs.docker.com/build/building/secrets/", "description": "How to handle secrets in Dockerfiles without leaking them in layers.", "time_to_consume": "20m"},
                {"type": "article", "title": "Distroless Container Images (Google)", "url": "https://github.com/GoogleContainerTools/distroless", "description": "Minimal runtime images with no shell — harder to exploit if breached.", "time_to_consume": "20m"},
            ],
        },
    },

    "kubernetes": {
        "tasks": {
            "beginner": [
                "Day 1: Install `kubectl` and set up a local cluster with Minikube or kind (`kind create cluster`)",
                "Day 2: Deploy your first Pod and Service; expose it with `kubectl port-forward`",
                "Day 3: Learn the core objects: Pod, ReplicaSet, Deployment, Service (ClusterIP + NodePort)",
                "Day 4: Write a Deployment YAML; perform a rolling update and then rollback with `kubectl rollout`",
                "Day 5: Create a ConfigMap and Secret; mount them into a Pod as env vars and volume files",
                "Day 6: Set resource requests and limits on a Deployment; observe eviction with LimitRange",
                "Day 7: Study the Kubernetes object model: spec.selector must match spec.template.labels",
            ],
            "intermediate": [
                "Day 1: Set up a local Ingress controller (nginx); route two services behind path-based rules",
                "Day 2: Write a HorizontalPodAutoscaler; simulate load with `kubectl run --generator=run-pod/v1`",
                "Day 3: Implement RBAC: create a ServiceAccount, Role, and RoleBinding that follows least-privilege",
                "Day 4: Use PersistentVolumes and PersistentVolumeClaims with a StatefulSet for a database",
                "Day 5: Study Kubernetes networking: Pod CIDR, Service CIDR, kube-proxy iptables rules",
                "Day 6: Deploy a multi-namespace application; use NetworkPolicies to block cross-namespace traffic",
                "Day 7: Run `kube-bench` (CIS benchmark) against your cluster; document findings",
            ],
            "advanced": [
                "Day 1: Write a custom Kubernetes controller using controller-runtime (Operator SDK or Kubebuilder)",
                "Day 2: Implement GitOps: FluxCD or ArgoCD syncing a Git repo to namespaces automatically",
                "Day 3: Set up OPA Gatekeeper with a policy that rejects Pods without resource limits",
                "Day 4: Implement multi-tenancy with virtual clusters (vcluster) or namespace isolation",
                "Day 5: Profile etcd performance; understand raft consensus and when etcd becomes a bottleneck",
                "Day 6: Implement cluster autoscaler + Karpenter; observe node provisioning during scale events",
                "Day 7: Design and document a zero-downtime upgrade strategy for a production cluster",
            ],
        },
        "projects": [
            {
                "title": "GitOps-Driven Microservice Deployment on Kubernetes",
                "description": "Deploy a two-service application (API + worker) to a local Kubernetes cluster using Helm charts, with ArgoCD or FluxCD syncing deployments from a Git repository.",
                "objectives": [
                    "Write Helm charts for both services with configurable replicas, images, and resource limits",
                    "Set up ArgoCD or FluxCD to auto-sync the charts from a Git repo",
                    "Add a NetworkPolicy that blocks direct internet access to the worker service",
                    "Implement HPA for the API service based on CPU utilisation",
                ],
                "deliverables": [
                    "GitHub repo with `charts/` directory and an ArgoCD/Flux application manifest",
                    "README with `kubectl apply -f` instructions to bootstrap the GitOps tool",
                    "Screenshot of ArgoCD/Flux dashboard showing both apps in Synced/Healthy state",
                ],
                "evaluation_criteria": [
                    "Changing a value in Git causes the cluster to update without manual `kubectl` commands",
                    "NetworkPolicy is effective — curl from worker to the internet returns connection refused",
                    "HPA shows scale-out when CPU > 70% (verify with a `kubectl run` load generator)",
                    "Both services have liveness and readiness probes",
                ],
                "hints": {
                    "level_1": "GitOps: the Git repo is the source of truth. ArgoCD polls the repo; when it detects drift between Git state and cluster state, it reconciles. Think about what 'desired state' means for your two services.",
                    "level_2": "Use `helm create api-chart` and `helm create worker-chart` to scaffold. Override `image.repository` and `image.tag` in `values.yaml`. ArgoCD points to your repo path and namespace.",
                    "level_3": "ArgoCD Application CRD: `spec.source.repoURL`, `spec.source.path`, `spec.destination.namespace`. GitOps repo structure: `apps/api/` and `apps/worker/`, each with a Helm chart. Add a NetworkPolicy in `worker/templates/netpol.yaml`.",
                    "level_4": "Debugging: (1) ArgoCD stuck in Progressing → check Deployment events with `kubectl describe deployment`. (2) HPA not scaling → metrics-server must be installed. (3) NetworkPolicy not blocking → your CNI must support NetworkPolicy (Calico/Cilium, not Flannel alone).",
                },
                "archetype": "gitops_kubernetes",
                "estimated_hours": 14,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "Kubernetes Basics Tutorial", "url": "https://kubernetes.io/docs/tutorials/kubernetes-basics/", "description": "Interactive tutorial: deploy, scale, update, and inspect your first apps.", "time_to_consume": "60m"},
                {"type": "documentation", "title": "Kubernetes Documentation — Concepts", "url": "https://kubernetes.io/docs/concepts/", "description": "Authoritative explanations of every Kubernetes object.", "time_to_consume": "Reference"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Kubernetes — RBAC Authorization", "url": "https://kubernetes.io/docs/reference/access-authn-authz/rbac/", "description": "How to write Roles, ClusterRoles, RoleBindings, and service accounts properly.", "time_to_consume": "30m"},
                {"type": "article", "title": "Kubernetes Networking Explained (Flannel, Calico, Cilium)", "url": "https://kubernetes.io/docs/concepts/cluster-administration/networking/", "description": "CNI model and how pods communicate across nodes.", "time_to_consume": "30m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "Kubebuilder Book", "url": "https://book.kubebuilder.io/", "description": "Write Kubernetes controllers and custom resources from scratch.", "time_to_consume": "3–5h"},
                {"type": "documentation", "title": "ArgoCD Getting Started", "url": "https://argo-cd.readthedocs.io/en/stable/getting_started/", "description": "Install ArgoCD and deploy your first GitOps-managed app.", "time_to_consume": "45m"},
            ],
        },
    },

    "ci/cd": {
        "tasks": {
            "beginner": [
                "Day 1: Read the CI/CD concepts overview at docs.github.com/en/actions/about-github-actions/understanding-github-actions",
                "Day 2: Create your first GitHub Actions workflow: `.github/workflows/ci.yml` that runs `pytest` on push",
                "Day 3: Add a lint step (flake8 or eslint) and a Docker build step to your workflow",
                "Day 4: Learn workflow triggers: `on: push`, `on: pull_request`, `on: schedule`",
                "Day 5: Use workflow secrets (`${{ secrets.MY_KEY }}`) to pass credentials safely",
                "Day 6: Deploy to a staging environment automatically on merge to `main`",
                "Day 7: Read about trunk-based development and why long-lived branches break CI",
            ],
            "intermediate": [
                "Day 1: Implement matrix builds to test against Python 3.10, 3.11, 3.12 in parallel",
                "Day 2: Cache dependencies (`actions/cache`) to speed up repeated workflow runs",
                "Day 3: Set up reusable workflows with `workflow_call` and composite actions",
                "Day 4: Implement environment gates: require manual approval before prod deploy",
                "Day 5: Add SAST scanning with CodeQL (`github/codeql-action`) to the pipeline",
                "Day 6: Implement Docker image vulnerability scanning with Trivy before push",
                "Day 7: Measure and optimise pipeline duration — identify the slowest step and cut it",
            ],
            "advanced": [
                "Day 1: Build a custom GitHub Actions action (JavaScript action that wraps a CLI tool)",
                "Day 2: Set up self-hosted runners on Kubernetes with `actions-runner-controller`",
                "Day 3: Implement canary deployments: route 10% of traffic to new version; auto-promote on metrics",
                "Day 4: Design a release train process with automated changelog and SemVer tagging",
                "Day 5: Add DORA metrics tracking (deployment frequency, lead time) to your pipeline",
                "Day 6: Implement supply-chain security: SBOM generation, Sigstore/Cosign image signing",
                "Day 7: Audit your pipeline for secret sprawl and reduce the blast radius of a compromised token",
            ],
        },
        "projects": [
            {
                "title": "Zero-Downtime Deployment Pipeline with Quality Gates",
                "description": "Build a GitHub Actions pipeline for a web app that runs tests + SAST, builds and scans the Docker image, deploys to staging, runs smoke tests, and deploys to production only if all gates pass.",
                "objectives": [
                    "Implement test → lint → build → scan → deploy-staging → smoke-test → deploy-prod stages",
                    "Add a manual approval gate (GitHub Environment protection rule) before prod deploy",
                    "Use Trivy image scanning; fail the pipeline if CRITICAL CVEs are found",
                    "Implement rollback: if the smoke test fails, automatically redeploy the previous image tag",
                ],
                "deliverables": [
                    "GitHub repo with `.github/workflows/deploy.yml` implementing all stages",
                    "GitHub Actions run screenshot showing all stages green",
                    "README explaining the deployment strategy and rollback procedure",
                ],
                "evaluation_criteria": [
                    "Pipeline fails if any test fails — no silently-passing broken builds",
                    "Image tag is pinned (not `:latest`) in the deploy step",
                    "Secrets are injected via GitHub Secrets — no plaintext in YAML",
                    "The rollback step is tested and documented",
                ],
                "hints": {
                    "level_1": "Think of the pipeline as a set of gates: code quality → image quality → environment quality. Each gate must explicitly fail before the next runs. What does 'fail' look like at each gate?",
                    "level_2": "Use `needs: [test, scan]` to make the staging deploy depend on both previous jobs. Use `if: github.ref == 'refs/heads/main'` to restrict production jobs to the main branch.",
                    "level_3": "Workflow structure: job `test` (pytest + flake8), job `build` (docker build + `actions/upload-artifact` for image digest), job `scan` (trivy action with `exit-code: '1'` for CRITICAL), job `deploy-staging`, job `smoke-test`, job `deploy-prod` (environment: production, needs manual approval).",
                    "level_4": "Debugging: (1) Trivy fails with no CVEs but still exits 1 → check `severity` and `ignore-unfixed` settings. (2) Manual approval not showing → environment must be created in repo Settings > Environments with required reviewers. (3) Rollback step fails → the previous image tag must be stored as an output of the prior deploy job and passed via `needs.<job>.outputs`.",
                },
                "archetype": "deployment_pipeline",
                "estimated_hours": 12,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "GitHub Actions — Quickstart", "url": "https://docs.github.com/en/actions/writing-workflows/quickstart", "description": "Create your first workflow file in 5 minutes.", "time_to_consume": "20m"},
                {"type": "documentation", "title": "GitHub Actions — About Workflows", "url": "https://docs.github.com/en/actions/writing-workflows/about-workflows", "description": "Triggers, jobs, steps, and the workflow execution model.", "time_to_consume": "30m"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "GitHub Actions — Reusable Workflows", "url": "https://docs.github.com/en/actions/sharing-automations/reusing-workflows", "description": "DRY your pipelines with reusable workflow templates.", "time_to_consume": "30m"},
                {"type": "article", "title": "Trivy — Container Scanning in CI", "url": "https://aquasecurity.github.io/trivy/latest/tutorials/integrations/github-actions/", "description": "Integrate Trivy CVE scanning into GitHub Actions with policy gates.", "time_to_consume": "20m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "actions-runner-controller (ARC)", "url": "https://github.com/actions/actions-runner-controller", "description": "Run GitHub Actions on your own Kubernetes cluster.", "time_to_consume": "45m"},
                {"type": "article", "title": "DORA Metrics — Google Engineering", "url": "https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance", "description": "Deploy frequency, lead time, change failure rate, MTTR — how to measure DevOps performance.", "time_to_consume": "20m"},
            ],
        },
    },

    "gcp": {
        "tasks": {
            "beginner": [
                "Day 1: Create a GCP free-tier account; set up a project and enable billing with budget alerts",
                "Day 2: Deploy a Hello World app to Cloud Run in under 10 minutes using `gcloud run deploy`",
                "Day 3: Create a Cloud Storage bucket; upload and serve a static file publicly",
                "Day 4: Create a Cloud SQL instance (PostgreSQL); connect via Cloud SQL Auth Proxy",
                "Day 5: Write and deploy a Cloud Function (Python HTTP trigger); test with curl",
                "Day 6: Set up a basic Cloud Build trigger: push to GitHub → build Docker image → push to Artifact Registry",
                "Day 7: Read the Google Cloud Architecture Framework overview",
            ],
            "intermediate": [
                "Day 1: Set up a VPC with custom subnets, firewall rules, and Private Google Access",
                "Day 2: Deploy a GKE Autopilot cluster; deploy a workload and expose via GCLB Ingress",
                "Day 3: Implement Workload Identity for GKE so pods use a GSA instead of node SA",
                "Day 4: Set up Cloud Monitoring dashboards + alerting policies for a Cloud Run service",
                "Day 5: Use Secret Manager for all credentials; access from Cloud Run with Managed SA",
                "Day 6: Implement a Cloud Armor WAF policy with rate limiting for a public endpoint",
                "Day 7: Conduct a Security Command Center review; address Critical findings",
            ],
            "advanced": [
                "Day 1: Design and document a GCP Organization hierarchy with folders, projects, and IAM inheritance",
                "Day 2: Implement Organisation Policies to restrict resource locations and deny public IPs on VMs",
                "Day 3: Build a multi-region Cloud Spanner database with a 5-node configuration",
                "Day 4: Implement a Dataflow streaming pipeline reading from Pub/Sub and writing to BigQuery",
                "Day 5: Set up VPC Service Controls with a perimeter to prevent data exfiltration",
                "Day 6: Implement a full Anthos Config Management setup for multi-cluster GitOps",
                "Day 7: Design a cost optimisation plan covering CUDs, Spot VMs, and rightsizing recommendations",
            ],
        },
        "projects": [
            {
                "title": "Scalable Pub/Sub Processing Pipeline on GCP",
                "description": "Build a real-time data pipeline: a producer Cloud Function publishes events to Pub/Sub, a Cloud Run consumer subscribes and processes them, writes results to Firestore, and exposes a summary API.",
                "objectives": [
                    "Deploy a Cloud Function HTTP endpoint that publishes structured JSON to a Pub/Sub topic",
                    "Deploy a Cloud Run service with a Pub/Sub push subscription as its trigger",
                    "Store processed results in Firestore with a TTL policy",
                    "Use Workload Identity (not service account keys) for all GCP API calls",
                ],
                "deliverables": [
                    "GitHub repo with Cloud Run Dockerfile, function source, and Terraform/Deployment Manager config",
                    "README with end-to-end test instructions (`gcloud pubsub topics publish ...`)",
                    "Cloud Monitoring screenshot showing message processing latency",
                ],
                "evaluation_criteria": [
                    "Push subscription retry behaviour is tested (what happens if Cloud Run returns 500?)",
                    "No service account key files exist in the repo",
                    "Firestore TTL policy is configured to avoid unbounded data growth",
                    "Processing latency is under 2 seconds for a single message",
                ],
                "hints": {
                    "level_1": "Pub/Sub push subscriptions send an HTTP POST to your Cloud Run URL containing a base64-encoded message. Think about the decode flow: HTTP body → decode → parse JSON → process → write to Firestore.",
                    "level_2": "Pub/Sub retry: if your Cloud Run handler returns any non-2xx status, Pub/Sub will retry with exponential backoff. Make your handler idempotent (processing the same message twice should produce the same result).",
                    "level_3": "Architecture: Pub/Sub topic + push subscription pointing to Cloud Run URL. Cloud Run service account needs `roles/datastore.user`. Function service account needs `roles/pubsub.publisher`. Use `GOOGLE_CLOUD_PROJECT` env var, not hardcoded project IDs.",
                    "level_4": "Debugging: (1) Push subscription not delivering → check Cloud Run URL is public or authenticated correctly (`--allow-unauthenticated` or add Pub/Sub service account as invoker). (2) Firestore writes failing → verify service account has `datastore.user` role. (3) Function not publishing → check `pubsub.publisher` role on the topic (not just the project).",
                },
                "archetype": "event_driven_pipeline",
                "estimated_hours": 12,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "course_module", "title": "Google Cloud Skills Boost — Cloud Engineer Path", "url": "https://www.cloudskillsboost.google/paths/11", "description": "Structured labs and quests for Associate Cloud Engineer certification.", "time_to_consume": "Free labs (some require credits)"},
                {"type": "documentation", "title": "GCP Cloud Run Quickstart", "url": "https://cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-service", "description": "Deploy a Python service to Cloud Run in under 15 minutes.", "time_to_consume": "20m"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "GCP — Workload Identity Federation", "url": "https://cloud.google.com/iam/docs/workload-identity-federation", "description": "Grant permissions to workloads without service account keys.", "time_to_consume": "30m"},
                {"type": "documentation", "title": "GCP Architecture Center", "url": "https://cloud.google.com/architecture", "description": "Reference architectures and patterns indexed by use case.", "time_to_consume": "Reference"},
            ],
            "advanced": [
                {"type": "documentation", "title": "VPC Service Controls", "url": "https://cloud.google.com/vpc-service-controls/docs/overview", "description": "Data perimeters to prevent exfiltration from managed services.", "time_to_consume": "45m"},
                {"type": "documentation", "title": "Dataflow Programming Model", "url": "https://cloud.google.com/dataflow/docs/concepts/beam-programming-model", "description": "Apache Beam model for batch and streaming pipelines on Dataflow.", "time_to_consume": "45m"},
            ],
        },
    },

    "python": {
        "tasks": {
            "beginner": [
                "Day 1: Set up a project with `uv` or `virtualenv`; understand `pyproject.toml` vs `requirements.txt`",
                "Day 2: Explore Python data structures deeply: list comprehensions, dict/set operations, generator expressions",
                "Day 3: Write 10 functions using first-class functions: map, filter, partial, closures",
                "Day 4: Deeply understand decorators — write `@timer`, `@retry(n)`, and `@cache` from scratch",
                "Day 5: Learn Python's object model: `__dunder__` methods, `__slots__`, `@property`, `@classmethod`",
                "Day 6: Write a CLI tool using `argparse` or `click` with subcommands and help text",
                "Day 7: Profile your code with `cProfile` and `line_profiler`; identify and fix one bottleneck",
            ],
            "intermediate": [
                "Day 1: Deep-dive `asyncio`: event loop, coroutines, tasks, `asyncio.gather`, and exception handling",
                "Day 2: Write a FastAPI service with Pydantic models, dependency injection, and background tasks",
                "Day 3: Implement a data pipeline using generators for memory-efficient streaming processing",
                "Day 4: Write a test suite with `pytest`: fixtures, parametrize, monkeypatch, and coverage report",
                "Day 5: Study Python's memory model: garbage collection, reference counting, `weakref`",
                "Day 6: Implement a robust retry mechanism using `tenacity`; test it with mocked failures",
                "Day 7: Package and publish a library: `pyproject.toml`, `__init__.py` exports, version bumping",
            ],
            "advanced": [
                "Day 1: Write a Python C extension module with Cython or `ctypes`; benchmark vs pure Python",
                "Day 2: Implement a custom importlib hook to load modules from a non-standard source",
                "Day 3: Use `multiprocessing.Pool` and `concurrent.futures` for CPU-bound parallelism; compare with `asyncio`",
                "Day 4: Deep-dive Python's descriptor protocol; write a `@validated` descriptor for typed attributes",
                "Day 5: Implement a memory-efficient columnar data structure and compare with pandas",
                "Day 6: Write a metaclass that auto-registers subclasses in a plugin registry",
                "Day 7: Profile a real asyncio application for event loop blocking; fix the slowest coroutine",
            ],
        },
        "projects": [
            {
                "title": "Async Web Scraper with Rate Limiting and Retry",
                "description": "Build an async web scraper that fetches data from a public API or website concurrently, respects rate limits using a token-bucket algorithm, retries on transient failures, and stores results in a SQLite database.",
                "objectives": [
                    "Use `aiohttp` + `asyncio.TaskGroup` (Python 3.11+) for concurrent fetching",
                    "Implement a token-bucket rate limiter as an `asyncio`-aware class",
                    "Use `tenacity` with exponential backoff + jitter for retry logic",
                    "Store results in SQLite using `aiosqlite`; avoid duplicate entries via upsert",
                ],
                "deliverables": [
                    "GitHub repo with a `scraper/` package and `main.py` CLI entrypoint",
                    "README with usage examples and expected throughput numbers",
                    "Benchmark table: throughput with and without rate limiting (n requests/s)",
                ],
                "evaluation_criteria": [
                    "No blocking I/O calls inside the async event loop",
                    "Token-bucket rate limiter is unit-tested independently",
                    "Running the scraper twice does not produce duplicate rows in SQLite",
                    "All errors are logged with context (URL, status code, retry count)",
                ],
                "hints": {
                    "level_1": "Think about concurrency vs. rate limiting as separate concerns. Your event loop can schedule 100 tasks, but your token-bucket decides how many are actually sent per second.",
                    "level_2": "Token bucket: use `asyncio.Lock` + `asyncio.sleep` to refill tokens at a fixed rate. Each fetch call `await`s the bucket to acquire a token before sending the HTTP request.",
                    "level_3": "Structure: `scraper/rate_limiter.py` (TokenBucket class), `scraper/fetcher.py` (async fetch with retry), `scraper/storage.py` (aiosqlite upsert), `main.py` (CLI using click, assembles TaskGroup). Pass the bucket as a dependency injection argument.",
                    "level_4": "Debugging: (1) Event loop blocking → use `asyncio.get_event_loop().set_debug(True)` and watch for 'slow callback' warnings. (2) aiosqlite 'database is locked' → use a single shared connection + `async with conn` serialises writes. (3) Duplicate rows on retry → use `INSERT OR REPLACE` or a unique index on the URL column.",
                },
                "archetype": "async_data_pipeline",
                "estimated_hours": 10,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "Python Official Tutorial", "url": "https://docs.python.org/3/tutorial/index.html", "description": "The authoritative Python tutorial — chapters 3-9 cover the essentials.", "time_to_consume": "3–5h"},
                {"type": "article", "title": "Real Python — Python Decorators Explained", "url": "https://realpython.com/primer-on-python-decorators/", "description": "Step-by-step decorators tutorial with worked examples.", "time_to_consume": "45m"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Python asyncio Documentation", "url": "https://docs.python.org/3/library/asyncio.html", "description": "Complete reference for the asyncio event loop, tasks, and patterns.", "time_to_consume": "45m"},
                {"type": "article", "title": "FastAPI — Advanced User Guide", "url": "https://fastapi.tiangolo.com/advanced/", "description": "Dependency injection, background tasks, middleware, and middleware stacking.", "time_to_consume": "60m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "Python Data Model Reference", "url": "https://docs.python.org/3/reference/datamodel.html", "description": "Complete guide to dunder methods, descriptors, and metaclasses.", "time_to_consume": "60m"},
                {"type": "article", "title": "Cython Documentation", "url": "https://cython.readthedocs.io/en/latest/src/quickstart/overview.html", "description": "Write C extensions in Python-like syntax for 10-100x speedups.", "time_to_consume": "45m"},
            ],
        },
    },

    "rust": {
        "tasks": {
            "beginner": [
                "Day 1: Install `rustup`; read The Rust Book chapters 1-3; run `rustlings` exercises for ownership",
                "Day 2: Understand ownership deeply: move semantics, `Clone`, `Copy`, and the borrow checker",
                "Day 3: Write a CLI calculator: practice `match`, `Result<T,E>`, and `?` operator",
                "Day 4: Study structs, enums (`Option`, `Result`), `impl` blocks, and trait implementations",
                "Day 5: Write generic functions and implement a trait (`Display`, `Iterator`) for a custom type",
                "Day 6: Understand `Rc<T>`, `Arc<T>`, `Mutex<T>` — write a thread-safe counter",
                "Day 7: Read The Rust Book chapter on Error Handling; replace panics with proper `Result` propagation",
            ],
            "intermediate": [
                "Day 1: Build an async HTTP server using `axum` or `actix-web`; implement 3 REST endpoints",
                "Day 2: Write a zero-copy parser using `nom` or `winnow` for a custom data format",
                "Day 3: Study lifetimes in depth: named lifetimes, lifetime elision rules, `'static`",
                "Day 4: Implement a generic data structure (e.g. a stack) that works with any `Clone + Debug` type",
                "Day 5: Use `rayon` for data-parallel processing; benchmark vs. single-threaded version",
                "Day 6: Write integration tests using `#[cfg(test)]` and `mockall` for mocked dependencies",
                "Day 7: Profile with `cargo-flamegraph`; identify and optimise the hottest function",
            ],
            "advanced": [
                "Day 1: Write an unsafe block correctly; document every invariant your unsafe code relies on",
                "Day 2: Implement a custom smart pointer with `Deref`, `DerefMut`, and `Drop`",
                "Day 3: Study the Rust async runtime model; implement a minimal single-threaded future executor",
                "Day 4: Use `proc_macro` to write a derive macro that auto-implements a trait",
                "Day 5: Write a zero-allocation hot path; verify with `cargo-expand` and `perf`",
                "Day 6: Cross-compile a Rust binary for `aarch64-unknown-linux-musl`; run it in a container",
                "Day 7: Contribute a bug fix or doc improvement to an open-source Rust crate",
            ],
        },
        "projects": [
            {
                "title": "High-Performance JSON Log Processor as a CLI Tool",
                "description": "Write a Rust CLI tool that reads NDJSON log files (potentially GBs in size), filters by field values, aggregates metrics, and outputs a summary — all without loading the whole file into memory.",
                "objectives": [
                    "Use `BufReader` for zero-copy line-by-line streaming of large files",
                    "Parse each JSON line using `serde_json` into a typed struct",
                    "Support filter flags: `--level ERROR`, `--after 2026-01-01`, `--contains <text>`",
                    "Output an aggregated summary: counts per log level, error rate, p50/p99 latency if present",
                ],
                "deliverables": [
                    "GitHub repo with `src/main.rs`, `Cargo.toml`, and a sample log file for testing",
                    "README with usage examples and a benchmark (MB/s processed) against a 100MB log file",
                    "Ensure `cargo clippy` passes with zero warnings",
                ],
                "evaluation_criteria": [
                    "Memory usage stays under 50MB when processing a 1GB file",
                    "All CLI flags are documented in `--help` output",
                    "Error handling uses `anyhow` or `thiserror` — no `unwrap()` in production code paths",
                    "Benchmark proves at least 100 MB/s throughput on a modern laptop",
                ],
                "hints": {
                    "level_1": "Think about the streaming challenge: you cannot `collect()` all lines into a Vec for a 1GB file. Instead, fold your aggregation state line-by-line as you read the stream.",
                    "level_2": "Use `clap` for CLI argument parsing (derive API). Use `serde_json::from_str::<LogEntry>(line)` to deserialise each line. Use `BufReader::lines()` to stream without allocating the whole file.",
                    "level_3": "Structure: `main.rs` (CLI setup, opens file, calls processor), `processor.rs` (takes `impl BufRead`, returns `AggregateStats`), `models.rs` (serde structs for log entries). Keep I/O and business logic separate for testability.",
                    "level_4": "Debugging: (1) `serde_json` parse errors on malformed lines → use `serde_json::from_str::<serde_json::Value>(line).ok()` to skip invalid lines. (2) Slow performance → profile with `cargo-flamegraph`; the bottleneck is often UTF-8 validation, not JSON parsing. (3) Memory creep → check you are not collecting intermediate results into a Vec — use an accumulator struct instead.",
                },
                "archetype": "systems_cli_tool",
                "estimated_hours": 12,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "documentation", "title": "The Rust Book", "url": "https://doc.rust-lang.org/book/", "description": "The authoritative Rust introduction — read chapters 1-12 for a solid foundation.", "time_to_consume": "8–12h total"},
                {"type": "course_module", "title": "Rustlings Exercises", "url": "https://github.com/rust-lang/rustlings", "description": "Small exercises to learn ownership, borrowing, and traits by fixing failing tests.", "time_to_consume": "3–5h"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "Rust Async Book", "url": "https://rust-lang.github.io/async-book/", "description": "Futures, async/await, and the Tokio runtime explained.", "time_to_consume": "3h"},
                {"type": "documentation", "title": "Axum Documentation", "url": "https://docs.rs/axum/latest/axum/", "description": "Widely-used async web framework — handlers, extractors, routers.", "time_to_consume": "45m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "The Rustonomicon", "url": "https://doc.rust-lang.org/nomicon/", "description": "The dark arts of unsafe Rust — required reading before writing any unsafe code.", "time_to_consume": "4h"},
                {"type": "article", "title": "Proc Macro Workshop", "url": "https://github.com/dtolnay/proc-macro-workshop", "description": "Hands-on exercises for writing procedural macros (derive, attribute, function-like).", "time_to_consume": "3–5h"},
            ],
        },
    },

    "machine learning": {
        "tasks": {
            "beginner": [
                "Day 1: Study the ML lifecycle: problem framing → data → features → model → evaluation → deployment",
                "Day 2: Implement linear regression from scratch with NumPy; compare with scikit-learn",
                "Day 3: Load and explore a real dataset (Kaggle Titanic); identify missing values and class imbalance",
                "Day 4: Build a scikit-learn pipeline: imputer + scaler + classifier + cross-validation",
                "Day 5: Understand bias–variance tradeoff; plot learning curves for over/underfit models",
                "Day 6: Implement a Random Forest with hyperparameter tuning using `GridSearchCV`",
                "Day 7: Evaluate a classifier with confusion matrix, precision, recall, F1, AUC-ROC",
            ],
            "intermediate": [
                "Day 1: Implement a neural network in PyTorch: fully-connected layers, backprop, and training loop",
                "Day 2: Build a text classification pipeline using TF-IDF + logistic regression vs. embedding + MLP",
                "Day 3: Study feature engineering for tabular data: target encoding, interaction features, date features",
                "Day 4: Implement experiment tracking with MLflow or Weights & Biases",
                "Day 5: Build a custom PyTorch Dataset and DataLoader for a non-standard data format",
                "Day 6: Implement cross-validation for time-series data (avoid data leakage with TimeSeriesSplit)",
                "Day 7: Package an ML model as a REST API with FastAPI and test it with a load tester",
            ],
            "advanced": [
                "Day 1: Fine-tune a pre-trained transformer (BERT, DistilBERT) on a classification task with HuggingFace",
                "Day 2: Implement a full MLOps pipeline: data version (DVC), train, eval, model registry, deploy",
                "Day 3: Study SHAP values; explain model predictions on a tabular dataset end-to-end",
                "Day 4: Implement online learning with partial_fit; build a concept-drift detector",
                "Day 5: Write a custom loss function and gradient step in PyTorch; validate with `torch.autograd.gradcheck`",
                "Day 6: Deploy a model to AWS SageMaker or GCP Vertex AI with A/B routing",
                "Day 7: Audit a model for fairness with `fairlearn`; document protected attributes and mitigation steps",
            ],
        },
        "projects": [
            {
                "title": "End-to-End ML Pipeline with Model Service and Monitoring",
                "description": "Build a supervised learning pipeline that trains a model, serves predictions via a FastAPI endpoint, logs predictions to a database, and detects data drift on live traffic.",
                "objectives": [
                    "Train a scikit-learn or XGBoost model on a public dataset with a reproducible training script",
                    "Serve the model as a REST API with Pydantic input validation",
                    "Log every prediction (input features + output) to SQLite for monitoring",
                    "Implement a simple drift detector that alerts if feature distributions shift > threshold",
                ],
                "deliverables": [
                    "GitHub repo with `train.py`, `serve.py`, and `monitor.py`",
                    "README with instructions to reproduce training and start the server",
                    "Notebook or script demonstrating the drift detector triggering on synthetic data",
                ],
                "evaluation_criteria": [
                    "Model evaluation metrics are logged and reproducible across runs (fixed random seed)",
                    "API input validation rejects invalid feature types with a clear error message",
                    "Prediction log table exists and contains at least 100 sample rows",
                    "Drift detector is tested with a distribution shift and correctly raises an alert",
                ],
                "hints": {
                    "level_1": "Think about the separation of concerns: training produces a serialized artifact (`.pkl` or ONNX), the server loads the artifact at startup (not at every request), and the monitor runs on logged data independently.",
                    "level_2": "Use `joblib.dump(model, 'model.pkl')` after training. In FastAPI, load the model once with a lifespan startup event (not inside the endpoint function). For drift, compute Population Stability Index (PSI) or KS statistic on stored prediction features.",
                    "level_3": "Structure: `train.py` → outputs `model.pkl` + `feature_stats.json` (training distribution). `serve.py` loads both; logs to `predictions.db`. `monitor.py` queries `predictions.db`, computes PSI against `feature_stats.json`, raises alert if PSI > 0.2.",
                    "level_4": "Debugging: (1) Model not loading → pickle version mismatch if Python version changed; use ONNX for portability. (2) Feature drift not detected → ensure you are comparing the same feature (not post-scaled vs pre-scaled). (3) SQLite locking under concurrent API load → use WAL mode (`PRAGMA journal_mode=WAL`).",
                },
                "archetype": "ml_production_pipeline",
                "estimated_hours": 14,
            },
        ],
        "resources": {
            "beginner": [
                {"type": "course_module", "title": "Scikit-learn User Guide", "url": "https://scikit-learn.org/stable/user_guide.html", "description": "Complete guide to preprocessing, pipelines, model selection, and evaluation.", "time_to_consume": "Reference"},
                {"type": "article", "title": "Google Machine Learning Crash Course", "url": "https://developers.google.com/machine-learning/crash-course", "description": "Free Google course covering regression, classification, neural nets, and best practices.", "time_to_consume": "15h total"},
            ],
            "intermediate": [
                {"type": "documentation", "title": "PyTorch Tutorials", "url": "https://pytorch.org/tutorials/", "description": "Official hands-on tutorials: from tensors to custom training loops.", "time_to_consume": "Reference"},
                {"type": "documentation", "title": "MLflow Documentation", "url": "https://mlflow.org/docs/latest/index.html", "description": "Experiment tracking, Model Registry, and serving.", "time_to_consume": "45m"},
            ],
            "advanced": [
                {"type": "documentation", "title": "HuggingFace — Fine-tuning LLMs", "url": "https://huggingface.co/docs/transformers/training", "description": "Trainer API and PEFT for fine-tuning transformers efficiently.", "time_to_consume": "60m"},
                {"type": "article", "title": "Evidently AI — ML Monitoring", "url": "https://docs.evidentlyai.com/", "description": "Open-source data and model drift monitoring with beautiful reports.", "time_to_consume": "30m"},
            ],
        },
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# Aliases to map variant spellings to canonical keys
# ─────────────────────────────────────────────────────────────────────────────
_ALIASES: dict[str, str] = {
    "k8s": "kubernetes",
    "cicd": "ci/cd",
    "ci cd": "ci/cd",
    "continuous integration": "ci/cd",
    "continuous delivery": "ci/cd",
    "devops": "ci/cd",
    "google cloud": "gcp",
    "google cloud platform": "gcp",
    "amazon web services": "aws",
    "microsoft azure": "azure",
    "ml": "machine learning",
    "deep learning": "machine learning",
    "ai": "machine learning",
    "py": "python",
    "python3": "python",
}


def _resolve_skill(skill: str) -> str | None:
    """Return canonical SKILL_DB key or None."""
    s = (skill or "").strip().lower()
    if s in SKILL_DB:
        return s
    if s in _ALIASES:
        return _ALIASES[s]
    # Partial prefix match
    for key in SKILL_DB:
        if s.startswith(key) or key.startswith(s):
            return key
    return None


def _mastery_band(mastery_level: int) -> str:
    if mastery_level <= 1:
        return "beginner"
    elif mastery_level <= 3:
        return "intermediate"
    else:
        return "advanced"


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def skill_tasks(skill: str, role: str, mastery_level: int) -> list[str]:
    """Return a 7-day personalised learning plan for the given skill."""
    key = _resolve_skill(skill)
    band = _mastery_band(mastery_level)

    if key and key in SKILL_DB:
        tasks = SKILL_DB[key]["tasks"].get(band, SKILL_DB[key]["tasks"]["beginner"])
        return tasks[:]  # return a copy

    # Generic fallback (non-library skill)
    role_part = f" for {role}" if role else ""
    prefixes = [
        f"Foundations{role_part}: core concepts and terminology for {skill}",
        f"Setup{role_part}: install and configure a {skill} development environment",
        f"First practice: build a minimal working {skill} example end-to-end",
        f"Core patterns: study three common real-world {skill} patterns",
        f"Best practices: research production {skill} guidelines and anti-patterns",
        f"Integration build: incorporate {skill} into a small project{role_part}",
        f"Mastery check: document what you learned + identify your remaining gaps in {skill}",
    ]
    return prefixes


def skill_project(
    skill: str,
    role: str,
    difficulty: str,
    phase_idx: int,
    mastery_level: int,
    user_id: str = "",
    completed_projects: list[str] | None = None,
) -> dict:
    """Return a project dict with all fields including 4-level hints.

    Picks from the project pool deterministically but varied — different
    users with the same skill get different projects based on user_id hash.
    """
    key = _resolve_skill(skill)
    completed = set(completed_projects or [])

    if key and key in SKILL_DB:
        pool = SKILL_DB[key]["projects"]
        # Filter out already-completed projects; fall back to full pool if all done
        available = [p for p in pool if p["title"] not in completed] or pool
        # Deterministic selection: vary by user_id to personalise across users
        seed_str = f"{user_id}:{skill}:{phase_idx}:{len(completed)}"
        idx = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % len(available)
        proj = available[idx]

        # Scale hours with phase
        base_hours = proj.get("estimated_hours", 10)
        hours = base_hours + phase_idx * 2

        return {
            "title": proj["title"],
            "description": proj["description"],
            "objectives": proj["objectives"],
            "deliverables": proj["deliverables"],
            "evaluation_criteria": proj["evaluation_criteria"],
            "hints": proj["hints"],
            "archetype": proj["archetype"],
            "difficulty": difficulty,
            "estimated_hours": hours,
            "unique_seed": seed_str,
        }

    # Generic fallback for unlisted skills
    role_part = f" for a {role}" if role else ""
    return {
        "title": f"{skill} Portfolio Project{role_part}",
        "description": (
            f"Build a small but real-world {skill} project{role_part}. "
            "Demonstrate a complete, working workflow and document your decisions."
        ),
        "objectives": [
            f"Implement the core {skill} workflow end-to-end",
            "Make the project reproducible with a single setup command",
            "Add at least one automated check (test, lint, or validation)",
        ],
        "deliverables": [
            "Public GitHub repo with README covering setup and usage",
            "Example output proving the project runs correctly",
        ],
        "evaluation_criteria": [
            "README clearly explains what the project does and how to run it",
            "Core workflow is correct and verified",
            "Code is reasonably structured and documented",
        ],
        "hints": {
            "level_1": f"Identify the single most important problem {skill} solves in a {role} context. Start there.",
            "level_2": f"Build the smallest working version first. For {skill}, that usually means one main file + one config. Expand gradually.",
            "level_3": f"Think about structure: separate configuration from business logic. Use environment variables for anything that changes between environments.",
            "level_4": f"Common pitfalls in {skill}: (1) not testing the unhappy path, (2) hardcoding values that should be configurable, (3) skipping error handling for external calls. Fix these before considering the project done.",
        },
        "archetype": "portfolio_project",
        "difficulty": difficulty,
        "estimated_hours": 8 + phase_idx * 2,
        "unique_seed": f"generic:{skill}:{user_id}:{phase_idx}",
    }


def skill_resources(skill: str, difficulty: str) -> list[dict]:
    """Return a list of direct (non-search-engine) resource dicts for a skill."""
    key = _resolve_skill(skill)
    band = _mastery_band({"beginner": 0, "intermediate": 2, "advanced": 4}.get(difficulty, 0))

    if key and key in SKILL_DB:
        items = SKILL_DB[key]["resources"].get(band) or SKILL_DB[key]["resources"].get("beginner", [])
        return [dict(r) for r in items]

    # Fallback: at least one Wikipedia and one YouTube search (with proper YouTube URL)
    safe = (skill or "skill").strip().replace(" ", "_")
    yt_query = (skill or "skill").strip().replace(" ", "+")
    return [
        {
            "type": "article",
            "title": f"{skill} — Wikipedia Overview",
            "url": f"https://en.wikipedia.org/wiki/{safe}",
            "description": f"Quick orientation: key concepts, history, and terminology for {skill}.",
            "time_to_consume": "10–20m",
        },
        {
            "type": "video",
            "title": f"{skill} Tutorial (YouTube)",
            "url": f"https://www.youtube.com/results?search_query={yt_query}+tutorial+{difficulty}",
            "description": f"Search results for hands-on {difficulty}-level {skill} tutorials.",
            "time_to_consume": "20–40m",
        },
    ]
