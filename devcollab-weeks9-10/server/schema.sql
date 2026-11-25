CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_public  BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_files (
  id         SERIAL PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  content    TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, filename)
);

CREATE TABLE IF NOT EXISTS code_flags (
  id          SERIAL PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  line_number INT  NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_by  TEXT REFERENCES users(id),
  assigned_to TEXT REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS flag_comments (
  id         SERIAL PRIMARY KEY,
  flag_id    INT REFERENCES code_flags(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  flag_id    INT REFERENCES code_flags(id) ON DELETE CASCADE,
  project_id TEXT,
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flags_project  ON code_flags(project_id);
CREATE INDEX IF NOT EXISTS idx_flags_assigned ON code_flags(assigned_to);
CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, is_read);