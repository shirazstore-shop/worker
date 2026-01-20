PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE tracking_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	order_id INTEGER NOT NULL,
	package_id INTEGER DEFAULT 0,
	date TEXT,
	location TEXT,
	description TEXT,
	created_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'pending', timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);
