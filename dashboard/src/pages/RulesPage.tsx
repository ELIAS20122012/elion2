import { RULES, STATUS_LABEL } from "../lib/rules";

export default function RulesPage() {
  const done = RULES.filter((r) => r.status === "approved").length;
  return (
    <div className="page">
      <header className="page-head">
        <h2>قوانین سیستم</h2>
        <p className="muted">قوانین به ترتیب آموزش. هر قانون بعد از رسم روی چارت و تأیید شما «تأیید شده» می‌شود و بعد سراغ قانون بعدی می‌رویم.</p>
      </header>

      <div className="card progress-card">
        <div className="progress-top">
          <b>پیشرفت آموزش</b>
          <span className="muted">{done} از {RULES.length}</span>
        </div>
        <div className="bar"><i style={{ width: `${(done / RULES.length) * 100}%` }} /></div>
      </div>

      <ol className="rule-cards">
        {RULES.map((r, i) => (
          <li key={r.id} className={`card rule-card ${r.status}`}>
            <span className="num">{i + 1}</span>
            <div className="body">
              <b>{r.title}</b>
              <small>{r.hint}</small>
            </div>
            <span className={`status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
