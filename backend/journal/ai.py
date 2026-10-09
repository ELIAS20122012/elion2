"""AI Lab analysis: one read-only endpoint in front of two providers (Gemini and Claude).

    GET  /ai/providers   which providers exist and whether their key is configured on this PC
    POST /ai/analyze     analyse the data the user explicitly chose to share, with the chosen provider

What this module will and will not do
- Read-only. It never imports or calls anything that places, modifies or closes an order
  (the order-sending function and route are not reachable from here; tests check this). The
  model only receives data and returns text; nothing it says is executed.
- Only data the user ticked in AI Lab is sent: rules, journal trades, the MT5 account snapshot,
  MT5 candles, and chart images they attached. Anything that cannot be read is reported back
  in `notes` instead of being filled in.
- API keys are read from the environment at call time (GEMINI_API_KEY, ANTHROPIC_API_KEY), sent
  only in request headers, never returned, never logged, and scrubbed from any error text.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from . import bridge, db

# ---------------------------------------------------------------------------------------------
# errors -> HTTP status (the route turns these into HTTPException; the UI maps the status)
# ---------------------------------------------------------------------------------------------


class AIError(Exception):
    status = 502
    code = "error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ProviderUnavailable(AIError):
    """No key configured, or an unknown provider id."""
    status = 503
    code = "unavailable"


class ProviderTimeout(AIError):
    status = 504
    code = "timeout"


class ProviderFailed(AIError):
    """The provider answered with an error (bad key, quota, overload, blocked content...)."""
    status = 502
    code = "upstream_error"


class ProviderBusy(ProviderFailed):
    """Overloaded / rate limited even after retrying. Gemini then tries its fallback model."""


class BadResponse(AIError):
    """The provider answered, but not with the structured analysis we asked for."""
    status = 502
    code = "bad_response"


class BadRequest(AIError):
    status = 422
    code = "bad_request"


# ---------------------------------------------------------------------------------------------
# request / response shapes
# ---------------------------------------------------------------------------------------------

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 4 * 1024 * 1024
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
TF_SECONDS = {"M1": 60, "M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "H4": 14400, "D1": 86400}


class RuleIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(max_length=300)
    hint: str = Field(default="", max_length=1000)
    status: str = Field(default="", max_length=30)


class ImageIn(BaseModel):
    mime: str
    data: str = Field(description="base64, no data: prefix")
    label: str = Field(default="chart", max_length=120)


class ShareIn(BaseModel):
    """What the user approved for this one request. Everything defaults to off."""
    rules: bool = False
    trades: bool = False
    mt5_account: bool = False
    market: bool = False


class AnalyzeIn(BaseModel):
    provider: str = Field(min_length=1, max_length=20)
    question: str = Field(min_length=1, max_length=4000)
    account_id: int | None = None
    share: ShareIn = ShareIn()
    rules: list[RuleIn] = Field(default_factory=list, max_length=50)
    images: list[ImageIn] = Field(default_factory=list)
    symbol: str = Field(default="XAUUSD", max_length=20)
    timeframe: str = Field(default="H1")
    max_trades: int = Field(default=100, ge=1, le=300)
    candles: int = Field(default=200, ge=20, le=500)


class RuleCheck(BaseModel):
    rule: str
    status: Literal["met", "not_met", "unclear", "not_applicable"]
    evidence: str = ""


class Analysis(BaseModel):
    summary: str
    market_bias: Literal["bullish", "bearish", "neutral", "unclear"] = "unclear"
    rule_checks: list[RuleCheck] = Field(default_factory=list)
    observations: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    data_gaps: list[str] = Field(default_factory=list)


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "2-5 sentence answer to the user's question"},
        "market_bias": {"type": "string", "enum": ["bullish", "bearish", "neutral", "unclear"]},
        "rule_checks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rule": {"type": "string"},
                    "status": {"type": "string", "enum": ["met", "not_met", "unclear", "not_applicable"]},
                    "evidence": {"type": "string"},
                },
                "required": ["rule", "status", "evidence"],
            },
        },
        "observations": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "next_steps": {"type": "array", "items": {"type": "string"}},
        "data_gaps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "market_bias", "rule_checks", "observations", "risks", "next_steps", "data_gaps"],
}

SYSTEM_PROMPT = f"""You are the analysis assistant inside ELION AI Lab, a personal trading journal.
You help one discretionary trader review his own data. Follow these rules strictly:
- Use ONLY the data in the CONTEXT block and the attached images. Never invent prices, levels, trades,
  statistics, news or scores. If something needed is missing, say so in "data_gaps".
