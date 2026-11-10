CREATE TABLE `media_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`width` integer NOT NULL,
	`status` text NOT NULL,
	`reservation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`artifact_json` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_user_created` ON `media_jobs` (`user_id`,`created_at`);