# BackpageSeek Backend

Production-style backend scaffold for your existing frontend UI.

## Stack

- Fastify + TypeScript
- PostgreSQL + Prisma ORM
- Cloudinary image storage
- JWT authentication

## What Is Included

- Auth APIs: register, login, me
- Post APIs: list, detail, create, update, delete
- User APIs: my posts
- Admin APIs: pending posts, approve/reject
- Multipart image upload to Cloudinary (up to 8 images per post)

## 1) Setup Environment

1. Copy `.env.example` to `.env`
2. Fill values in `.env`

Important values:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Optional admin seed values:

- `ADMIN_EMAIL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

## 2) Install Dependencies

```bash
npm install
```

## 3) Generate Prisma Client

```bash
npm run prisma:generate
```

## 4) Run Database Migration

```bash
npm run prisma:migrate
```

## 5) Seed Admin User (Optional)

```bash
npm run seed
```

## 6) Start Backend

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

Server runs at:

- `http://localhost:4000`
- Health: `GET /api/health`

## API Base

All endpoints are under `/api`.

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/posts`
- `GET /api/posts/:id`
- `POST /api/posts` (multipart supported)
- `PUT /api/posts/:id` (multipart supported)
- `DELETE /api/posts/:id`
- `GET /api/users/me/posts`
- `GET /api/admin/posts/pending`
- `POST /api/admin/posts/:id/approve`
- `POST /api/admin/posts/:id/reject`

## Notes For Frontend Integration

- Keep your existing UI and query flow (`category`, `state`, `city`) unchanged.
- For post create/update, submit as `multipart/form-data` to include image files.
- Category-specific fields can be sent as JSON strings:
  - `casualDetails`
  - `rentalDetails`
  - `petDetails`
  - `serviceDetails`

Example JSON string field value:

```json
{"orientation":"straight","lookingFor":"men"}
```

## Image Storage Modes

Backend supports two image storage modes via `.env`:

- `IMAGE_STORAGE=cloudinary` (default)
- `IMAGE_STORAGE=local` (store on VPS disk)

For local mode, set:

```env
IMAGE_STORAGE=local
PUBLIC_BASE_URL=https://backseek.onedigitalspot.com
LOCAL_UPLOAD_DIR=/var/www/backseek/uploads
```

In local mode uploaded files are served from:

- `GET /api/uploads/:name`
