//+------------------------------------------------------------------+
//| RobotTradingEA.mq4                                                    |
//| نسخه MQL4 -- همان معماری RobotTradingEA.mq5 (گزارش کامل معاملات/      |
//| موجودی/اتصال به بک‌اند)، چون MQL4 و MQL5 دو زبان جدا هستند.       |
//+------------------------------------------------------------------+
#property strict

input string InpServerUrl = "https://YOUR-DOMAIN-OR-IP";   // بدون / در انتها -- باید در Tools>Options>Expert Advisors مجاز شود
input string InpEaKey         = "";                             // کلید API این حساب (از بک‌اند گرفته می‌شود)
input int    InpHeartbeatSeconds = 30;
input int    InpSnapshotSeconds  = 60;
input int    InpTimerSeconds     = 5;
input int    InpCandleHistoryCount = 600;
input int    InpHistoryBars = 20000;    // M1 history sent to the dashboard chart after start (1000 per 2 s)
input bool   InpSendCandles = false;      // ارسال کندل‌ها برای تحلیل ستاپ (تا وقتی اجرای سفارش خاموش است لازم نیست) // تعداد کندل M1 بسته‌شده که برای تحلیل ستاپ فرستاده می‌شود

string   g_queueFile      = "tradebot_queue.txt";
datetime g_lastHeartbeat  = 0;
datetime g_lastSnapshot   = 0;
datetime g_lastHistorySync = 0;
datetime g_lastAnalyzedBar = 0;
datetime g_lastOpenSync   = 0;
datetime g_lastFeedBar    = 0;
bool     g_feedInit       = false;
int      g_backfill       = 0;      // M1 bars of history already sent (oldest last)
string   g_feedSym        = "";     // another symbol the dashboard chart is showing
int      g_feedBack       = 0;      // its M1 history already sent
datetime g_lastErrorPrint = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpEaKey) == 0)
      Print("RobotTradingEA: InpEaKey تنظیم نشده — رویدادها ارسال نمی‌شوند تا این مقدار پر شود.");

   g_lastHistorySync = TimeCurrent() - 86400; // یک روز عقب‌تر، تا معاملات بسته‌شده اخیر هم بعد از ری‌استارت گزارش شوند
   EventSetTimer(2); // سفارش‌های داشبورد هر ۲ ثانیه چک می‌شوند
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| هر تیک: فقط بررسی سیگنال‌های استراتژی (نه شبکه، تا سریع بماند)   |
//+------------------------------------------------------------------+
void OnTick()
{
   if(CheckEntrySignal())
   {
      // TODO فاز E: طبق قوانین دقیق سیستم معاملاتی، اینجا OrderSend() فراخوانی می‌شود.
   }
   if(CheckExitSignal())
   {
      // TODO فاز E: طبق قوانین دقیق سیستم معاملاتی، اینجا پوزیشن بسته می‌شود.
   }
}

//+------------------------------------------------------------------+
//| هر InpTimerSeconds ثانیه: گزارش heartbeat/snapshot/معاملات       |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime now = TimeCurrent();

   if(now - g_lastHeartbeat >= InpHeartbeatSeconds)
   {
      SendHeartbeat();
      g_lastHeartbeat = now;
   }
   if(now - g_lastSnapshot >= InpSnapshotSeconds)
   {
      SendSnapshot();
      g_lastSnapshot = now;
   }

   // سبک نگه داشتن MT4: سفارش‌های باز هر InpSnapshotSeconds یک بار، بدون صف محلی (بک‌اند idempotent است)
   if(now - g_lastOpenSync >= InpSnapshotSeconds)
   {
      SyncOpenOrders();
      g_lastOpenSync = now;
   }
   SyncClosedOrders();
   ExecuteDashboardOrders();
   SendCandleFeed();
   SendExtraFeed();
   if(InpSendCandles)
      SendSignalEvaluateOnNewBar();
}

