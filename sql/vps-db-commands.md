# VPS PostgreSQL Access Guide (Backseek)

Use these commands in order, from login to exit.

## 1) SSH into VPS

```bash
ssh <VPS_USER>@<VPS_HOST>
```

Example:

```bash
ssh ubuntu@123.45.67.89
```

## 2) Go to backend folder

```bash
cd /path/to/nazimud-master/backend
```

## 3) Load DB URL from `.env`

```bash
grep '^DATABASE_URL=' .env
```

If needed, export it for current shell:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d '=' -f2- | sed 's/^"//;s/"$//')"
```

## 4) Open PostgreSQL shell (`psql`)

Preferred (uses app DB URL directly):

```bash
psql "$DATABASE_URL"
```

If `psql` is missing:

```bash
sudo apt update
sudo apt install -y postgresql-client
psql "$DATABASE_URL"
```

## 5) Basic `psql` commands

Inside `psql`:

```sql
\conninfo
\dt
\dn
\l
```

- `\conninfo`: current connection details
- `\dt`: list tables in current schema
- `\dn`: list schemas
- `\l`: list databases

## 6) See all rows from key tables

Inside `psql`:

```sql
SELECT * FROM "User" ORDER BY id DESC;
SELECT * FROM "Post" ORDER BY id DESC;
SELECT * FROM "PostImage" ORDER BY id DESC;
SELECT * FROM "PostReport" ORDER BY id DESC;
SELECT * FROM "RefreshToken" ORDER BY id DESC;
SELECT * FROM "AdminAction" ORDER BY id DESC;
```

## 7) Safer large-table view (recommended)

Use limits to avoid huge output:

```sql
SELECT * FROM "User" ORDER BY id DESC LIMIT 50;
SELECT * FROM "Post" ORDER BY id DESC LIMIT 50;
SELECT * FROM "AdminAction" ORDER BY id DESC LIMIT 100;
```

## 8) Useful table/schema inspection

```sql
\d "User"
\d "Post"
\d "PostImage"
\d "PostReport"
\d "RefreshToken"
\d "AdminAction"
```

## 9) Filter examples

### Find a user by email

```sql
SELECT id, email, username, role, "isBanned", "createdAt"
FROM "User"
WHERE email ILIKE '%example@domain.com%';
```

### See one user's posts

```sql
SELECT id, title, status, "postedAt"
FROM "Post"
WHERE "ownerId" = 1
ORDER BY id DESC;
```

### See pending delete requests (account)

```sql
SELECT id, "targetId", reason, "createdAt"
FROM "AdminAction"
WHERE "actionType" = 'account_delete_requested'
ORDER BY id DESC;
```

### See pending delete requests (posts)

```sql
SELECT id, "targetId", reason, "createdAt"
FROM "AdminAction"
WHERE "actionType" = 'post_delete_requested'
ORDER BY id DESC;
```

## 10) Export query results to CSV

From shell (outside `psql`):

```bash
psql "$DATABASE_URL" -c "SELECT id, email, username FROM \"User\" ORDER BY id DESC LIMIT 200" --csv > users_export.csv
```

## 11) Exit cleanly

Exit `psql`:

```sql
\q
```

Exit VPS SSH session:

```bash
exit
```

## Optional: one-liner full flow

```bash
ssh <VPS_USER>@<VPS_HOST> 'cd /path/to/nazimud-master/backend; export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d '=' -f2- | sed '"'"'s/^"//;s/"$//"'"')"; psql "$DATABASE_URL" -c "\dt"'
```
