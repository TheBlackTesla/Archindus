CREATE TABLE `account_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`messages` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversation_user_updated` ON `account_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `account_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memory_user` ON `account_memories` (`user_id`);--> statement-breakpoint
CREATE TABLE `account_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`memory_enabled` integer DEFAULT 1 NOT NULL,
	`history_enabled` integer DEFAULT 1 NOT NULL,
	`model_policy` text DEFAULT 'auto' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
