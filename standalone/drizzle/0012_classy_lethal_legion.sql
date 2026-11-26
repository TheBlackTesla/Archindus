CREATE TABLE `routing_quality_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`arm` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_quality_result_run` ON `routing_quality_results` (`run_id`);--> statement-breakpoint
CREATE TABLE `routing_quality_trials` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`suite` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quality_trial_day` ON `routing_quality_trials` (`day`);