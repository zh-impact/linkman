DROP TABLE `users_table`;--> statement-breakpoint
ALTER TABLE `links` ADD `url_path` text;--> statement-breakpoint
ALTER TABLE `links` ADD `url_query` text;--> statement-breakpoint
ALTER TABLE `links` ADD `url_hash` text;--> statement-breakpoint
CREATE INDEX `idx_links_url_path` ON `links` (`url_path`);--> statement-breakpoint
CREATE INDEX `idx_links_url_query` ON `links` (`url_query`);--> statement-breakpoint
CREATE INDEX `idx_links_url_hash` ON `links` (`url_hash`);