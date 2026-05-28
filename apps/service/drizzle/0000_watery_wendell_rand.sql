CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`source_content` text NOT NULL,
	`strategy` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_status` ON `import_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_import_jobs_created_at` ON `import_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`original_url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`source` text NOT NULL,
	`source_order` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`similarity_group` text,
	`duplicate_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_links_status` ON `links` (`status`);--> statement-breakpoint
CREATE INDEX `idx_links_domain` ON `links` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_links_normalized_url` ON `links` (`normalized_url`);--> statement-breakpoint
CREATE INDEX `idx_links_similarity_group` ON `links` (`similarity_group`);--> statement-breakpoint
CREATE INDEX `idx_links_duplicate_of` ON `links` (`duplicate_of`);--> statement-breakpoint
CREATE INDEX `idx_links_created_at` ON `links` (`created_at`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`job_id` text,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL,
	`before_snapshot_hash` text NOT NULL,
	`after_snapshot_hash` text NOT NULL,
	`changes_added` text DEFAULT '[]' NOT NULL,
	`changes_removed` text DEFAULT '[]' NOT NULL,
	`changes_modified` text DEFAULT '[]' NOT NULL,
	`stats_input_count` integer DEFAULT 0 NOT NULL,
	`stats_output_count` integer DEFAULT 0 NOT NULL,
	`stats_duplicate_count` integer,
	`stats_error_count` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_operations_type` ON `operations` (`type`);--> statement-breakpoint
CREATE INDEX `idx_operations_timestamp` ON `operations` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_operations_job_id` ON `operations` (`job_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`link_ids` text NOT NULL,
	`checksum` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_created_at` ON `snapshots` (`created_at`);--> statement-breakpoint
CREATE TABLE `test_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`link_ids` text NOT NULL,
	`method` text NOT NULL,
	`concurrency` integer DEFAULT 10 NOT NULL,
	`proxy_config` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`progress_completed` integer DEFAULT 0 NOT NULL,
	`progress_failed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_test_jobs_status` ON `test_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_test_jobs_created_at` ON `test_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	`response_time` integer,
	`status_code` integer,
	`content_type` text,
	`content_length` integer,
	`proxy_config` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_test_results_link_id` ON `test_results` (`link_id`);--> statement-breakpoint
CREATE INDEX `idx_test_results_method` ON `test_results` (`method`);--> statement-breakpoint
CREATE INDEX `idx_test_results_status` ON `test_results` (`status`);--> statement-breakpoint
CREATE TABLE `users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_email_unique` ON `users_table` (`email`);