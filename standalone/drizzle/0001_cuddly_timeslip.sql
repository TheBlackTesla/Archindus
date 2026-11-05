CREATE TABLE IF NOT EXISTS `inference_provider_state` (
	`provider` text PRIMARY KEY NOT NULL,
	`unavailable_until` integer NOT NULL
);
