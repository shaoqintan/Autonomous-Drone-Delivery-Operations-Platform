CREATE TABLE `issue_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` text NOT NULL,
	`channel` text NOT NULL,
	`sender_name` text NOT NULL,
	`sender_role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issue_tickets`(`issue_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_messages_issue_id_idx` ON `issue_messages` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_tickets` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`owner` text DEFAULT 'Unassigned' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text
);
