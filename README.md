# Vegz Agent

Delivery-partner API, responsive web workspace and native client for the Vegz ecosystem.

## Stack

- Web: Next.js + TypeScript under `web/`
- Android/iOS: React Native + Expo Router under `mobile/`
- Backend: FastAPI + SQLAlchemy under `backend/`
- Database: SQLite by default; PostgreSQL/MySQL SQLAlchemy connections supported.

## Available workflows

- Development phone/code login and persistent local session storage in Expo SecureStore.
- Agent profile and online/offline state (only approved agents can go online).
- Agent-scoped active deliveries and delivery history via the API.
- Multi-shop pickup stops and progress, customer handoff, failure reasons and delivery confirmation notes.
- Development-only seeded sample deliveries.
- Authenticated `POST /api/internal/dispatch` supports multiple pickup stops from the user service when both services share a configured `DISPATCH_SHARED_SECRET`.

The location API currently is a contract stub: the app explicitly does not collect or broadcast live GPS. Delivery proof is a note, not a tamper-resistant photo/OTP proof. Development sign-in defaults to `123456`.

## Run the web portal

```bash
cd web
npm install
NEXT_PUBLIC_VEGZ_AGENT_API_URL=http://localhost:8001 npm run dev
```

Open `http://localhost:3000`. The Next.js entry screen currently embeds the existing API-backed agent web workflow while migration to native Next components continues. Legacy FastAPI-served portal is still available from the API on port 8001.

## Run the Expo app

```bash
cd mobile
npm install
npm run android
```

Android emulator API default: `http://10.0.2.2:8001`. Set `EXPO_PUBLIC_VEGZ_AGENT_API_URL` to your development computer’s LAN IP for a physical phone.

## Shared local stack

From `../vegz-admin`:

```bash
docker-compose -f docker-compose.postgres.yml up --build -d
```

This Compose file assigns the APIs on ports 8000–8003 and web apps on ports 3000–3003. Keep named volumes and do not use `down -v`.

## CI

The `dev` workflow builds the Next.js app, checks the Expo TypeScript app, compiles Python, runs API tests and checks JavaScript syntax.

## Required before launch

- Verified OTP / real identity provider, token renewal/revocation and access logging.
- Opt-in GPS capture/storage, retention policy and privacy controls.
- Photo/OTP proof of delivery, notifications, cancellation/reassignment recovery.
- PostgreSQL migrations, backups, live dispatch integration tests and monitoring.
