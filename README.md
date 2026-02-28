# Identity Reconciliation Service

A production-ready backend service that performs identity reconciliation by linking customer contact records across multiple interactions. Built for the BiteSpeed backend assignment.

## Problem Statement

Customers frequently use different email addresses and phone numbers across purchases. This service consolidates fragmented identity data into a unified contact graph, ensuring every interaction maps back to a single person. It exposes a single `POST /identify` endpoint that accepts an email and/or phone number, resolves the full identity cluster, and returns a consolidated view.

## Architecture

```
Request
  |
  v
[Controller]  -->  Validates input, normalizes email/phone
  |
  v
[Service]     -->  Identity resolution algorithm (inside DB transaction)
  |
  v
[Repository]  -->  Prisma queries against PostgreSQL
  |
  v
[PostgreSQL]  -->  Contact table with self-referencing linked list
```

**Layering rules:**
- Controller: HTTP request/response only. No business logic.
- Service: Business logic (identity merging). No HTTP awareness.
- Repository: Raw database access. No business decisions.

### Folder Structure

```
src/
  controllers/    Request validation, input normalization
  services/       Identity resolution algorithm
  repositories/   Prisma database queries
  routes/         Express route definitions
  middleware/     Global error handling
  utils/          Logger, Prisma client, custom errors
  types/          TypeScript interfaces
  app.ts          Express application setup
  server.ts       HTTP server entry point
```

## Identity Resolution Algorithm

The algorithm runs inside a single Prisma `$transaction` to guarantee atomicity.

### Steps

1. **Find matches**: Query all non-deleted contacts where `email = input.email OR phoneNumber = input.phoneNumber`.

2. **No match**: Create a new `primary` contact. Return immediately.

3. **Match found**: Collect the full identity cluster:
   - All directly matched contacts
   - Their linked primary contacts
   - All secondaries under each primary
   
4. **Resolve primary**: The oldest `createdAt` among all primaries in the cluster wins. Any newer primaries are demoted to `secondary` and their children are re-linked to the oldest primary.

5. **Idempotency check**: If the exact email+phone combination already exists in the cluster, skip creation.

6. **Create secondary**: If either the email or phone is new to the cluster, create a new `secondary` contact linked to the primary.

7. **Build response**: Return deduplicated emails (primary first), phone numbers (primary first), and all secondary IDs.

## Edge Cases Handled

| Case | Handling |
|------|----------|
| Two independent primaries connected by a new request | Older stays primary, newer becomes secondary. All children re-linked. |
| Transitive linking (A-B, B-C, query hits C) | Full cluster collected by traversing primary links recursively. |
| Duplicate request (idempotency) | Exact email+phone combo detected, no new row created. |
| Null email or phone | Allowed individually. Both null returns 400. |
| Concurrent requests | Wrapped in a serializable Prisma transaction. Existence re-checked inside transaction. |

## Database Design Rationale

**Why a self-referencing table?**
A single `Contact` table with a `linkedId` foreign key forms a linked-list/tree structure. Each secondary points to its primary. This avoids the complexity of a separate join table and maps directly to the identity graph.

**Why oldest record is authoritative?**
Deterministic primary resolution. Without a clear rule, concurrent merges could produce different results. Using `createdAt` as the tiebreaker ensures the same primary is always selected regardless of request order.

**Why not a separate identity table?**
The identity graph is simple (star topology: one primary, N secondaries). A separate table adds joins without benefit. The self-referencing `linkedId` captures the full relationship.

**Why indexes on email, phoneNumber, and linkedId?**
- `email` and `phoneNumber` indexes enable O(log n) lookups on the two primary search fields.
- `linkedId` index accelerates "find all secondaries of a primary" queries.

**Why transactions?**
The merge operation (find, compare, create/update) must be atomic. Without a transaction, concurrent requests could both create secondary rows for the same data, violating idempotency.

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm

### Local Development

```bash
# Clone and install
git clone <repo-url>
cd BiteSpeed
npm install

# Configure database
cp .env.example .env
# Edit .env with your PostgreSQL connection string

# Run migrations
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# Start development server
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t bitespeed-identity .
docker run -p 3000:3000 -e DATABASE_URL="postgresql://..." bitespeed-identity
```

## API Reference

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Identify Contact

```
POST /identify
Content-Type: application/json
```

Request body:
```json
{
  "email": "user@example.com",
  "phoneNumber": "1234567890"
}
```

Response (200):
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["user@example.com"],
    "phoneNumbers": ["1234567890"],
    "secondaryContactIds": []
  }
}
```

Error (400):
```json
{
  "error": "At least one of email or phoneNumber must be provided"
}
```

## Sample curl Requests

```bash
# Create a new primary contact
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "phoneNumber": "1111111111"}'

# Link with same email, different phone
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "phoneNumber": "2222222222"}'

# Link with same phone, different email (merges clusters)
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "bob@example.com", "phoneNumber": "1111111111"}'

# Phone only
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "1111111111"}'

# Email only
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'

# Health check
curl http://localhost:3000/health
```

## Hosted Endpoint

> Replace with your deployed URL after hosting on Render.

```
https://<your-service>.onrender.com/identify
```

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript (strict mode)
- **Framework**: Express
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Hosting**: Render compatible
