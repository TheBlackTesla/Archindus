CREATE TABLE `voice_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`month` text NOT NULL,
	`characters` integer NOT NULL,
	`created_at` integer NOT NULL,
	`active_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_voice_day` ON `voice_usage` (`day`);--> statement-breakpoint
CREATE INDEX `idx_voice_month` ON `voice_usage` (`month`);--> statement-breakpoint
CREATE INDEX `idx_voice_user_created` ON `voice_usage` (`user_id`,`created_at`);