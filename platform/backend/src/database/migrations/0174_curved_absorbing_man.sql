-- Step 1: Rename name → slug
ALTER TABLE "internal_mcp_catalog" RENAME COLUMN "name" TO "slug";--> statement-breakpoint

-- Step 2: Add display_name column as nullable first, then populate, then set NOT NULL
ALTER TABLE "internal_mcp_catalog" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "internal_mcp_catalog" SET "display_name" = "slug";--> statement-breakpoint
ALTER TABLE "internal_mcp_catalog" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint

-- Step 3: Deduplicate slugs before adding unique constraint.
-- For each group of rows sharing the same slug, keep the oldest row's slug unchanged
-- and append a short ID suffix only to the newer duplicates.
-- Rows with unique slugs are not affected.
UPDATE "internal_mcp_catalog" SET "slug" = "slug" || '-' || LEFT("id"::text, 4)
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "slug" ORDER BY "created_at" ASC) AS rn
    FROM "internal_mcp_catalog"
  ) ranked WHERE rn > 1
);--> statement-breakpoint

-- Step 4: Now safe to add unique constraint
ALTER TABLE "internal_mcp_catalog" ADD CONSTRAINT "internal_mcp_catalog_slug_unique" UNIQUE("slug");
