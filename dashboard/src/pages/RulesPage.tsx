import PageHeader from "../components/PageHeader";
import { RULES, STATUS_LABEL } from "../lib/rules";

export default function RulesPage() {
  const done = RULES.filter((r) => r.status === "approved").length;
  return (
    <div className="page">
      <PageHeader title="قوانین سیستم" subtitle="قوانین به ترتیبی که شما توضیح می‌دهید اضافه می‌شوند. هر قانون بعد از رسم روی چارت و تأیید شما «تأیید شده» می‌شود." />

      {RULES.length === 0 ? (
        <div className="card empty-state">
          <h3>هنوز هیچ قانونی تعریف نشده</h3>
          <p className="muted">چیزی از پیش فرض نشده است. از صفر شروع می‌کنیم: ستاپ را به هر شکلی که راحت‌ترید برایم توضیح بدهید (متن، عکس، ساعت کندل)، من آن را می‌فهمم، برایتان مکتوب می‌کنم و اینجا اضافه می‌شود.</p>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
