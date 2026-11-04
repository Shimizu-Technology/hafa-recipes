"""Explicit expand/contract forms accepted until the family schema freeze (F11)."""

from dataclasses import dataclass

from sqlalchemy import CheckConstraint, text


@dataclass(frozen=True)
class ColumnForm:
    udt: str
    nullable: bool
    delete_action: str | None = None


SPACE_TABLES = (
    "baby_children", "baby_records", "baby_attachments", "baby_imports",
    "baby_conversations", "baby_messages", "baby_share_credentials", "baby_share_captures",
)
CREATOR_TABLES = ("baby_children", "baby_records", "baby_attachments")
# None means absent, not an arbitrary column shape. UUID space references cascade
# with their space; creator IDs are never rewritten by the family migration.
ALLOWED_FORMS = {
    name: {"space_id": (None, ColumnForm("uuid", True, "CASCADE"), ColumnForm("uuid", False, "CASCADE"))}
    for name in SPACE_TABLES
}
for name in CREATOR_TABLES:
    ALLOWED_FORMS[name]["app_user_id"] = (
        ColumnForm("varchar", False, "CASCADE"),
        ColumnForm("varchar", True, "SET NULL"),
    )


async def schema_complete(connection, *, tables, allowed_forms):
    """Require mapped columns and invariants, allowing only named transitional forms."""
    for table in tables:
        columns = {
            row[0]: (row[1], row[2] == "YES")
            for row in (
                await connection.execute(
                    text("""SELECT column_name,udt_name,is_nullable FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=:name"""),
                    {"name": table.name},
                )
            ).all()
        }
        contract = allowed_forms.get(table.name, {})
        required = {}
        for column in table.columns:
            expected = {
                "VARCHAR": "varchar", "TEXT": "text", "INTEGER": "int4",
                "UUID": "uuid", "JSONB": "jsonb", "DATE": "date", "DATETIME": "timestamptz",
                "BIGINT": "int8", "BOOLEAN": "bool",
            }.get(str(column.type))
            if str(column.type).startswith("VARCHAR"):
                expected = "varchar"
            delete_action = (
                next(iter(column.foreign_keys)).ondelete
                if column.name in {"app_user_id", "space_id"}
                else None
            )
            required[column.name] = (ColumnForm(expected, column.nullable, delete_action),)
        for name, forms in (required | contract).items():
            actual = columns.get(name)
            matches = [form for form in forms if form is not None and actual == (form.udt, form.nullable)]
            if actual is None:
                if None in forms:
                    continue
                return False
            if not matches:
                return False
            if name not in {"app_user_id", "space_id"}:
                continue
            # Require exactly one validated FK for this column, including its
            # target and action. An extra conflicting FK must not silently pass.
            foreign_keys = (
                await connection.execute(
                    text("""SELECT pg_get_constraintdef(c.oid), c.convalidated FROM pg_constraint c
                    WHERE c.conrelid=to_regclass(:table) AND c.contype='f'
                    AND :column = ANY(SELECT a.attname FROM pg_attribute a
                        WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey))"""),
                    {"table": "public." + table.name, "column": name},
                )
            ).all()
            target = "app_users" if name == "app_user_id" else "baby_spaces"
            if not any(
                [tuple(row) for row in foreign_keys] == [(
                    f"FOREIGN KEY ({name}) REFERENCES {target}(id) ON DELETE "
                    + form.delete_action, True,
                )]
                for form in matches
            ):
                return False
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint) and constraint.name:
                if not await connection.scalar(
                    text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
                    WHERE conrelid=to_regclass(:table) AND conname=:name AND contype='c' AND convalidated)"""),
                    {"table": "public." + table.name, "name": constraint.name},
                ):
                    return False
        for index in table.indexes:
            if not await connection.scalar(
                text("""SELECT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                WHERE i.indrelid=to_regclass(:table) AND c.relname=:name AND i.indisvalid)"""),
                {"table": "public." + table.name, "name": index.name},
            ):
                return False
        primary = [column.name for column in table.primary_key.columns]
        if not await connection.scalar(
            text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
            WHERE conrelid=to_regclass(:table) AND contype='p'
            AND pg_get_constraintdef(oid)=:definition)"""),
            {
                "table": "public." + table.name,
                "definition": "PRIMARY KEY (" + ", ".join(primary) + ")",
            },
        ):
            return False
    return True