//+------------------------------------------------------------------+
//| با هر کندل M1 جدید، تاریخچهٔ اخیر را برای موتور تشخیص ستاپ         |
//| می‌فرستد. این فقط تشخیص می‌گیرد -- خودش سفارشی باز نمی‌کند؛ نتیجه |
//| در داشبورد دیده می‌شود (ea/shared/STRATEGY_NOTES.md را ببینید).   |
//+------------------------------------------------------------------+
void SendSignalEvaluateOnNewBar()
{
   // به‌جای iTime() (که بعد از قطع/وصل شدن اتصال گاهی مقدار کش‌شده و
   // به‌روزنشده برمی‌گرداند)، از CopyRates استفاده می‌شود که همیشه سری را
   // تازه می‌کند -- همان تابعی که برای خود دادهٔ کندل‌ها هم استفاده می‌شود.
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // ترتیب زمانی صعودی: قدیمی‌ترین در اندیس ۰
   int copied = CopyRates(_Symbol, PERIOD_M1, 1, InpCandleHistoryCount, rates);
   if(copied <= 0)
   {
      Print("RobotTradingEA: CopyRates برای تحلیل ستاپ شکست خورد، خطا ", GetLastError());
      return;
   }

   datetime lastClosedBarTime = rates[copied - 1].time;
   if(lastClosedBarTime == g_lastAnalyzedBar)
      return;
   g_lastAnalyzedBar = lastClosedBarTime;

   string json = "{\"candles\":[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0)
         json += ",";
      json += "{";
      json += "\"time\":\""  + TimeToIso(rates[i].time) + "\",";
      json += "\"open\":"    + DoubleToString(rates[i].open, 5) + ",";
      json += "\"high\":"    + DoubleToString(rates[i].high, 5) + ",";
      json += "\"low\":"     + DoubleToString(rates[i].low, 5) + ",";
      json += "\"close\":"   + DoubleToString(rates[i].close, 5);
      json += "}";
   }
   json += "]}";

   PostOrQueue("/events/signal-evaluate", json);
}

//+------------------------------------------------------------------+
//| محل قوانین استراتژی — فعلاً placeholder (نگاه کنید به            |
//| ea/shared/STRATEGY_NOTES.md برای فاز E)                          |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| فید قیمت MT4 برای چارت داشبورد: اول ۱۵۰۰ کندل M1، بعد هر ۵ ثانیه  |
//| آخرین ۳ کندل (کندل در حال تشکیل هم به‌روز می‌شود)                  |
//+------------------------------------------------------------------+
void SendCandleFeed()
{
   int start = 0, want = 3;
   bool backfill = g_backfill < InpHistoryBars;
   if(backfill) { start = g_backfill; want = MathMin(1000, InpHistoryBars - g_backfill); }
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, PERIOD_M1, start, want, rates);
   if(copied <= 0)
   {
      if(backfill) g_backfill = InpHistoryBars; // no older bars in this terminal
      return;
   }
   string json = "{\"login\":\"" + IntegerToString(AccountNumber()) + "\",\"symbol\":\"" + JsonEscape(_Symbol) + "\",\"candles\":[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) json += ",";
      json += "{\"time\":\"" + TimeToIso(rates[i].time) + "\",\"open\":" + DoubleToString(rates[i].open, _Digits) +
              ",\"high\":" + DoubleToString(rates[i].high, _Digits) + ",\"low\":" + DoubleToString(rates[i].low, _Digits) +
              ",\"close\":" + DoubleToString(rates[i].close, _Digits) + ",\"volume\":" + IntegerToString(rates[i].tick_volume) + "}";
   }
   json += "]}";
   if(PostOrQueue("/events/candles", json))
   {
      g_feedInit = true;
      if(backfill) g_backfill = (copied < want) ? InpHistoryBars : g_backfill + copied;
   }
}

