# ServiceDesk Pro

ServiceDesk Pro is a MERN IT helpdesk and asset management platform. The repository currently contains a working role-aware service desk with MongoDB-backed authentication, ticket workflows, inventory, knowledge, notifications, reporting and audit foundations.

## Requirements

- Node.js 20.19+ or 22.12+
- MongoDB 7+ running locally or a MongoDB Atlas connection string

## Local setup

1. Install packages from the repository root:

	```sh
	npm install
	npm --prefix backend install
	npm --prefix frontend install
	```

2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` to your MongoDB connection string. Copy `frontend/.env.example` to `frontend/.env` only when overriding the default API base URL.

3. Seed the demo organization and accounts:

	```sh
	npm --prefix backend run seed
	```

4. Start the API and frontend together:

	```sh
	npm run dev
	```

	The frontend runs at `http://localhost:5173`, and the API runs at `http://localhost:5000`. The frontend proxies `/api` requests to the backend during development.

## Commands

- `npm run dev` starts both development servers.
- `npm run build` creates the frontend production build.
- `npm run lint` runs frontend ESLint.
- `npm start` starts the API after connecting to MongoDB.
- `npm --prefix backend test` runs backend Node.js tests.
- `npm --prefix backend run seed` creates repeatable demo data.

## Demo accounts

The System Admin account has dedicated credentials. All other demo accounts use `ServiceDesk!2026`:

| Role | Email |
| --- | --- |
| System Admin | `system@gmail.com` / `system@123` |
| IT Manager | `manager@servicedesk.com` |
| Technician | `technician@servicedesk.com` |
| Employee | `employee@servicedesk.com` |
| Asset Manager | `assetmanager@servicedesk.com` |

## Working modules

- JWT login, admin-provisioned user accounts with bcrypt, five roles, department-scoped ticket access, and role-aware navigation.
- Ticket creation, search/filter, unique yearly IDs, manager assignment requests with technician acceptance/decline reasons, role-specific status lifecycle, comments, internal notes, shared work-progress logs, escalation, SLA deadlines and history.
- SLA at-risk alerts and breach escalation checked once per minute; policies are configurable by priority.
- Temporary asset loans: employees can request available equipment with a reason and optional repair ticket; Asset Managers approve/decline, issue items with timestamps, and confirm returns before assets become available again. Managers can review department assignments and loan history.
- Asset, vendor and knowledge article CRUD, asset lifecycle endpoints, notifications, admin audit trail and CSV ticket reports.
- Role-scoped dashboards with ticket status/priority charts; AI classification suggestions are review-only and can use `AI_API_KEY`, `AI_API_URL` and `AI_MODEL` from the backend environment.
- Helmet, CORS, rate limiting, input checks, centralized errors and pagination on collection APIs.

The application is runnable and database-backed, but it is not yet the complete capstone scope. Business-hours/holiday SLA calculation, password reset email delivery, validated binary attachment storage, warranty notification scheduling, full settings, richer report dimensions/PDF export, exhaustive CRUD/detail screens and broader automated authorization tests remain to be built. Do not use the demo accounts or development secret for production.

## Phase status

Phase 1 setup is complete. The current implementation establishes working vertical slices across Phases 2–11; the remaining scope listed above belongs in follow-up iterations. Phase 12 needs broader automated security and workflow coverage before production use.
