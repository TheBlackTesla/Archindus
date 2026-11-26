CREATE TABLE `routing_policy_shadow` (
	`day` text NOT NULL,
	`task` text NOT NULL,
	`champion` text NOT NULL,
	`challenger` text NOT NULL,
	`decisions` integer NOT NULL,
	`disagreements` integer NOT NULL,
	PRIMARY KEY(`day`, `task`, `champion`, `challenger`)
);
