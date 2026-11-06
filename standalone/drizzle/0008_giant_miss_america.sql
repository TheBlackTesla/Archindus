CREATE TABLE `account_integrations` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`data_version` text NOT NULL,
	`label` text NOT NULL,
	`endpoint_hint` text DEFAULT '' NOT NULL,
	`encrypted_value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integrations_user_provider` ON `account_integrations` (`user_id`,`provider`);