//+------------------------------------------------------------------+
//| سفارش‌هایی که الیاس در داشبورد ELION می‌زند (Place Order)         |
//| فقط سفارش تازه (کمتر از ۱۵ ثانیه) از سرور می‌آید و یک بار اجرا می‌شود |
//+------------------------------------------------------------------+
//| کندل‌های نمادی که داشبورد الان نشان می‌دهد (اگر غیر از نماد چارت خود EA باشد) |
void SendExtraFeed()
{
   if(g_feedSym == "" || g_feedSym == _Symbol || MarketInfo(g_feedSym, MODE_BID) <= 0)
      return;
   int start = 0, want = 3;
   bool backfill = g_feedBack < 5000;
   if(backfill) { start = g_feedBack; want = MathMin(1000, 5000 - g_feedBack); }
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(g_feedSym, PERIOD_M1, start, want, rates);
   if(copied <= 0)
      return; // history still downloading in MT4: try again next tick
   int dg = (int)MarketInfo(g_feedSym, MODE_DIGITS);
   string json = "{\"login\":\"" + IntegerToString(AccountNumber()) + "\",\"symbol\":\"" + JsonEscape(g_feedSym) + "\",\"candles\":[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) json += ",";
      json += "{\"time\":\"" + TimeToIso(rates[i].time) + "\",\"open\":" + DoubleToString(rates[i].open, dg) +
              ",\"high\":" + DoubleToString(rates[i].high, dg) + ",\"low\":" + DoubleToString(rates[i].low, dg) +
              ",\"close\":" + DoubleToString(rates[i].close, dg) + ",\"volume\":" + IntegerToString(rates[i].tick_volume) + "}";
   }
   json += "]}";
   if(PostOrQueue("/events/candles", json) && backfill)
      g_feedBack = (copied < want) ? 5000 : g_feedBack + copied;
}

