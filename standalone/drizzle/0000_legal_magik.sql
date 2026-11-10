CREATE TABLE `inference_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`month` text NOT NULL,
	`client` text NOT NULL,
	`kind` text NOT NULL,
	`reserved` integer NOT NULL,
	`charged` integer NOT NULL,
	`created_at` integer NOT NULL,
	`active_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_month` ON `inference_usage` (`month`);--> statement-breakpoint
CREATE INDEX `idx_usage_day_client_kind` ON `inference_usage` (`day`,`client`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_usage_created` ON `inference_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_active` ON `inference_usage` (`active_until`);