SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    nickname TEXT,
    phone TEXT,
    email TEXT UNIQUE,
    department TEXT,
    job_title TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user_a', 'user_b')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN (
        'server', 'network_device', 'database', 'cloud', 'container',
        'application', 'endpoint', 'other'
    )),
    ip_address TEXT,
    hostname TEXT,
    mac_address TEXT,
    operating_system TEXT,
    vendor TEXT,
    model TEXT,
    location TEXT,
    department TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    criticality TEXT NOT NULL CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
    exposure TEXT NOT NULL CHECK (exposure IN ('internet', 'intranet', 'isolated')),
    security_zone TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'offline', 'retired')),
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vuln_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    cve_id TEXT,
    cnnvd_id TEXT,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    cvss_score REAL CHECK (cvss_score IS NULL OR (cvss_score >= 0 AND cvss_score <= 10)),
    vuln_type TEXT,
    source TEXT,
    description TEXT,
    solution TEXT,
    discovered_at TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('no_response', 'responding', 'closed')),
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    source TEXT,
    source_ip TEXT,
    destination_ip TEXT,
    description TEXT,
    occurred_at TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('no_response', 'responding', 'closed')),
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    response_summary TEXT,
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vulnerability_assets (
    vulnerability_id INTEGER NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (vulnerability_id, asset_id)
);

CREATE TABLE IF NOT EXISTS event_assets (
    event_id INTEGER NOT NULL REFERENCES security_events(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_status ON vulnerabilities(status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_events_status ON security_events(status);
CREATE INDEX IF NOT EXISTS idx_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_va_asset ON vulnerability_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_ea_asset ON event_assets(asset_id);
"""
