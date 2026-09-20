//+------------------------------------------------------------------+
//| RobotTradingEA.mq5                                                   |
//| اسکلت EA برای MT5: گزارش کامل معاملات/موجودی/اتصال به بک‌اند،     |
//| به‌همراه محل قرارگیری قوانین معاملاتی واقعی (فاز E پروژه).        |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"

#include <Trade\Trade.mqh>
CTrade trade;

input string InpBackendBaseUrl = "https://YOUR-DOMAIN-OR-IP";   // بدون / در انتها -- باید در Tools>Options>Expert Advisors مجاز شود
input string InpApiKey         = "";                             // کلید API این حساب (از بک‌اند گرفته می‌شود)
input int    InpHeartbeatSeconds = 30;
input int    InpSnapshotSeconds  = 60;
input int    InpTimerSeconds     = 5;
input int    InpCandleHistoryCount = 600; // تعداد کندل M1 بسته‌شده که برای تحلیل ستاپ فرستاده می‌شود

// --- اجرای خودکار سفارش (به دستور صریح الیاس فعال شد) ---
input bool   InpEnableTrading     = true;   // اجرای خودکار سیگنال‌های موتور تشخیص
input bool   InpAllowRealAccount  = false;  // پیش‌فرض: فقط حساب دمو. برای حساب واقعی باید صریحاً true شود
input double InpRiskPercent       = 1.0;    // سند: ریسک هر معامله ۱٪ سرمایه
input int    InpMaxSpreadPoints   = 50;     // سند: سقف اسپرد ۵۰ پوینت
input bool   InpTradeFamilyA      = true;   // زیرستاپ الف (Buy / ادامه)
input bool   InpTradeFamilyB      = true;   // زیرستاپ ب (Sell / شکست+پولبک)
input int    InpMaxOpenPositions  = 1;      // انتخاب پیاده‌سازی (نه سند): حداکثر پوزیشن هم‌زمان
input long   InpMagic             = 20260918;

string   g_queueFile      = "tradebot_queue.txt";
datetime g_lastHeartbeat  = 0;
datetime g_lastSnapshot   = 0;
datetime g_lastHistorySync = 0;
datetime g_lastAnalyzedBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpApiKey) == 0)
      Print("RobotTradingEA: InpApiKey تنظیم نشده — رویدادها ارسال نمی‌شوند تا این مقدار پر شود.");

   g_lastHistorySync = TimeCurrent() - 86400; // یک روز عقب‌تر، تا معاملات بسته‌شده اخیر هم بعد از ری‌استارت گزارش شوند
   EventSetTimer(InpTimerSeconds);
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
      // TODO فاز E: طبق قوانین دقیق سیستم معاملاتی، اینجا trade.Buy()/trade.Sell() فراخوانی می‌شود.
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

   SyncOpenPositions();
   SyncClosedDeals();
   SendSignalEvaluateOnNewBar();
   RetryQueue();
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

   // این درخواست عمداً در صف محلی ذخیره نمی‌شود: کندل بعدی دوباره کل تاریخچه را می‌فرستد
   // و اجرای سفارش با سیگنال قدیمی خطرناک است.
   string resp;
   if(!HttpPostJson("/events/signal-evaluate", json, resp))
      return;
   TryExecuteFromResponse(resp, lastClosedBarTime);
}

//+------------------------------------------------------------------+
//| پارس ساده JSON (پاسخ بک‌اند ساختار ثابت دارد)                      |
//+------------------------------------------------------------------+
string JsonString(const string json, const string key)
{
   string pat = "\"" + key + "\":\"";
   int p = StringFind(json, pat);
   if(p < 0)
      return "";
   p += StringLen(pat);
   int q = StringFind(json, "\"", p);
   if(q < 0)
      return "";
   return StringSubstr(json, p, q - p);
}

double JsonNumber(const string json, const string key, double def)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat);
   if(p < 0)
      return def;
   p += StringLen(pat);
   int q = p;
   int n = StringLen(json);
   while(q < n)
   {
      ushort ch = StringGetCharacter(json, q);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '+' || ch == 'e' || ch == 'E')
         q++;
      else
         break;
   }
   if(q == p)
      return def;
   return StringToDouble(StringSubstr(json, p, q - p));
}

int CountMyPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC) == InpMagic && PositionGetString(POSITION_SYMBOL) == _Symbol)
         count++;
   }
   return count;
}

// حجم بر اساس ریسک ٪ سرمایه؛ اگر حداقل لات بیشتر از ریسک مجاز شود، ۰ برمی‌گرداند (معامله نمی‌شود)
double CalcLots(double slDistance)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0)
      tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickValue <= 0 || slDistance <= 0)
      return 0.0;

   double lossPerLot = slDistance / tickSize * tickValue;
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lots = MathFloor(riskMoney / lossPerLot / step) * step;
   if(lots < minLot)
      return 0.0;
   return MathMin(lots, maxLot);
}

