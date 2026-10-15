//+------------------------------------------------------------------+
//| EliasBridge.mq4 — read-only bridge between MT4 and Elias OS       |
//| Writes account / open orders / history as JSON to                 |
//|   <Common>\Files\EliasOS\  and draws levels from draw.txt.        |
//| It NEVER opens, modifies or closes orders.                        |
//+------------------------------------------------------------------+
#property strict
#property description "Elias OS bridge (read-only): exports account + trades, draws levels"

input int UpdateSeconds = 5;   // export interval
input int HistoryDays   = 30;  // closed trades to export

string DIR = "EliasOS\\";

int OnInit()
  {
   EventSetTimer(MathMax(1, UpdateSeconds));
   CaptureChart();
   Export();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { CaptureChart(); Export(); Draw(); }
// Export and drawing use the timer. Do not write files on every tick.
// This prevents repeated file access and reduces contention with Elias OS.
void OnTick()  { }

string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return(s);
  }

string D(double v, int digits) { return(DoubleToString(v, digits)); }

double RiskMoney()
  {
   if(OrderStopLoss() <= 0) return(-1);
   double tv = MarketInfo(OrderSymbol(), MODE_TICKVALUE);
   double ts = MarketInfo(OrderSymbol(), MODE_TICKSIZE);
   if(ts <= 0) return(-1);
   return(MathAbs(OrderOpenPrice() - OrderStopLoss()) / ts * tv * OrderLots());
  }

string OrderJson(bool hist)
  {
   string s = "{\"ticket\":" + IntegerToString(OrderTicket())
            + ",\"symbol\":\"" + Esc(OrderSymbol()) + "\""
            + ",\"type\":" + IntegerToString(OrderType())
            + ",\"lots\":" + D(OrderLots(), 2)
            + ",\"open_price\":" + D(OrderOpenPrice(), 5)
            + ",\"sl\":" + D(OrderStopLoss(), 5)
            + ",\"tp\":" + D(OrderTakeProfit(), 5)
            + ",\"open_time\":\"" + TimeToString(OrderOpenTime(), TIME_DATE | TIME_SECONDS) + "\""
            + ",\"profit\":" + D(OrderProfit() + OrderSwap() + OrderCommission(), 2)
            + ",\"comment\":\"" + Esc(OrderComment()) + "\""
            + ",\"magic\":" + IntegerToString(OrderMagicNumber());
   if(hist)
      s += ",\"close_price\":" + D(OrderClosePrice(), 5)
         + ",\"close_time\":\"" + TimeToString(OrderCloseTime(), TIME_DATE | TIME_SECONDS) + "\"";
   else
      s += ",\"risk_money\":" + D(RiskMoney(), 2);
   return(s + "}");
  }

void WriteFile(string name, string content)
  {
   int h = FileOpen(DIR + name + ".tmp", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, content);
   FileClose(h);
   FileMove(DIR + name + ".tmp", FILE_COMMON, DIR + name, FILE_COMMON | FILE_REWRITE);
  }

void CaptureChart()
  {
   if(FileIsExist("chart.png"))
     {
      FileCopy("chart.png", 0, DIR + "chart.png", FILE_COMMON | FILE_REWRITE);
      FileCopy("chart.png", 0, DIR + "chart_" + Symbol() + ".png", FILE_COMMON | FILE_REWRITE);
     }
   ChartScreenShot(0, "chart.png", 1280, 720, ALIGN_RIGHT);
   string cinfo = "{\"symbol\":\"" + Esc(Symbol()) + "\""
                + ",\"period\":" + IntegerToString(Period())
                + ",\"bid\":" + D(Bid, Digits)
                + ",\"ask\":" + D(Ask, Digits)
                + ",\"time\":\"" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + "\"}";
   WriteFile("chart.json", cinfo);
  }

void Export()
  {
   datetime dayStart = StrToTime(TimeToString(TimeCurrent(), TIME_DATE));
   double floating = 0, todayPl = 0;
   int todayCount = 0;
   string open = "";
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() <= OP_SELL) floating += OrderProfit() + OrderSwap() + OrderCommission();
      open += (open == "" ? "" : ",") + OrderJson(false);
     }
   string hist = "";
   datetime from = TimeCurrent() - HistoryDays * 86400;
   for(int j = OrdersHistoryTotal() - 1; j >= 0; j--)
     {
      if(!OrderSelect(j, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderType() > OP_SELL || OrderCloseTime() < from) continue;
      if(OrderCloseTime() >= dayStart) { todayPl += OrderProfit() + OrderSwap() + OrderCommission(); todayCount++; }
      hist += (hist == "" ? "" : ",") + OrderJson(true);
     }
   string acc = "{\"login\":" + IntegerToString(AccountNumber())
              + ",\"name\":\"" + Esc(AccountName()) + "\""
              + ",\"server\":\"" + Esc(AccountServer()) + "\""
              + ",\"company\":\"" + Esc(AccountCompany()) + "\""
              + ",\"currency\":\"" + Esc(AccountCurrency()) + "\""
              + ",\"balance\":" + D(AccountBalance(), 2)
              + ",\"equity\":" + D(AccountEquity(), 2)
              + ",\"margin\":" + D(AccountMargin(), 2)
              + ",\"free_margin\":" + D(AccountFreeMargin(), 2)
              + ",\"leverage\":" + IntegerToString(AccountLeverage())
              + ",\"floating_pl\":" + D(floating, 2)
              + ",\"today_closed_pl\":" + D(todayPl, 2)
              + ",\"today_closed_count\":" + IntegerToString(todayCount)
              + ",\"server_time\":\"" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + "\""
              + ",\"chart_symbol\":\"" + Esc(Symbol()) + "\""
              + ",\"open\":[" + open + "]}";
   WriteFile("account.json", acc);
   WriteFile("history.json", "[" + hist + "]");
  }

// draw.txt lines:  CLEAR   |   SYMBOL|PRICE|res/sup/other|label   (SYMBOL * = this chart)
void Draw()
  {
   if(!FileIsExist(DIR + "draw.txt", FILE_COMMON)) return;
   int h = FileOpen(DIR + "draw.txt", FILE_READ | FILE_TXT | FILE_UNICODE | FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   int n = 0;
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      StringTrimLeft(line); StringTrimRight(line);
      if(line == "") continue;
      if(line == "CLEAR") { ObjectsDeleteAll(0, "Elias_"); continue; }
      string p[];
      if(StringSplit(line, '|', p) < 2) continue;
      if(p[0] != "*" && p[0] != Symbol()) continue;
      double price = StringToDouble(p[1]);
      if(price <= 0) continue;
      color c = clrGold;
      if(ArraySize(p) > 2 && p[2] == "res") c = clrRed;
      if(ArraySize(p) > 2 && p[2] == "sup") c = clrLimeGreen;
      string name = "Elias_" + IntegerToString(n++) + "_" + p[1];
      ObjectDelete(0, name);
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, name, OBJPROP_COLOR, c);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
      ObjectSetString(0, name, OBJPROP_TEXT, ArraySize(p) > 3 ? p[3] : "");
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, true);
     }
   FileClose(h);
   FileDelete(DIR + "draw.txt", FILE_COMMON);
   ChartRedraw();
  }