string JStr(string src, string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(src, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   if(StringSubstr(src, p, 1) == "\"")
   {
      int e = StringFind(src, "\"", p + 1);
      return StringSubstr(src, p + 1, e - p - 1);
   }
   int e2 = p;
   while(e2 < StringLen(src) && StringFind(",}]", StringSubstr(src, e2, 1)) < 0) e2++;
   return StringSubstr(src, p, e2 - p);
}

string PositionsJson()
{
   string json = "{\"login\":\"" + IntegerToString(AccountNumber()) + "\",\"chart\":\"" + JsonEscape(_Symbol) + "\",\"balance\":" + DoubleToString(AccountBalance(), 2) +
                 ",\"equity\":" + DoubleToString(AccountEquity(), 2) + ",\"positions\":[";
   int n = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      int dg = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
      bool buy = OrderType() == OP_BUY;
      if(n++ > 0) json += ",";
      json += "{\"ticket\":\"" + IntegerToString(OrderTicket()) + "\",\"symbol\":\"" + JsonEscape(OrderSymbol()) +
              "\",\"direction\":\"" + (buy ? "buy" : "sell") + "\",\"volume\":" + DoubleToString(OrderLots(), 2) +
              ",\"open_price\":" + DoubleToString(OrderOpenPrice(), dg) + ",\"open_time\":\"" + TimeToIso(OrderOpenTime()) +
              "\",\"sl\":" + (OrderStopLoss() > 0 ? DoubleToString(OrderStopLoss(), dg) : "null") +
              ",\"tp\":" + (OrderTakeProfit() > 0 ? DoubleToString(OrderTakeProfit(), dg) : "null") +
              ",\"price\":" + DoubleToString(buy ? MarketInfo(OrderSymbol(), MODE_BID) : MarketInfo(OrderSymbol(), MODE_ASK), dg) +
              ",\"profit\":" + DoubleToString(OrderProfit(), 2) + ",\"swap\":" + DoubleToString(OrderSwap(), 2) +
              ",\"commission\":" + DoubleToString(OrderCommission(), 2) + "}";
   }
   json += "],\"pending\":[";
   n = 0;
   for(int k = 0; k < OrdersTotal(); k++)
   {
      if(!OrderSelect(k, SELECT_BY_POS, MODE_TRADES)) continue;
      int t = OrderType();
      if(t == OP_BUY || t == OP_SELL) continue;
      string tn = (t == OP_BUYLIMIT) ? "buy_limit" : (t == OP_SELLLIMIT) ? "sell_limit" : (t == OP_BUYSTOP) ? "buy_stop" : "sell_stop";
      int dg2 = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
      if(n++ > 0) json += ",";
      json += "{\"ticket\":\"" + IntegerToString(OrderTicket()) + "\",\"symbol\":\"" + JsonEscape(OrderSymbol()) + "\",\"type\":\"" + tn +
              "\",\"volume\":" + DoubleToString(OrderLots(), 2) + ",\"price\":" + DoubleToString(OrderOpenPrice(), dg2) +
              ",\"sl\":" + (OrderStopLoss() > 0 ? DoubleToString(OrderStopLoss(), dg2) : "null") +
              ",\"tp\":" + (OrderTakeProfit() > 0 ? DoubleToString(OrderTakeProfit(), dg2) : "null") + "}";
   }
   json += "],\"quotes\":[";
   int total = MathMin(SymbolsTotal(true), 40);
   n = 0;
   for(int q = 0; q < total; q++)
   {
      string sym = SymbolName(q, true);
      double bid = MarketInfo(sym, MODE_BID), ask = MarketInfo(sym, MODE_ASK);
      if(bid <= 0) continue;
      int dg3 = (int)MarketInfo(sym, MODE_DIGITS);
      double prev = iClose(sym, PERIOD_D1, 1);
      double tsz = MarketInfo(sym, MODE_TICKSIZE), tv = MarketInfo(sym, MODE_TICKVALUE);
      if(n++ > 0) json += ",";
      json += "{\"symbol\":\"" + JsonEscape(sym) + "\",\"bid\":" + DoubleToString(bid, dg3) + ",\"ask\":" + DoubleToString(ask, dg3) +
              ",\"change\":" + (prev > 0 ? DoubleToString((bid - prev) / prev * 100.0, 2) : "null") +
              ",\"digits\":" + IntegerToString(dg3) + ",\"pv\":" + (tsz > 0 ? DoubleToString(tv / tsz, 4) : "null") + "}";
   }
   return json + "]}";
}

double JNum(string resp, string key)
{
   string v = JStr(resp, key);
   return (v == "null" || v == "") ? 0 : StringToDouble(v);
}

