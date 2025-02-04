ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'MEMBER';--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "role" SET DEFAULT 'MEMBER';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'MEMBER';