- Do not state numeric confidence scores or probabilities.
- You cannot place, modify, close or delete trades and must never tell the user that you did or will.
  Any trade idea is a suggestion for the human to verify under his own risk rules.
- Judge the setup against the trader's own rules when rules are provided; mark a rule "unclear" when the
  data does not show it either way.
- Answer in the same language as the user's question.
- Reply with ONE JSON object only, no markdown, matching this JSON schema:
{json.dumps(ANALYSIS_SCHEMA)}"""


# ---------------------------------------------------------------------------------------------
# key handling
# ---------------------------------------------------------------------------------------------


def _user_env_windows(name: str) -> str | None:
    """The saved Windows user variable (HKCU\\Environment), read fresh on every call.

    A process only gets the environment that existed when it (or its parent) started, so a key added
    after the services were launched - or while Windows kept an old copy - would otherwise stay invisible
    until a sign-out. Reading the saved value directly means a new or changed key works right away."""
    if os.name != "nt":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            v, _ = winreg.QueryValueEx(k, name)
        return str(v).strip() or None
    except OSError:
        return None


def _key(env_name: str) -> str | None:
    # the saved user variable wins, so changing/rotating the key never needs a restart or sign-out;
    # the process environment is the fallback (tests, other systems, keys set only for one session)
    return _user_env_windows(env_name) or os.environ.get(env_name, "").strip() or None


def scrub(text: str) -> str:
    """Remove any configured key from text that might be shown or logged."""
    for name in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY"):
        k = _key(name)
        if k:
            text = text.replace(k, "***")
    return re.sub(r"(AIza[0-9A-Za-z_\-]{20,}|sk-ant-[0-9A-Za-z_\-]{10,})", "***", text)


BUSY_STATUS = {429, 500, 502, 503, 504}
RETRY_DELAYS = (2.0, 5.0)  # seconds between attempts when the provider says it is busy
_sleep = time.sleep  # tests replace this


def _timeout() -> float:
    try:
        return max(5.0, min(float(os.environ.get("AI_TIMEOUT_SECONDS", "60")), 180.0))
    except ValueError:
        return 60.0


# ---------------------------------------------------------------------------------------------
# providers
# ---------------------------------------------------------------------------------------------


@dataclass
class Prompt:
    system: str
    text: str
    images: list[tuple[str, str]]  # (mime, base64)


PostFn = Callable[..., httpx.Response]


def _post(url: str, *, headers: dict, json_body: dict, timeout: float) -> httpx.Response:
    with httpx.Client(timeout=timeout) as c:
        return c.post(url, headers=headers, json=json_body)


class Provider:
    id: str
    label: str
    env_key: str
    env_model: str
    default_model: str

    def __init__(self, post: PostFn | None = None):
        self._post = post or _post
        self.used_model: str | None = None  # the model that actually answered (Gemini may fall back)

    @property
    def model(self) -> str:
        return os.environ.get(self.env_model, "").strip() or self.default_model

    def status(self) -> dict:
        ok = _key(self.env_key) is not None
        return {"id": self.id, "label": self.label, "model": self.model, "available": ok,
                "reason": None if ok else f"{self.env_key} is not set on the journal server"}

    def _require_key(self) -> str:
        k = _key(self.env_key)
        if not k:
            raise ProviderUnavailable(f"{self.label} is not configured: set {self.env_key} on the PC that runs the journal server, then restart it.")
        return k

    def _send(self, url: str, headers: dict, body: dict) -> dict:
        """POST with a short retry on "busy" answers (429 / 500 / 502 / 503 / 504), inside the overall timeout."""
        deadline = time.monotonic() + _timeout()
        for attempt in range(len(RETRY_DELAYS) + 1):
            left = deadline - time.monotonic()
            if left <= 1:
                raise ProviderTimeout(f"{self.label} did not answer within {int(_timeout())} s.")
            try:
                r = self._post(url, headers=headers, json_body=body, timeout=left)
            except httpx.TimeoutException:
                raise ProviderTimeout(f"{self.label} did not answer within {int(_timeout())} s.")
            except httpx.HTTPError as e:
                raise ProviderFailed(scrub(f"Could not reach {self.label}: {type(e).__name__}"))
            busy = r.status_code in BUSY_STATUS
            if busy and attempt < len(RETRY_DELAYS) and deadline - time.monotonic() > RETRY_DELAYS[attempt] + 5:
                _sleep(RETRY_DELAYS[attempt])
                continue
            break
        if r.status_code >= 400:
            err = ProviderBusy if r.status_code in BUSY_STATUS else ProviderFailed
            raise err(scrub(f"{self.label} returned HTTP {r.status_code}: {_error_text(r)}"))
        try:
            return r.json()
        except ValueError:
            raise BadResponse(f"{self.label} returned a non-JSON response.")

    def generate(self, p: Prompt) -> str:  # pragma: no cover - overridden
        """The model's raw text answer."""
        raise NotImplementedError

    def analyze(self, p: Prompt) -> Analysis:
        return parse_analysis(self.generate(p), self.label)

    def structured(self, p: Prompt, model: type[BaseModel]) -> BaseModel:
        """The answer parsed into any pydantic model (used by the signal review in journal/signals.py)."""
        return parse_json(self.generate(p), model, self.label)


