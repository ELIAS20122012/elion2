from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.types import CHAR, TypeDecorator

from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class GUID(TypeDecorator):
    """نوع UUID مستقل از دیتابیس: روی Postgres از نوع native UUID استفاده
    می‌کند، روی بقیه (مثل SQLite -- برای تست لوکال سریع بدون نیاز به
    Postgres/Docker) به‌صورت CHAR(36) ذخیره می‌شود."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID())
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
