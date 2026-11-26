CREATE TABLE `routing_model_metrics` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task` text NOT NULL,
	`day` text NOT NULL,
	`attempts` integer NOT NULL,
	`successes` integer NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`charged` integer NOT NULL,
	`unknown_usage` integer NOT NULL,
	PRIMARY KEY(`provider`, `model`, `task`, `day`)
);
