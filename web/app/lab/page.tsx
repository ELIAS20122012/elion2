"use client";
import { useState } from "react";
import { command, usePoll, when, type Lab } from "../api";
import { Offline } from "../parts";
import { Card, Empty, reply, toast } from "../ui";

export default function LabPage() {
  const { data, down } = usePoll<Lab>("/api/panel/lab", 15000);
  const [q, setQ] = useState("");
  if (down && !data) return <Offline />;
  const label = (m: string | null) => (m ? data?.models.find((x) => x.name === m)?.label ?? m : "—");
  const rows = data ? data.models.map((m) => ({ ...m, s: data.stats[m.name] })).sort((a, b) => (b.s?.wins ?? 0) - (a.s?.wins ?? 0) || (b.s?.ok ?? 0) - (a.s?.ok ?? 0)) : [];
  const maxWins = Math.max(1, ...rows.map((r) => r.s?.wins ?? 0));
  return (
    <>
      <h1 className="page-h">🧪 آزمایشگاه هوش مصنوعی</h1>
      <div className="grid">
        <Card title="⚖️ مقایسه‌ی جدید" wide>
          <form
            className="ask"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!q.trim()) return;
              const r = await command("compare", q.trim());
              setQ("");
              reply(r);
              if (!r.error) toast("جواب‌ها در تلگرام می‌آیند؛ آنجا بهترین را انتخاب کن.");
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="یک سؤال بنویس تا همه‌ی مدل‌ها جواب بدهند" aria-label="سؤال مقایسه" />
            <button className="primary" disabled={!q.trim()}>مقایسه</button>
          </form>
        </Card>

        <Card title="🏆 مدل‌ها" wide>
          {!data ? <Empty>…</Empty> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>مدل</th><th>برد</th><th>موفق</th><th>میانگین زمان</th><th>وضعیت</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.label}</td>
                      <td>
                        <span className="bar" style={{ ["--w" as string]: `${((r.s?.wins ?? 0) / maxWins) * 100}%` }} />
                        {(r.s?.wins ?? 0).toLocaleString("fa-IR")}
                      </td>
                      <td>{r.s ? `${r.s.ok.toLocaleString("fa-IR")}/${r.s.runs.toLocaleString("fa-IR")}` : "—"}</td>
                      <td>{r.s?.ok ? `${Math.round(r.s.ms / r.s.ok / 1000).toLocaleString("fa-IR")} ث` : "—"}</td>
                      <td>{r.restingUntil ? <span className="warn" title={`تا ${when(r.restingUntil)}`}>استراحت</span> : <span className="ok">آماده</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="🎯 انتخاب خودکار مدل"
          wide
          action={
            data && (
              <label className="switch">
                <input type="checkbox" checked={data.routing} onChange={async (e) => reply(await command("lab", `auto ${e.target.checked ? "on" : "off"}`))} />
                <span>{data.routing ? "روشن" : "خاموش"}</span>
              </label>
            )
          }
        >
          {!data ? <Empty>…</Empty> : (
            <>
              <div className="cats">
                {data.categories.map((c) => (
                  <div className={`cat${c.best ? " has" : ""}`} key={c.name}>
                    <b>{c.label}</b>
                    <span>{c.best ? `→ ${label(c.best)}` : "داده کافی نیست"}</span>
                  </div>
                ))}
              </div>
              <small className="mute">برای هر نوع کار، مدلی که حداقل ۲ بار و ۶۰٪ برنده شده اول امتحان می‌شود.</small>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
