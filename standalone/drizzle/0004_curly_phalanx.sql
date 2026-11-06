CREATE TABLE `account_personalities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`instructions` text NOT NULL,
	`capability` text NOT NULL,
	`model_policy` text DEFAULT 'inherit' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_personality_user` ON `account_personalities` (`user_id`);