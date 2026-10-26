INSERT OR IGNORE INTO events (id, year, name_th, name_en, status)
VALUES ('tte-2027', 2027, 'TTE 2027', 'TTE 2027', 'draft');

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('exhibitor_portal_enabled', 'false'),
  ('visitor_map_enabled', 'false'),
  ('backup_retention_days', '30'),
  ('active_event_id', 'tte-2027');