//+------------------------------------------------------------------+
//| اجرای سیگنال تازهٔ موتور تشخیص (فقط اگر روی همین کندل تازه بسته   |
//| شده باشد: age_candles == 0)                                       |
//+------------------------------------------------------------------+
void DebugLog(const string msg)
{
   int h = FileOpen("tradebot_debug.txt", FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(h == INVALID_HANDLE)
      return;
   FileSeek(h, 0, SEEK_END);
   FileWrite(h, TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + " | " + msg);
   FileClose(h);
}

void TryExecuteFromResponse(const string resp, datetime barTime)
{
   if(!InpEnableTrading)
      return;

   int s = StringFind(resp, "\"signal\":{");
   if(s < 0)
      return; // بدون سیگنال
   string sig = StringSubstr(resp, s);

   string dir    = JsonString(sig, "direction");
   string family = JsonString(sig, "setup_family");
   double sl     = JsonNumber(sig, "stop_loss", 0);
   double tp     = JsonNumber(sig, "take_profit", 0);
   int    age    = (int)JsonNumber(sig, "age_candles", 99);
   DebugLog("signal dir=" + dir + " fam=" + family + " sl=" + DoubleToString(sl, 2) + " tp=" + DoubleToString(tp, 2) + " age=" + IntegerToString(age));
   if(age != 0 || (dir != "buy" && dir != "sell") || sl <= 0 || tp <= 0)
   {
      DebugLog("  skip: age/dir/sl/tp invalid");
      return;
   }

   if((family == "A" && !InpTradeFamilyA) || (family == "B" && !InpTradeFamilyB))
   {
      DebugLog("  skip: family disabled");
      return;
   }

   // --- محافظ‌ها ---
   bool isDemo = (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
   if(!isDemo && !InpAllowRealAccount)
   {
      DebugLog("  skip: real account and InpAllowRealAccount=false");
      Print("RobotTradingEA: حساب واقعی است و InpAllowRealAccount=false -- سفارش داده نشد.");
      return;
   }
   if(StringFind(_Symbol, "XAUUSD") < 0)
   {
      DebugLog("  skip: symbol " + _Symbol);
      return; // سند: فقط XAUUSD
   }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      DebugLog("  skip: algo trading not allowed (terminal or EA Common tab)");
      Print("RobotTradingEA: Algo Trading غیرفعال است -- سفارش داده نشد.");
      return;
   }
   if(GlobalVariableCheck("TB_RED_STATUS") && GlobalVariableGet("TB_RED_STATUS") != 0)
   {
      DebugLog("  skip: red status");
      Print("RobotTradingEA: وضعیت قرمز (CR-003) فعال است -- سفارش جدید ممنوع.");
      return;
   }
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > InpMaxSpreadPoints)
   {
      DebugLog("  skip: spread " + IntegerToString((int)spread) + " > " + IntegerToString(InpMaxSpreadPoints));
      Print("RobotTradingEA: اسپرد از سقف مجاز بیشتر است -- سفارش داده نشد.");
      return;
   }
   if(CountMyPositions() >= InpMaxOpenPositions)
   {
      DebugLog("  skip: max open positions");
      return;
   }
   if(GlobalVariableCheck("TB_LAST_BAR") && (datetime)(long)GlobalVariableGet("TB_LAST_BAR") == barTime)
   {
      DebugLog("  skip: already traded this bar");
      return; // روی همین کندل قبلاً سفارش داده شده
   }

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double minStop = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   // سمت درست SL/TP نسبت به قیمت فعلی (ممکن است قیمت از سیگنال گذشته باشد)
   bool sidesOk = (dir == "buy") ? (sl < bid - minStop && tp > ask + minStop)
                                 : (sl > ask + minStop && tp < bid - minStop);
   if(!sidesOk)
   {
      DebugLog("  skip: SL/TP wrong side vs price bid=" + DoubleToString(bid, 2) + " ask=" + DoubleToString(ask, 2) + " minStop=" + DoubleToString(minStop, 2));
      return;
   }

   double entryPrice = (dir == "buy") ? ask : bid;
   double lots = CalcLots(MathAbs(entryPrice - sl));
   if(lots <= 0)
   {
      DebugLog("  skip: lots=0 (min lot exceeds risk) slDist=" + DoubleToString(MathAbs(entryPrice - sl), 2));
      Print("RobotTradingEA: حجم محاسبه‌شده کمتر از حداقل لات است (حد ضرر برای ریسک ", InpRiskPercent, "٪ زیادی دور است) -- سفارش داده نشد.");
      return;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);
   string comment = "TB-" + family;
   bool ok = (dir == "buy") ? trade.Buy(lots, _Symbol, 0, sl, tp, comment)
                            : trade.Sell(lots, _Symbol, 0, sl, tp, comment);
   if(ok)
   {
      GlobalVariableSet("TB_LAST_BAR", (double)(long)barTime);
      DebugLog("  ORDER SENT " + dir + " lots=" + DoubleToString(lots, 2));
      Print("RobotTradingEA: سفارش ", dir, " ", DoubleToString(lots, 2), " لات، SL=", sl, " TP=", tp, " (ستاپ ", family, ")");
   }
   else
   {
      DebugLog("  ORDER FAILED " + IntegerToString((int)trade.ResultRetcode()) + " " + trade.ResultRetcodeDescription());
      Print("RobotTradingEA: ارسال سفارش شکست خورد: ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| محل قوانین استراتژی — فعلاً placeholder (نگاه کنید به            |
//| ea/shared/STRATEGY_NOTES.md برای فاز E)                          |
//+------------------------------------------------------------------+
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
   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin       = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin   = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLevel  = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);

   string json = "{";
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
   string info = TerminalInfoString(TERMINAL_NAME) + " / " + AccountInfoString(ACCOUNT_SERVER);
   string json = "{\"ea_version\":\"1.0-mt5\",\"terminal_info\":\"" + JsonEscape(info) + "\"}";
   PostOrQueue("/events/heartbeat", json);
}

//+------------------------------------------------------------------+
//| گزارش تمام پوزیشن‌های باز (idempotent -- بک‌اند بر اساس ticket   |
//| بازنویسی می‌کند، پس ارسال تکراری مشکلی ایجاد نمی‌کند)             |
//+------------------------------------------------------------------+
void SyncOpenPositions()
{
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      string symbol   = PositionGetString(POSITION_SYMBOL);
      long   type     = PositionGetInteger(POSITION_TYPE);
      string direction = (type == POSITION_TYPE_BUY) ? "buy" : "sell";
      double volume   = PositionGetDouble(POSITION_VOLUME);
      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      double swap = PositionGetDouble(POSITION_SWAP);

      string json = BuildTradeJson(IntegerToString((long)ticket), symbol, direction, volume,
                                    openTime, openPrice, 0, 0,
                                    sl, tp, profit, 0, swap, "open");
      PostOrQueue("/events/trade", json);
   }
}

