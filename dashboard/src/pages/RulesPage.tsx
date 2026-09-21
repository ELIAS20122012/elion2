import { Link } from "react-router-dom";
import NumField from "../components/NumField";
import PageHeader from "../components/PageHeader";
import { MACD_DEFAULT } from "../lib/detectors/divergence";
import { LAYERS, RULES, STATUS_LABEL } from "../lib/rules";
import { TIMEFRAMES } from "../lib/data";
import { useApp } from "../state/AppContext";
import { useDivergence } from "../state/useDivergence";
import { useDivLabels } from "../state/useDivLabels";
import { FEATURES, analyseLabels, divKey } from "../lib/detectors/divergenceFeatures";

const clock = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " "); // broker (server) time, as on the MT5 axis

export default function RulesPage() {
  const s = useApp();
  const { divP, setDivP, on, closedBars, divs, analysis } = useDivergence();
  const { labels, error: labelError } = useDivLabels();
  const rows = [...labels.values()];
  const nOk = rows.filter((r) => r.label === "ok").length;
  const nBad = rows.length - nOk;
  const report = analyseLabels(rows);
  const done = RULES.filter((r) => r.status === "approved").length;
  const nHigh = divs.filter((d) => d.side === "high").length;
  const tf = TIMEFRAMES.find((t) => t.sec === s.tfSec)?.label ?? "";

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
                {r.ready && (
                  <label className="switch" title="نمایش روی چارت">
                    <input type="checkbox" checked={!!s.layers[r.id]} onChange={(e) => s.setLayers({ ...s.layers, [r.id]: e.target.checked })} />
                    <span />
                  </label>
                )}
                <span className={`status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ol>

          <section className="card rule-settings">
            <h3>لایه‌های چارت</h3>
            <ul className="rules">
              {LAYERS.map((l) => (
                <li key={l.id}>
                  <div><b>{l.title}</b><small>{l.hint}</small></div>
                  <label className="switch">
                    <input type="checkbox" checked={!!s.layers[l.id]} onChange={(e) => s.setLayers({ ...s.layers, [l.id]: e.target.checked })} />
                    <span />
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card rule-settings">
            <div className="rs-head">
              <h3>تنظیمات قانون ۱: دایورجنس معمولی</h3>
              <Link className="btn sm primary" to="/chart">دیدن روی چارت ←</Link>
            </div>
            {!on ? (
              <p className="muted">این قانون خاموش است. کلید سمت راست عنوان قانون را روشن کنید.</p>
            ) : (
              <>
                <p className="found">
                  <b>{divs.length}</b> دایورجنس روی تایم‌فریم {tf} پیدا شد
                  <small className="muted"> — سقف (نارنجی): {nHigh} · کف (سبز): {divs.length - nHigh}</small>
                </p>
                {analysis && (
                  <p className="muted small">
                    سقف‌های قیمت: {analysis.counts.high.priceSwings} که {analysis.counts.high.matched} تای آن‌ها سقف مکدی هم کنارشان داشت ·
                    کف‌های قیمت: {analysis.counts.low.priceSwings} که {analysis.counts.low.matched} تای آن‌ها کف مکدی داشت
                  </p>
                )}

                <ul className="basis">
                  <li><span className="src you">از شما</span>مکدی پیش‌فرض MT5 ({MACD_DEFAULT.fast}, {MACD_DEFAULT.slow}, {MACD_DEFAULT.signal})</li>
                  <li><span className="src you">از شما</span>سقف (روند صعودی): قیمت دو سقف، دومی بالاتر · مکدی دو سقف، دومی پایین‌تر</li>
                  <li><span className="src you">از شما</span>کف (روند نزولی): قیمت دو کف، دومی پایین‌تر · مکدی دو کف، دومی بالاتر</li>
                  <li><span className="src you">از شما</span>دایورجنس وقتی شکل گرفته که بعد از سقف/کف دوم، مکدی با خط سیگنال کراس کند (کف: مکدی از پایین سیگنال را به بالا بشکند · سقف: برعکس)</li>
                  <li><span className="src you">از شما</span>هر سقف/کف قیمت باید یک سقف/کف مکدی هم کنارش داشته باشد (تناسب)</li>
                </ul>

                <div className="assume">
                  <span className="src guess">فرض من — اصلاح کنید</span>
                  <label>روش تشخیص
                    <select value={divP.method} onChange={(e) => setDivP({ ...divP, method: e.target.value as "price" | "macd" })}>
                      <option value="macd">B — از روی مکدی (تمیز، شبیه اندیکاتور مرجع MT5)</option>
                      <option value="price">A — از روی سوینگ قیمت (بیشتر پیدا می‌کند، شلوغ‌تر)</option>
                    </select>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={divP.high} onChange={(e) => setDivP({ ...divP, high: e.target.checked })} /> سقف‌ها (نارنجی)
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={divP.low} onChange={(e) => setDivP({ ...divP, low: e.target.checked })} /> کف‌ها (سبز)
                  </label>
                  <label>مکدی «سقف/کف» دارد یعنی حداکثر این تعداد کندل با سقف/کف قیمت فاصله داشته باشد
                    <NumField min={0} max={20} value={divP.tol} onChange={(v) => setDivP({ ...divP, tol: v })} />
                  </label>
                  <label>کراس حداکثر چند کندل بعد از سقف/کف دوم مکدی رخ دهد
                    <NumField min={1} max={50} value={divP.crossWithin} onChange={(v) => setDivP({ ...divP, crossWithin: v })} />
                  </label>
                  <label>مکدی دو کف/سقف اگر تا این درصد به هم نزدیک بود «هم‌سطح» حساب شود (۰ = فقط دقیقاً بالاتر/پایین‌تر)
                    <NumField min={0} max={50} step={1} value={Math.round(divP.macdTol * 100)} onChange={(v) => setDivP({ ...divP, macdTol: v / 100 })} />
                  </label>
                  <label>«سقف» یعنی قله‌ای که از این تعداد کندل هر طرف بالاتر باشد (کف: برعکس)
                    <NumField min={1} max={10} value={divP.n} onChange={(v) => setDivP({ ...divP, n: v })} />
                  </label>
                  <label>دو سقف حداکثر چند کندل از هم فاصله داشته باشند
                    <NumField min={10} max={1000} value={divP.maxGap} onChange={(v) => setDivP({ ...divP, maxGap: v })} />
                  </label>
                  <small className="muted">سقف مکدی = نقطه‌ای که از کندل قبل و بعدش بالاتر است (کف: برعکس). فقط کندل‌های بسته حساب می‌شوند تا نتیجه بعداً عوض نشود.</small>
                </div>

                <div className="found-list">
                  <h4>برچسب‌های شما (✓ درست / ✗ غلط)</h4>
                  {labelError && <p className="muted small">⚠ سرور ژورنال در دسترس نیست: {labelError}</p>}
                  <p className="muted small">✓ {nOk} · ✗ {nBad} — روی چارت با دکمه‌های «✓ درست / ✗ غلط» برچسب بزنید. هر چه بیشتر، آستانه‌ها دقیق‌تر از خودِ شما درمی‌آید.</p>
                  {nOk >= 3 && nBad >= 3 ? (
                    <table>
                      <thead><tr><th>معیار</th><th>میانه‌ی درست‌ها</th><th>میانه‌ی غلط‌ها</th><th>بهترین مرز</th><th>درستی مرز</th></tr></thead>
                      <tbody>
                        {report.map((r) => (
                          <tr key={r.id} title={FEATURES.find((f) => f.id === r.id)?.hint}>
                            <td>{FEATURES.find((f) => f.id === r.id)?.label}</td>
                            <td dir="ltr">{r.okMedian.toFixed(2)}</td>
                            <td dir="ltr">{r.badMedian.toFixed(2)}</td>
                            <td dir="ltr">{r.dir} {r.threshold.toFixed(2)}</td>
                            <td dir="ltr">{Math.round(r.accuracy * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted small">برای مقایسه حداقل ۳ برچسب «درست» و ۳ برچسب «غلط» لازم است.</p>
                  )}
                </div>
                {divs.length > 0 && (
                  <div className="found-list">
                    <h4>آخرین موارد پیداشده ({tf}، ساعت سرور بروکر)</h4>
                    <table>
                      <thead><tr><th>نوع</th><th>نقطه‌ی اول</th><th>نقطه‌ی دوم</th><th>کراس</th><th>قیمت</th><th>مکدی</th><th>برچسب</th></tr></thead>
                      <tbody>
                        {[...divs].reverse().slice(0, 25).map((d) => (
                          <tr key={`${d.side}-${d.a.i}-${d.b.i}`}>
                            <td className={d.side === "high" ? "hi" : "lo"}>{d.side === "high" ? "سقف" : "کف"}</td>
                            <td dir="ltr">{clock(closedBars[d.a.i].time)}</td>
                            <td dir="ltr">{clock(closedBars[d.b.i].time)}</td>
                            <td dir="ltr">{clock(closedBars[d.cross].time)}</td>
                            <td dir="ltr">{d.a.price.toFixed(2)} → {d.b.price.toFixed(2)}</td>
                            <td dir="ltr">{d.a.macd.toFixed(2)} → {d.b.macd.toFixed(2)}</td>
                            <td>{(() => { const v = labels.get(divKey(s.tfSec, closedBars, d))?.label; return v === "ok" ? "✓" : v === "bad" ? "✗" : "—"; })()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
