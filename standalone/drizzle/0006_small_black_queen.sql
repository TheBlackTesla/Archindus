ALTER TABLE `account_personalities` ADD `node_slot` integer;--> statement-breakpoint
WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at,id)-1 AS slot FROM account_personalities) UPDATE account_personalities SET node_slot=(SELECT slot FROM ranked WHERE ranked.id=account_personalities.id) WHERE node_slot IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_personality_user_slot` ON `account_personalities` (`user_id`,`node_slot`);