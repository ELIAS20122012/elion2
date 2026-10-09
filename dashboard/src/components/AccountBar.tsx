import { useEffect, useState, type ReactNode } from "react";
import { journalApi, type Account, type AccountInput, type Kind, type Platform } from "../lib/journalApi";
import Icon from "./Icon";
import { useJournal } from "../state/JournalContext";

export const KIND_LABEL: Record<Kind, string> = { manual: "ترید دستی", robot: "ربات", backtest: "بک‌تست" };

/** Gate for pages that need the journal server: shows a how-to-start message when it's unreachable. */
export function BackendGate({ children }: { children: ReactNode }) {
  const { status, refreshAccounts } = useJournal();
  if (status === "ok") return <>{children}</>;
  return (
    <div className="card gate">
      {status === "loading" ? (
        <p className="muted">در حال اتصال به سرور ژورنال…</p>
      ) : (
        <>
          <h3>سرور ژورنال در دسترس نیست</h3>
          <p className="muted">ژورنال داده‌ها را روی همین رایانه ذخیره می‌کند و برای کار به یک سرور کوچک نیاز دارد.</p>
          <p>فایل <b dir="ltr">start-live.bat</b> را اجرا کنید (یا در پوشه‌ی backend دستور <code dir="ltr">python -m uvicorn journal.api:app --port 8000</code>).</p>
          <button className="btn primary" onClick={refreshAccounts}>دوباره تلاش</button>
        </>
      )}
    </div>
  );
}

