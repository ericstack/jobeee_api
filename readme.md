# Jobeee API — Backend

REST API for **Jobeee**, a job-board web application. Employers post jobs, job
seekers apply with a résumé, and admins manage the platform. Built with
**Express + MongoDB (Mongoose)** and JWT authentication.

> Frontend (React/Vite) lives in a separate repo: `jobee_frontend`.

---

## Features

### Authentication & accounts
- Register / login with **JWT** (signed via `jose`), bcrypt-hashed passwords.
- Three roles — **user** (job seeker), **employer**, **admin** — with role-based
  authorization on protected routes.
- Profile management: name, email, **phone, headline, skills**, and an **avatar
  photo** upload.
- **Change password** and **forgot/reset password** (email-based) flows.
- Per-endpoint **rate limiting** on auth routes to slow brute-force/abuse.

### Jobs
- Employers/admins **create, update, delete** jobs.
- Public **job listing** with rich querying:
  - Filters: `keyword`, `location`, `company`, `jobType`, `industry`,
    `salaryMin`/`salaryMax`.
  - **Sorting** (e.g. newest, salary high→low) and **pagination** (`page`/`limit`,
    response includes `total`); pagination is stable via an `_id` sort tiebreaker.
- Addresses are **geocoded** (OpenCage) on save for map / “jobs within radius”
  search (`GET /jobs/:zipcode/:distance`). Geocoding is resilient — a job still
  saves if geocoding is unavailable.
- Job stats aggregation by topic (text index on `title`/`description`).

### Applications
- Job seekers **apply** to a job with a **résumé file** (pdf/docx) + optional
  cover letter. Duplicate applications are prevented **atomically**.
- Applications are **embedded** in the job document (`applicantsApplied`), each
  with `status`, `appliedAt`, `statusUpdatedAt`.
- **Status pipeline:** `pending → shortlisted → interview → hired` (+ `rejected`),
  updatable by the job owner/admin.
- Applicants **track** their applications; employers/admins see **all applicants**
  across their jobs (with applicant details).
- **Résumés are access-controlled** — streamed only to the job owner, an admin, or
  the applicant themselves (not publicly served).
- Job seekers can **save/bookmark** jobs.
- **Email notifications** (non-blocking) to the employer on a new application and
  to the applicant on a status change.

### Admin
- List users, delete users (cascades their jobs / cleans up applications).
- Platform-wide data for analytics dashboards.

---

## Tech stack

- **Runtime:** Node.js (ESM)
- **Framework:** Express 4
- **Database:** MongoDB + Mongoose 8
- **Auth:** JWT (`jose`), `bcryptjs`
- **Security:** helmet, express-rate-limit, express-mongo-sanitize, xss-clean, hpp, cors
- **Uploads:** express-fileupload · **Geocoding:** opencage-api-client · **Email:** nodemailer

---

## Getting started

### Prerequisites
- Node.js 18+
- MongoDB (local or **MongoDB Atlas**). A `docker-compose.yml` is included:
  ```bash
  docker compose up -d mongo   # container "jobeee_mongo" on :27017
  ```

### Install & run
```bash
npm install
cp .env.example .env     # then fill in values
npm run dev              # nodemon, http://localhost:3000
```

### Environment variables (`.env`)
See `.env.example`. Key vars:

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | server config |
| `MONGODB_URI` / `MONGODB_URI_PRO` | Mongo connection (PRO used when `NODE_ENV=production`) |
| `JWT_SECRET`, `JWT_EXPIRES_TIME`, `COOKIE_EXPIRES_TIME` | auth / cookie |
| `UPLOAD_PATH`, `MAX_FILE_SIZE` | résumé / avatar uploads |
| `OPENCAGE_API_KEY` | geocoding |
| `SMTP_HOST/PORT/USER/PASS`, `SMTP_FROM_*` | email |
| `ALLOWED_ORIGINS` | comma-separated CORS allowlist (also allows `*.vercel.app`) |
| `APP_URL` | public origin for building absolute links |

### Seed demo data
```bash
npm run seed             # local DB
# Atlas:  set SEED_URI (URI must include /jobeee) or NODE_ENV=production, then npm run seed
```
Creates demo accounts (`employer@demo.com`, `seeker@demo.com`, `admin@demo.com`,
password `password123`) and sample jobs.

---

## API overview

Routers are mounted under **three prefixes**:

| Prefix | File |
|---|---|
| `/api/auth/v1` | `routes/auth.js` |
| `/api/jobs/v1` | `routes/jobs.js` |
| `/api/user/v1` | `routes/user.js` |

**Auth** — `POST register`, `POST login`, `POST logout`, `GET me`,
`POST password/forgot`, `PUT password/reset/:token`.

**Jobs** — `GET /jobs` (filters/sort/pagination), `GET /job/:id`,
`GET /jobs/:zipcode/:distance`, `GET /stats/:topic` (public);
`POST /job/new`, `PUT|DELETE /job/:id` (employer/admin);
`PUT /job/:id/apply` (multipart, field `file`);
`PUT /job/:id/applicant/:applicantId/status`;
`GET /me/applications`, `GET /employer/applicants`,
`GET /job/:id/applicant/:applicantId`,
`GET /job/:id/applicant/:applicantId/resume` (auth-gated).

**User** — `GET /userProfile`, `PUT /me/update` (profile + avatar),
`PUT /password/update`, `DELETE /me/delete`,
`GET /jobs/applied`, `GET /jobs/published`,
`GET|PUT|DELETE /jobs/saved[/:jobId]`,
`GET /users`, `DELETE /users/:id` (admin).

---

## Project structure

```
app.js                  Express setup, middleware, route mounting
config/database.js      Mongo connection
controller/             authController · jobsController · userController
models/                 users.js · jobs.js  (+ users.test.js)
routes/                 auth.js · jobs.js · user.js
middleware/             auth (isAuthenticatedUser, authorizeRoles), errors, catchAsyncErrors
utils/                  errorHandler · jwtToken · sendEmail · geocoder · apiFilters
scripts/                seed + node:test integration harnesses
```

---

## Testing

```bash
npm test                 # unit tests (Node built-in test runner)
node scripts/e2e.mjs     # end-to-end journey against an isolated demo DB
```
`scripts/*.mjs` are integration harnesses (e2e, apply, recon, p0, filters, sort,
pagination, profile, saved, admin, notify, resume-acl) — each boots the real
routers against a throwaway DB that is dropped afterward.

---

## Deployment notes
- Set the full env-var set on the host; `NODE_ENV=production` selects `MONGODB_URI_PRO`.
- Start command: `node app.js` (the `dev` script uses nodemon).
- `app.set("trust proxy", 1)` is enabled for reverse proxies (Render/Heroku).
- **Uploads are on local disk** — on hosts with ephemeral filesystems (e.g. Render
  free tier) uploaded files don't persist across restarts; use object storage
  (Cloudinary/S3) or a persistent disk for production.