//+------------------------------------------------------------------+
//| گزارش پوزیشن‌های تازه بسته‌شده از تاریخچه معاملات                |
//+------------------------------------------------------------------+
void SyncClosedDeals()
{
   datetime from = g_lastHistorySync;
   datetime to   = TimeCurrent();
   if(!HistorySelect(from, to))
      return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0)
         continue;
      if((long)HistoryDealGetInteger(dealTicket, DEAL_ENTRY) != DEAL_ENTRY_OUT)
         continue;

      long posId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      ReportClosedPosition(posId);
   }
   g_lastHistorySync = to;
}

void ReportClosedPosition(long posId)
{
   if(!HistorySelectByPosition(posId))
      return;

   int total = HistoryDealsTotal();
   datetime openTime = 0, closeTime = 0;
   double openPrice = 0, closePrice = 0;
   double profit = 0, commission = 0, swap = 0, volume = 0;
   string symbol = "";
   string direction = "buy";

   for(int i = 0; i < total; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);

      if(entry == DEAL_ENTRY_IN)
      {
         openTime  = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
         openPrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
         symbol    = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
         volume    = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
         direction = (HistoryDealGetInteger(dealTicket, DEAL_TYPE) == DEAL_TYPE_BUY) ? "buy" : "sell";
      }
      else if(entry == DEAL_ENTRY_OUT)
      {
         closeTime  = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
         closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      }

      profit     += HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      commission += HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      swap       += HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   }

   string json = BuildTradeJson(IntegerToString(posId), symbol, direction, volume,
                                 openTime, openPrice, closeTime, closePrice,
                                 0, 0, profit, commission, swap, "closed");
   PostOrQueue("/events/trade", json);
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

// MT5 TimeCurrent() زمان سرور بروکر است، نه UTC -- برای دقت کامل باید آفست سرور را جدا محاسبه کرد.
string TimeToIso(datetime t)
{
   string s = TimeToString(t, TIME_DATE | TIME_SECONDS); // "2026.09.18 12:34:56"
   StringReplace(s, ".", "-");
   StringReplace(s, " ", "T");
   return s + "Z";
}

bool HttpPostJson(string path, string jsonBody, string &responseOut)
{
   string url = InpBackendBaseUrl + path;
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n";

   uchar data[];
   int len = StringToCharArray(jsonBody, data, 0, -1, CP_UTF8) - 1;
   ArrayResize(data, len);

   uchar result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers, 5000, data, result, resultHeaders);
   if(status == -1)
   {
      Print("RobotTradingEA: خطای WebRequest ", GetLastError(),
            " -- آیا آدرس بک‌اند در Tools > Options > Expert Advisors > Allow WebRequest مجاز شده؟");
      return false;
   }

   responseOut = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return (status >= 200 && status < 300);
}

void PostOrQueue(string path, string json)
{
   string resp;
   if(!HttpPostJson(path, json, resp))
      QueueEvent(path, json);
}

//+------------------------------------------------------------------+
//| صف محلی برای رویدادهایی که ارسالشان شکست خورده (قطعی شبکه و...) |
//+------------------------------------------------------------------+
void QueueEvent(string path, string jsonBody)
{
   int handle = FileOpen(g_queueFile, FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE)
      handle = FileOpen(g_queueFile, FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE)
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
   if(handle == INVALID_HANDLE)
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
   if(wh != INVALID_HANDLE)
   {
      if(StringLen(remaining) > 0)
         FileWriteString(wh, remaining);
      FileClose(wh);
   }
}