//| هر ۲ ثانیه: پوزیشن‌های باز با سود زنده به داشبورد، و در همان پاسخ دستور بعدی داشبورد |
void ExecuteDashboardOrders()
{
   string resp;
   if(!HttpPostJson("/events/positions", PositionsJson(), resp))
      return;
   string feed = JStr(resp, "feed");
   if(feed != g_feedSym) { g_feedSym = feed; g_feedBack = 0; }
   if(StringFind(resp, "\"order\":null") >= 0 || StringFind(resp, "\"id\":") < 0)
      return;
   string id   = JStr(resp, "id");
   string sym  = JStr(resp, "symbol");
   string dir  = JStr(resp, "direction");
   double vol  = JNum(resp, "volume");
   double sl   = JNum(resp, "sl");
   double tp   = JNum(resp, "tp");
   int target  = (int)StringToInteger(JStr(resp, "target"));
   string err  = "";
   int ticket  = -1;
   double price = 0;

   if(!IsTradeAllowed())
      err = "AutoTrading is off in MT4 — press the AutoTrading button";
   else if(dir == "cancel")
   {
      if(OrderDelete(target, clrNONE)) ticket = target;
      else err = "OrderDelete error " + IntegerToString(GetLastError());
   }
   else if(dir == "modify" || dir == "close")
   {
      if(!OrderSelect(target, SELECT_BY_TICKET) || OrderCloseTime() != 0)
         err = "Position #" + IntegerToString(target) + " is not open";
      else
      {
         string osym = OrderSymbol();
         int dg = (int)MarketInfo(osym, MODE_DIGITS);
         bool ok;
         RefreshRates();
         if(dir == "modify")
         {
            ok = OrderModify(target, OrderOpenPrice(), sl > 0 ? NormalizeDouble(sl, dg) : 0, tp > 0 ? NormalizeDouble(tp, dg) : 0, 0, clrNONE);
            if(!ok && GetLastError() == 1) ok = true; // no change
         }
         else
         {
            price = (OrderType() == OP_BUY) ? MarketInfo(osym, MODE_BID) : MarketInfo(osym, MODE_ASK);
            ok = OrderClose(target, OrderLots(), NormalizeDouble(price, dg), 30, clrGold);
         }
         if(ok) ticket = target;
         else   err = (dir == "modify" ? "OrderModify" : "OrderClose") + " error " + IntegerToString(GetLastError());
      }
   }
   else if(MarketInfo(sym, MODE_BID) <= 0)
      err = "Symbol " + sym + " is not available in this terminal";
   else
   {
      int op = -1;
      if(dir == "buy") op = OP_BUY; else if(dir == "sell") op = OP_SELL;
      else if(dir == "buy_limit") op = OP_BUYLIMIT; else if(dir == "sell_limit") op = OP_SELLLIMIT;
      else if(dir == "buy_stop") op = OP_BUYSTOP; else if(dir == "sell_stop") op = OP_SELLSTOP;
      if(op < 0)
         err = "Invalid direction";
      else
      {
         int digits = (int)MarketInfo(sym, MODE_DIGITS);
         bool isBuy = (op == OP_BUY || op == OP_BUYLIMIT || op == OP_BUYSTOP);
         RefreshRates();
         price = (op == OP_BUY) ? MarketInfo(sym, MODE_ASK) : (op == OP_SELL) ? MarketInfo(sym, MODE_BID) : JNum(resp, "entry");
         ticket = OrderSend(sym, op, vol, NormalizeDouble(price, digits), 30,
                            sl > 0 ? NormalizeDouble(sl, digits) : 0, tp > 0 ? NormalizeDouble(tp, digits) : 0,
                            "ELION dashboard", 20261009, 0, isBuy ? clrDodgerBlue : clrTomato);
         if(ticket < 0)
            err = "OrderSend error " + IntegerToString(GetLastError());
         else if(OrderSelect(ticket, SELECT_BY_TICKET))
            price = OrderOpenPrice();
      }
   }
   string body = (ticket >= 0)
      ? "{\"ok\":true,\"ticket\":\"" + IntegerToString(ticket) + "\",\"price\":" + DoubleToString(price, 5) + "}"
      : "{\"ok\":false,\"error\":\"" + JsonEscape(err) + "\"}";
   Print("RobotTradingEA: dashboard ", dir, " #", id, " ", sym, " -> ", ticket >= 0 ? "ok #" + IntegerToString(ticket) : err);
   HttpPostJson("/events/orders/" + id + "/result", body, resp);
   if(ticket >= 0)
   {
      SyncOpenOrders();   // ژورنال فوراً تغییر را می‌بیند
      if(dir == "close") SyncClosedOrders();
   }
}

bool CheckEntrySignal()
{
   return false;
}

bool CheckExitSignal()
{
   return false;
}

