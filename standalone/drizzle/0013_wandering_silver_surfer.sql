CREATE TABLE `model_checks` (
	`target` text NOT NULL,
	`day` text NOT NULL,
	`checked_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`actual_model` text,
	PRIMARY KEY(`target`, `day`)
);
--> statement-breakpoint
CREATE TABLE `source_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`revision` text NOT NULL,
	`object_key` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_source_projects_owner` ON `source_projects` (`user_id`,`updated_at`);