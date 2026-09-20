import enum
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import relationship

from .database import Base, GUID


def gen_uuid():
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    owner = "owner"
    student = "student"


class User(Base):
    __tablename__ = "users"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.owner)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    accounts = relationship("Account", back_populates="owner", cascade="all, delete-orphan")


class Platform(str, enum.Enum):
    mt4 = "mt4"
    mt5 = "mt5"


class Account(Base):
    """A single MT4/MT5 trading account being tracked."""

    __tablename__ = "accounts"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    owner_id = Column(GUID(), ForeignKey("users.id"), nullable=False)
    label = Column(String, nullable=False)
    platform = Column(Enum(Platform), nullable=False)
    broker = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    api_key_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="accounts")
    trades = relationship("Trade", back_populates="account", cascade="all, delete-orphan")
    snapshots = relationship("Snapshot", back_populates="account", cascade="all, delete-orphan")


class TradeDirection(str, enum.Enum):
    buy = "buy"
    sell = "sell"


class TradeStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class Trade(Base):
    __tablename__ = "trades"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    account_id = Column(GUID(), ForeignKey("accounts.id"), nullable=False, index=True)

    ticket = Column(String, nullable=False, index=True)
    symbol = Column(String, nullable=False, index=True)
    direction = Column(Enum(TradeDirection), nullable=False)
    volume = Column(Float, nullable=False)

    open_time = Column(DateTime(timezone=True), nullable=False)
    open_price = Column(Float, nullable=False)
    close_time = Column(DateTime(timezone=True), nullable=True)
    close_price = Column(Float, nullable=True)

    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)

    profit = Column(Float, nullable=True)
    commission = Column(Float, nullable=True)
    swap = Column(Float, nullable=True)

    status = Column(Enum(TradeStatus), nullable=False, default=TradeStatus.open)
    strategy_tag = Column(String, nullable=True)
    comment = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    account = relationship("Account", back_populates="trades")


class Snapshot(Base):
    """Periodic balance/equity snapshot reported by the EA, used to build the equity curve."""

    __tablename__ = "snapshots"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    account_id = Column(GUID(), ForeignKey("accounts.id"), nullable=False, index=True)

    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    balance = Column(Float, nullable=False)
    equity = Column(Float, nullable=False)
    margin = Column(Float, nullable=True)
    free_margin = Column(Float, nullable=True)
    margin_level = Column(Float, nullable=True)

    account = relationship("Account", back_populates="snapshots")


class PriceCandle(Base):
    """کندل‌های M1 که EA برای تحلیل ستاپ می‌فرستد -- برای نمایش چارت زنده در
    داشبورد نگه داشته می‌شوند (فقط آخرین چند صد تا، نه کل تاریخچه)."""

    __tablename__ = "price_candles"

    account_id = Column(GUID(), ForeignKey("accounts.id"), primary_key=True)
    time = Column(DateTime(timezone=True), primary_key=True)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)


class Heartbeat(Base):
    """Last-seen ping from each EA, used to show connection status on the dashboard."""

    __tablename__ = "heartbeats"

    account_id = Column(GUID(), ForeignKey("accounts.id"), primary_key=True)
    last_seen = Column(DateTime(timezone=True), nullable=False)
    ea_version = Column(String, nullable=True)
    terminal_info = Column(String, nullable=True)


class SetupSnapshot(Base):
    """آخرین نتیجهٔ موتور تشخیص ستاپ لول برای هر حساب -- برای نمایش در داشبورد.

    فقط تشخیص است، نه سفارش. جزئیات کامل (level/notes) به‌صورت JSON متنی
    ذخیره می‌شود چون ساختارشان بین نسخه‌های موتور ممکن است تغییر کند."""

    __tablename__ = "setup_snapshots"

    account_id = Column(GUID(), ForeignKey("accounts.id"), primary_key=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    state = Column(String, nullable=False)
    level_price = Column(Float, nullable=True)
    signal_direction = Column(String, nullable=True)
    signal_entry = Column(Float, nullable=True)
    signal_stop_loss = Column(Float, nullable=True)
    signal_take_profit = Column(Float, nullable=True)
    signal_reason = Column(String, nullable=True)
    notes_json = Column(String, nullable=True)