//+------------------------------------------------------------------+
//| گزارش موجودی/اکوییتی فعلی                                        |
//+------------------------------------------------------------------+
void SendSnapshot()
{
   double balance    = AccountBalance();
   double equity     = AccountEquity();
   double margin     = AccountMargin();
   double freeMargin  = AccountFreeMargin();
   double marginLevel = (margin > 0) ? (equity / margin * 100.0) : 0.0;

   string json = "{";
   json += "\"login\":\"" + IntegerToString(AccountNumber()) + "\",";
   json += "\"timestamp\":\"" + TimeToIso(TimeCurrent()) + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"margin\":" + DoubleToString(margin, 2) + ",";
   json += "\"free_margin\":" + DoubleToString(freeMargin, 2) + ",";
   json += "\"margin_level\":" + DoubleToString(marginLevel, 2);
   json += "}";

   PostOrQueue("/events/snapshot", json);
}

void SendHeartbeat()
{
   string info = TerminalName() + " / " + AccountServer();
   string json = "{\"login\":\"" + IntegerToString(AccountNumber()) + "\",\"ea_version\":\"1.5-mt4\",\"terminal_info\":\"" + JsonEscape(info) + "\"}";
   PostOrQueue("/events/heartbeat", json);
}

//+------------------------------------------------------------------+
//| گزارش تمام سفارش‌های باز (idempotent -- بک‌اند بر اساس ticket    |
//| بازنویسی می‌کند، پس ارسال تکراری مشکلی ایجاد نمی‌کند)             |
//+------------------------------------------------------------------+
void SyncOpenOrders()
{
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL)
         continue; // پندینگ اوردرها فعلاً گزارش نمی‌شوند

      string direction = (OrderType() == OP_BUY) ? "buy" : "sell";

      string json = BuildTradeJson(IntegerToString(OrderTicket()), OrderSymbol(), direction, OrderLots(),
                                    OrderOpenTime(), OrderOpenPrice(), 0, 0,
                                    OrderStopLoss(), OrderTakeProfit(), OrderProfit(), OrderCommission(),
                                    OrderSwap(), "open");
      PostOrQueue("/events/trade", json);
   }
}

//+------------------------------------------------------------------+
//| گزارش سفارش‌های تازه بسته‌شده از تاریخچه معاملات                 |
//+------------------------------------------------------------------+
void SyncClosedOrders()
{
   for(int i = 0; i < OrdersHistoryTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL)
         continue;
      if(OrderCloseTime() == 0 || OrderCloseTime() <= g_lastHistorySync)
         continue;

      string direction = (OrderType() == OP_BUY) ? "buy" : "sell";

      string json = BuildTradeJson(IntegerToString(OrderTicket()), OrderSymbol(), direction, OrderLots(),
                                    OrderOpenTime(), OrderOpenPrice(), OrderCloseTime(), OrderClosePrice(),
                                    OrderStopLoss(), OrderTakeProfit(), OrderProfit(), OrderCommission(),
                                    OrderSwap(), "closed");
      if(!PostOrQueue("/events/trade", json))
         return; // دفعهٔ بعد دوباره تلاش می‌شود
   }
   g_lastHistorySync = TimeCurrent();
}

//+------------------------------------------------------------------+
//| کمک‌کننده‌های JSON و HTTP                                        |
//+------------------------------------------------------------------+
string BuildTradeJson(string ticket, string symbol, string direction, double volume,
                      datetime openTime, double openPrice,
                      datetime closeTime, double closePrice,
                      double sl, double tp, double profit, double commission, double swap,
                      string status)
{
   string json = "{";
   json += "\"login\":\""     + IntegerToString(AccountNumber()) + "\",";
   json += "\"ticket\":\""    + JsonEscape(ticket)  + "\",";
   json += "\"symbol\":\""    + JsonEscape(symbol)   + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"volume\":"      + DoubleToString(volume, 2) + ",";
   json += "\"open_time\":\"" + TimeToIso(openTime) + "\",";
   json += "\"open_price\":"  + DoubleToString(openPrice, 5) + ",";
   json += "\"close_time\":"  + (closeTime > 0 ? ("\"" + TimeToIso(closeTime) + "\"") : "null") + ",";
   json += "\"close_price\":" + (closePrice != 0 ? DoubleToString(closePrice, 5) : "null") + ",";
   json += "\"stop_loss\":"   + (sl != 0 ? DoubleToString(sl, 5) : "null") + ",";
   json += "\"take_profit\":" + (tp != 0 ? DoubleToString(tp, 5) : "null") + ",";
   json += "\"profit\":"      + DoubleToString(profit, 2) + ",";
   json += "\"commission\":"  + DoubleToString(commission, 2) + ",";
   json += "\"swap\":"        + DoubleToString(swap, 2) + ",";
   json += "\"status\":\""    + status + "\"";
   json += "}";
   return json;
}

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