def _error_text(r: httpx.Response) -> str:
    try:
        j = r.json()
        err = j.get("error") if isinstance(j, dict) else None
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
    except ValueError:
        pass
    return {400: "bad request", 401: "invalid API key", 403: "permission denied", 404: "model not found",
            429: "rate limit or quota exceeded", 500: "provider error", 503: "provider overloaded"}.get(r.status_code, "request failed")


def parse_analysis(text: str, label: str) -> Analysis:
    return parse_json(text, Analysis, label)  # type: ignore[return-value]


def parse_json(text: str, model: type[BaseModel], label: str) -> BaseModel:
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    if not s.startswith("{"):
        a, b = s.find("{"), s.rfind("}")
        s = s[a:b + 1] if a != -1 and b > a else s
    try:
        return model.model_validate(json.loads(s))
    except (ValueError, ValidationError):
        raise BadResponse(f"{label} did not return the structured analysis format. Try again.")


class GeminiProvider(Provider):
    id = "gemini"
    label = "Gemini"
    env_key = "GEMINI_API_KEY"
    env_model = "GEMINI_MODEL"
    default_model = "gemini-3.8-flash"
    base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    @property
    def fallback_model(self) -> str | None:
        v = os.environ.get("GEMINI_FALLBACK_MODEL")
        v = self.default_fallback if v is None else v.strip()
        return v or None if v != self.model else None

    default_fallback = "gemini-3.7-flash"

    def generate(self, p: Prompt) -> str:
        try:
            return self._generate(p, self.model)
        except ProviderBusy as busy:
            fb = self.fallback_model
            if not fb:
                raise
            try:
                return self._generate(p, fb)
            except ProviderBusy:
                raise busy

    def _generate(self, p: Prompt, model: str) -> str:
        key = self._require_key()
        parts: list[dict] = [{"inline_data": {"mime_type": m, "data": d}} for m, d in p.images]
        parts.append({"text": p.text})
        body = {
            "systemInstruction": {"parts": [{"text": p.system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
        }
        # the key travels in a header, never in the URL (URLs end up in logs and error messages)
        j = self._send(f"{self.base_url}/{model}:generateContent", {"x-goog-api-key": key, "content-type": "application/json"}, body)
        self.used_model = model
        cands = j.get("candidates") or []
        if not cands:
            reason = (j.get("promptFeedback") or {}).get("blockReason")
            raise ProviderFailed(f"Gemini returned no answer{f' (blocked: {reason})' if reason else ''}.")
        return "".join(pt.get("text", "") for pt in (cands[0].get("content") or {}).get("parts", []) if not pt.get("thought"))


class ClaudeProvider(Provider):
    id = "claude"
    label = "Claude"
    env_key = "ANTHROPIC_API_KEY"
    env_model = "ANTHROPIC_MODEL"
    default_model = "claude-sonnet-5"
    url = "https://api.anthropic.com/v1/messages"

    def generate(self, p: Prompt) -> str:
        key = self._require_key()
        content: list[dict] = [{"type": "image", "source": {"type": "base64", "media_type": m, "data": d}} for m, d in p.images]
        content.append({"type": "text", "text": p.text})
        body = {"model": self.model, "max_tokens": 4096, "system": p.system, "messages": [{"role": "user", "content": content}]}
        j = self._send(self.url, {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}, body)
        self.used_model = self.model
        text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
        if j.get("stop_reason") == "refusal":
            raise ProviderFailed("Claude declined to answer this request.")
        return text


PROVIDERS: dict[str, type[Provider]] = {"gemini": GeminiProvider, "claude": ClaudeProvider}


def get_provider(pid: str, post: PostFn | None = None) -> Provider:
    cls = PROVIDERS.get(pid)
    if not cls:
        raise ProviderUnavailable(f"Unknown AI provider '{pid}'.")
    return cls(post)


def providers_status() -> list[dict]:
    return [cls().status() for cls in PROVIDERS.values()]


# ---------------------------------------------------------------------------------------------
# context: only what the user shared, only real data
# ---------------------------------------------------------------------------------------------


def _iso(t) -> str | None:
    return datetime.fromtimestamp(int(t), timezone.utc).strftime("%Y-%m-%d %H:%M") if t else None


def _validate_images(images: list[ImageIn]) -> list[tuple[str, str]]:
    if len(images) > MAX_IMAGES:
        raise BadRequest(f"At most {MAX_IMAGES} chart images per request.")
    out = []
    for im in images:
        if im.mime not in IMAGE_TYPES:
            raise BadRequest(f"Image type {im.mime} is not supported (PNG, JPEG or WebP).")
        try:
            raw = base64.b64decode(im.data, validate=True)
        except ValueError:
            raise BadRequest("An attached image is not valid base64.")
        if len(raw) > MAX_IMAGE_BYTES:
            raise BadRequest("An attached image is larger than 4 MB.")
        out.append((im.mime, im.data))
    return out


def build_context(b: AnalyzeIn, candles_fn: Callable | None = None) -> tuple[dict, list[str]]:
    """Returns (context sent to the model, notes for the user about what could not be included)."""
    ctx: dict = {"symbol": b.symbol, "timeframe": b.timeframe, "generated_at_utc": _iso(time.time())}
    notes: list[str] = []

    if b.share.rules:
        if b.rules:
            with db.db() as con:
                labels = {r["rule"]: (r["ok"], r["bad"]) for r in con.execute(
                    "SELECT rule, SUM(label='ok') ok, SUM(label='bad') bad FROM rule_labels GROUP BY rule")}
            ctx["rules"] = [{**r.model_dump(), "chart_examples_marked_valid": labels.get(r.id, (0, 0))[0] or 0,
                             "chart_examples_marked_invalid": labels.get(r.id, (0, 0))[1] or 0} for r in b.rules]
        else:
            notes.append("Rules were shared but the rule book is empty.")

    need_account = b.share.trades or b.share.mt5_account or b.share.market
    acc = None
    if need_account:
        if b.account_id is None:
            notes.append("No journal account is selected, so trades and MT5 data were not included.")
        else:
            with db.db() as con:
                acc = con.execute("SELECT * FROM accounts WHERE id=?", (b.account_id,)).fetchone()
                if acc is None:
                    notes.append("The selected account no longer exists.")
                elif b.share.trades:
                    rows = con.execute(
                        """SELECT t.*, n.setup_valid, n.setup_id, n.emotion, n.error, n.note FROM trades t
                           LEFT JOIN trade_notes n ON n.trade_id=t.id WHERE t.account_id=? ORDER BY t.open_time DESC LIMIT ?""",
                        (b.account_id, b.max_trades)).fetchall()
                    closed = [r for r in rows if r["close_time"] is not None]
                    net = [r["profit"] + (r["commission"] or 0) + (r["swap"] or 0) for r in closed]
                    ctx["journal"] = {
                        "account": {"name": acc["name"], "platform": acc["platform"], "kind": acc["kind"], "currency": acc["currency"], "is_live": bool(acc["is_live"])},
                        "trades_included": len(rows),
                        "totals_over_included_closed_trades": {"count": len(closed), "wins": sum(1 for x in net if x > 0),
                                                               "losses": sum(1 for x in net if x < 0), "net_profit": round(sum(net), 2)},
                        "trades": [{k: r[k] for k in ("ticket", "symbol", "direction", "volume", "open_price", "close_price", "sl", "tp",
                                                      "profit", "commission", "swap", "setup_valid", "setup_id", "emotion", "error", "note")}
                                   | {"open_time_utc": _iso(r["open_time"]), "close_time_utc": _iso(r["close_time"]), "open": r["close_time"] is None}
                                   for r in rows],
                    }
                    if not rows:
                        notes.append("The selected account has no trades in the journal.")

    if acc is not None and b.share.mt5_account:
        st = bridge.live_status(acc["platform"], acc["login"]) if acc["enabled"] else {"connected": False, "disabled": True}
        if st.get("connected"):
            ctx["mt5_account"] = {k: st.get(k) for k in ("balance", "equity", "floating", "open_count", "server")} | {"platform": acc["platform"]}
        else:
            notes.append("MT5 account data was not included: the terminal is not connected right now.")

    if acc is not None and b.share.market:
        tf = TF_SECONDS.get(b.timeframe)
        if acc["platform"] != "mt5":
            notes.append("Market data comes from MT5; the selected account is not an MT5 account.")
        elif not acc["enabled"]:
            notes.append("Market data was not included: the account is disconnected.")
        elif tf is None:
            notes.append(f"Timeframe {b.timeframe} is not supported for market data.")
        else:
            try:
                if candles_fn is None:
                    from . import mt5sync  # lazy: the API runs without MetaTrader5 installed
                    candles_fn = mt5sync.fetch_candles
                rows = candles_fn(acc["login"], acc["terminal_path"], b.symbol, tf, b.candles)
                ctx["market"] = {"source": "MT5 broker history", "symbol": b.symbol, "timeframe": b.timeframe,
                                 "columns": ["time_broker", "open", "high", "low", "close", "tick_volume"],
                                 "candles": [[_iso(c[0]), *c[1:]] for c in rows]}
            except Exception as e:  # SyncError, missing MetaTrader5 module, engine off...
                notes.append(scrub(f"Market data was not included: {e}"))

    return ctx, notes


def analyze(b: AnalyzeIn, post: PostFn | None = None, candles_fn: Callable | None = None) -> dict:
    provider = get_provider(b.provider, post)
    provider._require_key()  # fail fast, before reading MT5
    images = _validate_images(b.images)
    ctx, notes = build_context(b, candles_fn)
    shared_nothing = not any(k in ctx for k in ("rules", "journal", "mt5_account", "market")) and not images
    text = (f"QUESTION:\n{b.question}\n\nCONTEXT (JSON, the only data you may use):\n{json.dumps(ctx, ensure_ascii=False, default=str)}\n\n"
            f"NOTES ABOUT MISSING DATA:\n{json.dumps(notes, ensure_ascii=False)}\n\nATTACHED CHART IMAGES: {len(images)}")
    if shared_nothing:
        notes.append("No trading data was shared, so the answer can only be general.")
    t0 = time.monotonic()
    result = provider.analyze(Prompt(SYSTEM_PROMPT, text, images))
    return {
        "provider": provider.id,
        "model": provider.used_model or provider.model,
        "analysis": result.model_dump(),
        "context_used": {"rules": len(ctx.get("rules", [])), "trades": ctx.get("journal", {}).get("trades_included", 0),
                         "mt5_account": "mt5_account" in ctx, "market_candles": len(ctx.get("market", {}).get("candles", [])),
                         "images": len(images)},
        "notes": notes,
        "elapsed_ms": int((time.monotonic() - t0) * 1000),
    }
