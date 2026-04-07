-- BackpageSeek DB inspection queries
-- Usage example (from backend folder):
-- psql "$env:DATABASE_URL" -f sql/db-inspection-queries.sql

-- 1) Latest users
SELECT
  u.id,
  u.email,
  u.username,
  u.role,
  u."createdAt"
FROM "User" u
ORDER BY u.id DESC
LIMIT 50;

-- 2) Latest posts with owner + phone + image count
SELECT
  p.id,
  p.title,
  p.category,
  p.subcategory,
  p.status,
  p."adType",
  p.age,
  p."locationText",
  p."phoneNumber",
  p."contactEmail",
  p.state,
  p.city,
  p."postedAt",
  u.username AS owner_username,
  COUNT(pi.id) AS image_count
FROM "Post" p
JOIN "User" u ON u.id = p."ownerId"
LEFT JOIN "PostImage" pi ON pi."postId" = p.id
GROUP BY p.id, u.username
ORDER BY p.id DESC
LIMIT 100;

-- 3) Latest posts with extracted Casual details fields
SELECT
  p.id,
  p.title,
  p.category,
  p.subcategory,
  p."phoneNumber",
  p."casualDetails" ->> 'orientation' AS orientation,
  p."casualDetails" ->> 'looking_for' AS looking_for,
  p."casualDetails" ->> 'service_type' AS service_type,
  p."casualDetails" AS casual_details_json,
  p."postedAt"
FROM "Post" p
ORDER BY p.id DESC
LIMIT 100;

-- 4) Find posts where phone is missing
SELECT
  p.id,
  p.title,
  p.category,
  p.subcategory,
  p."phoneNumber",
  p."postedAt"
FROM "Post" p
WHERE p."phoneNumber" IS NULL OR BTRIM(p."phoneNumber") = ''
ORDER BY p.id DESC
LIMIT 100;

-- 4b) Phone diagnostics (raw + trimmed length)
SELECT
  p.id,
  p.title,
  p."phoneNumber",
  LENGTH(COALESCE(p."phoneNumber", '')) AS raw_length,
  LENGTH(BTRIM(COALESCE(p."phoneNumber", ''))) AS trimmed_length,
  p."postedAt"
FROM "Post" p
ORDER BY p.id DESC
LIMIT 100;

-- 5) Find posts where orientation/looking_for are missing
SELECT
  p.id,
  p.title,
  p.category,
  p.subcategory,
  p."casualDetails" ->> 'orientation' AS orientation,
  p."casualDetails" ->> 'looking_for' AS looking_for,
  p."postedAt"
FROM "Post" p
WHERE (p."casualDetails" ->> 'orientation') IS NULL
   OR BTRIM(COALESCE(p."casualDetails" ->> 'orientation', '')) = ''
   OR (p."casualDetails" ->> 'looking_for') IS NULL
   OR BTRIM(COALESCE(p."casualDetails" ->> 'looking_for', '')) = ''
ORDER BY p.id DESC
LIMIT 100;

-- 6) Images by post (verify Cloudinary URLs/public IDs)
SELECT
  pi.id,
  pi."postId",
  pi."secureUrl",
  pi.url,
  pi."cloudinaryPublicId",
  pi."displayOrder",
  pi."createdAt"
FROM "PostImage" pi
ORDER BY pi.id DESC
LIMIT 200;

-- 7) Full single post debug by ID (replace 1)
SELECT
  p.*,
  (SELECT COUNT(*) FROM "PostImage" i WHERE i."postId" = p.id) AS image_count
FROM "Post" p
WHERE p.id = 1;

-- 8) Full single post debug by title (replace title text)
SELECT
  p.*,
  (SELECT COUNT(*) FROM "PostImage" i WHERE i."postId" = p.id) AS image_count
FROM "Post" p
WHERE p.title ILIKE '%sample title%'
ORDER BY p.id DESC;

-- 9) Set user role (replace email or ID before running)
-- Option A: Set role by email
UPDATE "User"
SET role = 'ADMIN'
WHERE email = 'your-email@example.com';

-- Option B: Set role by user ID
-- UPDATE "User"
-- SET role = 'ADMIN'
-- WHERE id = 1;

-- Verify role update (replace email)
SELECT
  u.id,
  u.email,
  u.username,
  u.role,
  u."createdAt"
FROM "User" u
WHERE u.email = 'your-email@example.com';
