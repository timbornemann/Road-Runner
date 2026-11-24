"""Schema and reference cleanup for the per-trip planning notebook."""


def migrate(con):
    # Execute statements individually within the surrounding migration transaction.
    statements = (
        """CREATE TABLE IF NOT EXISTS notebook_topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE,
            parent_id INTEGER REFERENCES notebook_topics ON DELETE CASCADE,
            title TEXT NOT NULL, position INTEGER NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS topic_siblings ON notebook_topics(trip_id,parent_id,position)",
        """CREATE TABLE IF NOT EXISTS notebook_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE,
            topic_id INTEGER NOT NULL REFERENCES notebook_topics ON DELETE CASCADE,
            title TEXT NOT NULL, body TEXT NOT NULL, position INTEGER NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1)""",
        "CREATE INDEX IF NOT EXISTS notes_by_topic ON notebook_notes(trip_id,topic_id,position)",
        """CREATE TABLE IF NOT EXISTS notebook_areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE, name TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS notebook_area_stops (
            area_id INTEGER NOT NULL REFERENCES notebook_areas ON DELETE CASCADE,
            stop_id INTEGER NOT NULL REFERENCES records ON DELETE CASCADE,
            position INTEGER NOT NULL, PRIMARY KEY(area_id,stop_id))""",
        "CREATE INDEX IF NOT EXISTS notebook_areas_by_stop ON notebook_area_stops(stop_id)",
        """CREATE TABLE IF NOT EXISTS notebook_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips ON DELETE CASCADE,
            source_type TEXT NOT NULL CHECK(source_type IN ('topic','note')), source_id INTEGER NOT NULL,
            target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
            UNIQUE(trip_id,source_type,source_id,target_type,target_id))""",
        "CREATE INDEX IF NOT EXISTS notebook_links_by_target ON notebook_links(target_type,target_id)",
        "CREATE INDEX IF NOT EXISTS notebook_links_by_source ON notebook_links(source_type,source_id)",
    )
    for sql in statements:
        con.execute(sql)

    # Typed links refer to several tables. Triggers also catch indirect deletes, e.g. a ferry's
    # linked expense being removed, or a stage's variants cascading with their parent.
    for kind, table in (("topic", "notebook_topics"), ("note", "notebook_notes"), ("area", "notebook_areas"),
                        ("stage", "stages"), ("variant", "stage_variants"), ("journal", "journal_entries")):
        source = f" OR (source_type='{kind}' AND source_id=OLD.id)" if kind in ("topic", "note") else ""
        con.execute(f"""CREATE TRIGGER IF NOT EXISTS clean_notebook_{kind} AFTER DELETE ON {table} BEGIN
            DELETE FROM notebook_links WHERE (target_type='{kind}' AND target_id=OLD.id){source};
            END""")
    con.execute("""CREATE TRIGGER IF NOT EXISTS clean_notebook_record AFTER DELETE ON records BEGIN
        DELETE FROM notebook_links WHERE target_id=OLD.id
        AND target_type IN ('stop','purchase','pantry','shopping','mobility','expense');
        END""")