export default function AccountBar() {
  const { accounts, activeId, setActive, refreshAccounts } = useJournal();
  const [dialog, setDialog] = useState<{ mode: "new" } | { mode: "edit"; account: Account } | null>(null);
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="acctbar">
      <div className="tabs" role="tablist" aria-label="حساب‌ها">
        {accounts.map((a) => (
          <button key={a.id} role="tab" aria-selected={a.id === activeId} className={`acct ${a.id === activeId ? "on" : ""}`} onClick={() => setActive(a.id)}>
            <span className="acct-name">{a.name}</span>
            <span className="acct-meta">
              <span className="pill" dir="ltr">{a.platform.toUpperCase()}</span>
              <span className={`pill kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              {a.is_live && <span className="pill live">LIVE</span>}
              <span className="muted" dir="ltr">{a.trade_count}</span>
            </span>
          </button>
        ))}
        <button className="acct add" onClick={() => setDialog({ mode: "new" })}><Icon name="plus" size={16} />حساب جدید</button>
      </div>
      {active && <button className="btn" onClick={() => setDialog({ mode: "edit", account: active })} title="ویرایش یا حذف حساب"><Icon name="sliders" size={16} />تنظیم حساب</button>}
      {dialog && (
        <AccountDialog
          account={dialog.mode === "edit" ? dialog.account : null}
          onClose={() => setDialog(null)}
          onSaved={async (id) => {
            await refreshAccounts();
            if (id != null) setActive(id);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

export function AccountDialog({ account, onClose, onSaved, defaultPlatform }: { account: Account | null; onClose: () => void; onSaved: (id: number | null) => void; defaultPlatform?: Platform }) {
  const [terminals, setTerminals] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    journalApi.terminals().then(setTerminals).catch(() => {});
  }, []);
  const [f, setF] = useState<AccountInput>({
    name: account?.name ?? "",
    terminal_path: account?.terminal_path ?? null,
    platform: account?.platform ?? defaultPlatform ?? "mt5",
    kind: account?.kind ?? "manual",
    broker: account?.broker ?? "",
    login: account?.login ?? "",
    is_live: account?.is_live ?? false,
    initial_balance: account?.initial_balance ?? null,
    note: account?.note ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return setErr("نام حساب را بنویسید");
    setBusy(true);
    try {
      const body = { ...f, name: f.name.trim(), broker: f.broker || null, login: f.login || null, note: f.note || null, terminal_path: f.platform === "mt5" ? f.terminal_path || null : null };
      const saved = account ? await journalApi.updateAccount(account.id, body) : await journalApi.createAccount(body);
      onSaved(saved.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!account || !window.confirm(`حساب «${account.name}» و همه‌ی معاملات و یادداشت‌هایش پاک شود؟ این کار برگشت ندارد.`)) return;
    setBusy(true);
    try {
      await journalApi.deleteAccount(account.id);
      onSaved(null);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal form" role="dialog" aria-label={account ? "ویرایش حساب" : "حساب جدید"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{account ? "ویرایش حساب" : "حساب جدید"}</h3>
          <button className="x" onClick={onClose} aria-label="بستن">×</button>
        </div>

        <label className="field"><span>نام حساب</span><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="مثلاً: لایو MT4" /></label>

        <div className="field">
          <span>پلتفرم</span>
          <div className="seg">
            {(["mt4", "mt5"] as Platform[]).map((p) => <button key={p} className={f.platform === p ? "on" : ""} onClick={() => set("platform", p)} type="button">{p.toUpperCase()}</button>)}
          </div>
        </div>

        <div className="field">
          <span>نوع حساب</span>
          <div className="seg">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button key={k} className={f.kind === k ? "on" : ""} onClick={() => set("kind", k)} type="button">{KIND_LABEL[k]}</button>)}
          </div>
          <small className="muted">ژورنال و آنالیز هر حساب کاملاً جدا نگه داشته می‌شود.</small>
        </div>

        <div className="row2">
          <label className="field"><span>بروکر (اختیاری)</span><input value={f.broker ?? ""} onChange={(e) => set("broker", e.target.value)} dir="ltr" /></label>
          <label className="field"><span>شماره حساب</span><input value={f.login ?? ""} onChange={(e) => set("login", e.target.value)} dir="ltr" placeholder="مثلاً 46162031" /></label>
        </div>
        <div className="row2">
          <label className="field"><span>موجودی اولیه (برای نمودار)</span><input type="number" value={f.initial_balance ?? ""} onChange={(e) => set("initial_balance", e.target.value === "" ? null : Number(e.target.value))} dir="ltr" /></label>
          <label className="field check"><input type="checkbox" checked={!!f.is_live} onChange={(e) => set("is_live", e.target.checked)} /><span>حساب واقعی (Live)</span></label>
        </div>
        <label className="field"><span>یادداشت</span><input value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} /></label>

        {f.platform === "mt5" && (
          <label className="field">
            <span>ترمینال MT5 این حساب</span>
            <select value={f.terminal_path ?? ""} onChange={(e) => set("terminal_path", e.target.value || null)} dir="ltr">
              <option value="">ترمینالِ در حال اجرا (پیش‌فرض)</option>
              {terminals.map((t) => <option key={t.path} value={t.path}>{t.name} — {t.path}</option>)}
              {f.terminal_path && !terminals.some((t) => t.path === f.terminal_path) && <option value={f.terminal_path}>{f.terminal_path}</option>}
            </select>
            <small className="muted">اگر دمو و لایو هر دو MT5 هستند، برای هر حساب ترمینال جدای خودش را انتخاب کنید تا هر دو همزمان و خودکار ثبت شوند.</small>
          </label>
        )}
        {!account && (
          <p className="muted small">
            ثبت معاملات <b>MT5</b> خودکار است (هر ۱۰ ثانیه). برای <b>MT4</b> اندیکاتور JournalBridge را نصب کنید (راهنما در صفحه‌ی «راهنما»).
          </p>
        )}
        {err && <p className="err">{err}</p>}
        <div className="actions">
          {account && <button className="btn danger" onClick={remove} disabled={busy}>حذف حساب</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>انصراف</button>
          <button className="btn primary" onClick={save} disabled={busy}>{account ? "ذخیره" : "ساخت حساب"}</button>
        </div>
      </div>
    </div>
  );
}
