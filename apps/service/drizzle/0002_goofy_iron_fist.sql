ALTER TABLE `import_jobs` ADD `file_mtime` text;--> statement-breakpoint
ALTER TABLE `import_jobs` ADD `is_reparse` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `links` ADD `source_file` text;--> statement-breakpoint
CREATE INDEX `idx_links_source_file` ON `links` (`source_file`);