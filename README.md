# Vegz Agent

Delivery-partner web app and API for the Vegz ecosystem. This is a separate service repository; it is designed to be integrated with the shared customer/shop order system.

## Current features

- Responsive agent portal for mobile, tablet and desktop.
- Development-only login and bearer-token session.
- Agent profile and online/offline availability.
- Agent-scoped delivery list, dashboard metrics, delivery history, customer/shop contact details, and ordered pickup stops when a customer basket spans shops.
- Delivery lifecycle: assigned -> accepted -> arrived at pickup -> picked up -> arrived at customer -> delivered.
- Decline/return assignment reasons and required completion note before delivered status.
- Sample deliveries for local workflow testing.
- FastAPI + SQLAlchemy with SQLite by default and configurable database URL.
- Dockerfile, Compose runner and GitHub Actions CI tests.

## Run locally

Requires Python 3.11+.

```bash
git clone https://github.com/Manojhole/vegz-agent.git
cd vegz-agent
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows PowerShell:
# .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
cp backend/.env.example .env
uvicorn backend.app.main:app --reload --port 8000
```

Open the agent app at http://localhost:8000 and API docs at http://localhost:8000/docs. Health endpoint: http://localhost:8000/api/health.

In development, the starter code is 123456 (configurable with AGENT_DEMO_CODE). Enter a mobile number and name to create a local demo agent. Use POST /api/dev/seed from the docs to create sample deliveries for that agent.

Alternatively:

```bash
docker compose up --build
```

## Configuration

Copy backend/.env.example to .env. Use a strong, unique JWT_SECRET for each environment. Do not use demo authentication in production.

SQLite default:

```
DATABASE_URL=sqlite:///./vegz_agent.db
```

For MySQL, use a compatible SQLAlchemy URL such as:

```
DATABASE_URL=mysql+pymysql://user:password@host:3306/vegz_agent
```

Install an appropriate MySQL driver and configure TLS, connection limits and backups for a hosted deployment.

## API endpoints

All routes except health and development login require an Authorization: Bearer <access_token> header.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/health | Health check |
| POST | /api/auth/demo-login | Development-only login |
| GET/PATCH | /api/me | Agent profile and online state |
| GET | /api/dashboard | Metrics, active jobs and recent deliveries |
| GET | /api/orders | Orders assigned to the current agent |
| GET | /api/orders/{id} | Assigned order details |
| PATCH | /api/orders/{id}/action | Update delivery workflow state |
| POST | /api/location | Location API contract stub; does not persist GPS |
| POST | /api/dev/seed | Create local demo deliveries |
| POST | /api/internal/dispatch | Authenticated multi-shop dispatch from user service |

## Production readiness: blockers to resolve

This is a production-oriented foundation, not a production-deployed delivery service. Do not deploy it as-is to handle real customer data.

1. **Authentication and onboarding:** integrate SMS OTP or OIDC, agent verification/approval, device/session management, login rate limits, token revocation and audited role access.
2. **Shared dispatch system:** customer orders from vegz-user do not automatically appear here. The authenticated `POST /api/internal/dispatch` contract now accepts multiple shop pickup stops and `DISPATCH_SHARED_SECRET`; configure the same secret in vegz-user and vegz-agent. The agent workflow advances through each pickup stop before moving to the customer. Harden dispatch idempotency, assignment selection and recovery before production.
3. **Database:** add Alembic migrations, PostgreSQL/MySQL production provisioning, backups, retention policy and concurrency-safe transitions. Avoid automatic create_all for production schema management.
4. **Location:** implement opt-in foreground/background GPS with OS permissions, sampling/rate limits, authenticated storage, retention limits, and real-time transport to dispatch/customer views. The current endpoint explicitly does not persist locations.
5. **Proof of delivery:** add secure photo/signature or OTP confirmation storage with retention controls. Current completion uses a text note and is not tamper-resistant proof.
6. **Notifications:** add provider-backed assignment/new-order push notifications, delivery status updates and SMS fallback.
7. **Operations:** configure HTTPS, secrets management, restricted CORS, error tracking, structured logs, metrics, health/readiness probes and alerts.
8. **Safety and policies:** ensure customer contact/address are disclosed only for an assigned active job, provide support/escalation workflows, cancellation rules, COD reconciliation and abuse reporting.
9. **Testing:** add integration tests for concurrent transitions, cross-agent access, expired/revoked sessions, dispatch failure, GPS privacy, retries and end-to-end order lifecycle.
10. **Deployment:** configure DNS/hosting and an environment-specific deployment pipeline. No public deployment or live GPS should be assumed from code being pushed.

## Architecture notes

This agent service currently owns its own agents and delivery_orders tables. It intentionally does not assume that independently developed vegz-user and vegz-shop databases can be shared safely. Integration should use a jointly defined schema or a secured service/API/event boundary, with a single authoritative order state and a clear ownership model. The eventual authoritative order service must coordinate shop acceptance, stock reservation, courier assignment, cancellation and delivery events.

## Repository structure

```
backend/app/main.py   FastAPI endpoints and SQLAlchemy models
backend/tests/        API tests
frontend/index.html   Partner app shell
frontend/styles.css   Responsive UI
frontend/app.js       Workflow and API integration
Dockerfile
docker-compose.yml
.github/workflows/ci.yml
```