// MT4 TimeCurrent() زمان سرور بروکر است، نه UTC -- برای دقت کامل باید آفست سرور را جدا محاسبه کرد.
string TimeToIso(datetime t)
{
   string s = TimeToString(t, TIME_DATE | TIME_SECONDS); // "2026.09.18 12:34:56"
   StringReplace(s, ".", "-");
   StringReplace(s, " ", "T");
   return s + "Z";
}

bool HttpPostJson(string path, string jsonBody, string &responseOut)
{
   int timeoutMs = (StringLen(jsonBody) > 4000) ? 15000 : 3000; // first candle batch is larger
   string url = InpServerUrl + path;
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpEaKey + "\r\n";

   char data[];
   int len = StringToCharArray(jsonBody, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);

   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers, timeoutMs, data, result, resultHeaders);
   if(status == -1)
   {
      if(TimeLocal() - g_lastErrorPrint < 60) return false; // هر دقیقه حداکثر یک پیام خطا
      g_lastErrorPrint = TimeLocal();
      Print("RobotTradingEA: خطای WebRequest ", GetLastError(),
            " -- آیا آدرس بک‌اند در Tools > Options > Expert Advisors > Allow WebRequest مجاز شده؟");
      return false;
   }

   responseOut = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if((status < 200 || status >= 300) && TimeLocal() - g_lastErrorPrint >= 60)
   {
      g_lastErrorPrint = TimeLocal();
      Print("RobotTradingEA: HTTP ", status, " از ", path, " -- ", StringSubstr(responseOut, 0, 120));
   }
   return (status >= 200 && status < 300);
}

bool PostOrQueue(string path, string json)
{
   string resp;
   return HttpPostJson(path, json, resp); // صف محلی حذف شد: باعث هنگ MT4 می‌شد
}

//+------------------------------------------------------------------+
//| صف محلی برای رویدادهایی که ارسالشان شکست خورده (قطعی شبکه و...) |
//+------------------------------------------------------------------+
void QueueEvent(string path, string jsonBody)
{
   int handle = FileOpen(g_queueFile, FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle < 0)
      handle = FileOpen(g_queueFile, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle < 0)
   {
      Print("RobotTradingEA: امکان نوشتن فایل صف وجود ندارد");
      return;
   }
   FileSeek(handle, 0, SEEK_END);
   FileWrite(handle, path);
   FileWrite(handle, jsonBody);
   FileClose(handle);
}

void RetryQueue()
{
   if(!FileIsExist(g_queueFile, FILE_COMMON))
      return;

   int handle = FileOpen(g_queueFile, FILE_READ | FILE_TXT | FILE_COMMON);
   if(handle < 0)
      return;

   string remaining = "";
   while(!FileIsEnding(handle))
   {
      string path = FileReadString(handle);
      if(FileIsEnding(handle))
         break;
      string body = FileReadString(handle);

      string resp;
      if(!HttpPostJson(path, body, resp))
         remaining += path + "\n" + body + "\n";
   }
   FileClose(handle);

   int wh = FileOpen(g_queueFile, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(wh >= 0)
   {
      if(StringLen(remaining) > 0)
         FileWriteString(wh, remaining);
      FileClose(wh);
   }
}
