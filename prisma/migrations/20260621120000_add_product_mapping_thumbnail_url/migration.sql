ALTER TABLE "ProductMapping" ADD COLUMN "thumbnailUrl" TEXT;

WITH candidate_urls AS (
  SELECT
    ps."mappingId",
    ps."capturedAt",
    candidate.priority,
    candidate.ordinality,
    candidate.url AS "thumbnailUrl"
  FROM "ProductSnapshot" ps
  CROSS JOIN LATERAL (
    SELECT
      1 AS priority,
      image_url.ordinality,
      image_url.value AS url
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(ps."payload"->'imageUrls') = 'array'
          THEN ps."payload"->'imageUrls'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS image_url(value, ordinality)
    UNION ALL
    SELECT
      2 AS priority,
      media_url.ordinality,
      media_url.value AS url
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(ps."payload"#>'{mediaSync,sourceImageUrls}') = 'array'
          THEN ps."payload"#>'{mediaSync,sourceImageUrls}'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS media_url(value, ordinality)
    UNION ALL
    SELECT 3 AS priority, 1 AS ordinality, ps."payload"->>'imageUrl' AS url
    UNION ALL
    SELECT 4 AS priority, 1 AS ordinality, ps."payload"->>'thumbnailUrl' AS url
    UNION ALL
    SELECT 5 AS priority, 1 AS ordinality, ps."payload"->>'galleryUrl' AS url
    UNION ALL
    SELECT 6 AS priority, 1 AS ordinality, ps."payload"->>'GalleryURL' AS url
  ) AS candidate
  WHERE
    ps."mappingId" IS NOT NULL
    AND candidate.url IS NOT NULL
    AND candidate.url <> ''
    AND candidate.url ~* '^https?://[^[:space:]/?#@:]+(:[0-9]+)?([/?#]|$)'
),
ranked_candidates AS (
  SELECT
    "mappingId",
    "thumbnailUrl",
    row_number() OVER (
      PARTITION BY "mappingId"
      ORDER BY "capturedAt" DESC, priority, ordinality
    ) AS candidate_rank
  FROM candidate_urls
)
UPDATE "ProductMapping" pm
SET "thumbnailUrl" = ranked_candidates."thumbnailUrl"
FROM ranked_candidates
WHERE
  pm.id = ranked_candidates."mappingId"
  AND ranked_candidates.candidate_rank = 1
  AND pm."thumbnailUrl" IS NULL;
