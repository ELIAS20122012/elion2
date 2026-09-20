from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr

from .models import Platform, TradeDirection, TradeStatus


# ---- Auth ----

class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---- Accounts ----

class AccountCreate(BaseModel):
    label: str
    platform: Platform
    broker: Optional[str] = None
    account_number: Optional[str] = None


class AccountCreated(BaseModel):
    id: str
    label: str
    platform: Platform
    api_key: str  # plaintext, shown once at creation time only


class AccountOut(BaseModel):
    id: str
    label: str
    platform: Platform
    broker: Optional[str]
    account_number: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


# ---- Ingest events (sent by the EA) ----

class TradeEvent(BaseModel):
    ticket: str
    symbol: str
    direction: TradeDirection
    volume: float

    open_time: datetime
    open_price: float
    close_time: Optional[datetime] = None
    close_price: Optional[float] = None

    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None

    profit: Optional[float] = None
    commission: Optional[float] = None
    swap: Optional[float] = None

    status: TradeStatus
    strategy_tag: Optional[str] = None
    comment: Optional[str] = None


class SnapshotEvent(BaseModel):
    timestamp: datetime
    balance: float
    equity: float
    margin: Optional[float] = None
    free_margin: Optional[float] = None
    margin_level: Optional[float] = None


class HeartbeatEvent(BaseModel):
    ea_version: Optional[str] = None
    terminal_info: Optional[str] = None


# ---- Read models for the dashboard ----

class TradeOut(BaseModel):
    id: str
    ticket: str
    symbol: str
    direction: TradeDirection
    volume: float
    open_time: datetime
    open_price: float
    close_time: Optional[datetime]
    close_price: Optional[float]
    profit: Optional[float]
    commission: Optional[float]
    swap: Optional[float]
    status: TradeStatus
    strategy_tag: Optional[str]

    class Config:
        from_attributes = True


class EquityPoint(BaseModel):
    timestamp: datetime
    balance: float
    equity: float


class CandleIn(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float


class SignalEvaluateRequest(BaseModel):
    candles: list[CandleIn]


class SignalOut(BaseModel):
    setup_family: str
    direction: str
    entry: float
    stop_loss: float
    take_profit: float
    reason: str
    age_candles: int = 0


class CandleOut(BaseModel):
    time: datetime
    open: float
    high: float
    low: float
    close: float

    class Config:
        from_attributes = True


class SetupStateOut(BaseModel):
    state: str
    updated_at: Optional[datetime]
    level_price: Optional[float]
    signal: Optional[SignalOut]
    notes: list[str]


class SummaryOut(BaseModel):
    total_trades: int
    closed_trades: int
    open_trades: int
    win_rate: Optional[float]
    profit_factor: Optional[float]
    expectancy: Optional[float]
    net_profit: float
    max_drawdown: Optional[float]
    max_drawdown_pct: Optional[float]
    last_heartbeat: Optional[datetime]


class SymbolBreakdown(BaseModel):
    symbol: str
    trades: int
    win_rate: Optional[float]
    net_profit: float


class BreakdownOut(BaseModel):
    by_symbol: list[SymbolBreakdown]
    current_streak: int
    max_win_streak: int
    max_loss_streak: int
    best_trade: Optional[float]
    worst_trade: Optional[float]
