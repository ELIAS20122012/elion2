//+------------------------------------------------------------------+
//| JournalBridge.mq4                                                |
//|                                                                  |
//| READ-ONLY. This is an INDICATOR: it cannot open, close or modify |
//| any order, and it does not need the AutoTrading button.          |
//|                                                                  |
//| Every second it writes the state of the logged-in account        |
//| (open positions) and, when history changes, the closed trades    |
//| into  <MetaQuotes>\Terminal\Common\Files  as plain text files,   |
//| which the journal app reads. No network access is used.          |
//+------------------------------------------------------------------+
#property copyright "Robot Trading"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property description "Read-only: exports open/closed positions for the journal app. Places no orders."

input int InpIntervalSec = 1;    // update interval (seconds)
input int InpHistoryDays = 90;   // how many days of closed trades to export

string g_login     = "";
string g_openFile  = "";
string g_histFile  = "";
int    g_histCount = -1;

//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(MathMax(1, InpIntervalSec));
   Export();
   return(INIT_SUCCEEDED);
}
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   return(rates_total);
}
//+------------------------------------------------------------------+
void OnTimer()
{
   Export();
}
//+------------------------------------------------------------------+
string Clean(string v)
{
   StringReplace(v, ";", ",");
   StringReplace(v, "\r", " ");
   StringReplace(v, "\n", " ");
   return(v);
}
//+------------------------------------------------------------------+
// Write to a temp file and move it over the target so the reader never sees a half-written file.
bool WriteAtomic(string finalName, string content)
{
   string tmp = finalName + ".tmp";
   int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return(false);
   FileWriteString(h, content);
   FileClose(h);
   if(FileMove(tmp, FILE_COMMON, finalName, FILE_REWRITE | FILE_COMMON))
      return(true);
   // fallback: the reader had the target open; write it directly
   h = FileOpen(finalName, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return(false);
   FileWriteString(h, content);
   FileClose(h);
   return(true);
}
//+------------------------------------------------------------------+
void Export()
{
   int acct = AccountNumber();
   if(acct <= 0)
      return;                              // not logged in

   string login = IntegerToString(acct);
   if(login != g_login)                    // first run, or the user switched account
   {
      g_login     = login;
      g_openFile  = "journal_open_" + login + ".csv";
      g_histFile  = "journal_hist_" + login + ".csv";
      g_histCount = -1;
      Comment("JournalBridge (read-only): exporting account ", login);
   }

   int hc = OrdersHistoryTotal();
   if(hc != g_histCount)
   {
      if(WriteHistory())
         g_histCount = hc;
   }
   WriteOpen();
}
//+------------------------------------------------------------------+
bool WriteOpen()
{
   string s = "#v1\n";
   s += "A;" + IntegerToString(AccountNumber()) + ";" + Clean(AccountServer()) + ";" + Clean(AccountCompany()) + ";"
        + DoubleToString(AccountBalance(), 2) + ";" + DoubleToString(AccountEquity(), 2) + ";"
        + DoubleToString(AccountMargin(), 2) + ";" + Clean(AccountCurrency()) + ";"
        + IntegerToString((int)TimeCurrent()) + "\n";

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      int t = OrderType();
      if(t != OP_BUY && t != OP_SELL)
         continue;                         // skip pending orders
      s += "O;" + IntegerToString(OrderTicket()) + ";" + Clean(OrderSymbol()) + ";" + (t == OP_BUY ? "buy" : "sell") + ";"
           + DoubleToString(OrderLots(), 2) + ";" + IntegerToString((int)OrderOpenTime()) + ";"
           + DoubleToString(OrderOpenPrice(), 8) + ";" + DoubleToString(OrderStopLoss(), 8) + ";"
           + DoubleToString(OrderTakeProfit(), 8) + ";" + DoubleToString(OrderProfit(), 2) + ";"
           + DoubleToString(OrderSwap(), 2) + ";" + DoubleToString(OrderCommission(), 2) + ";"
           + Clean(OrderComment()) + "\n";
   }
   return(WriteAtomic(g_openFile, s));
}
//+------------------------------------------------------------------+
bool WriteHistory()
{
   int from = (int)TimeCurrent() - InpHistoryDays * 86400;
   string s = "#v1\n";
   int n = OrdersHistoryTotal();
   for(int i = 0; i < n; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      int t = OrderType();
      if(t != OP_BUY && t != OP_SELL)
         continue;                         // skip balance operations and cancelled pending orders
      int ct = (int)OrderCloseTime();
      if(ct <= 0 || ct < from)
         continue;
      s += "H;" + IntegerToString(OrderTicket()) + ";" + Clean(OrderSymbol()) + ";" + (t == OP_BUY ? "buy" : "sell") + ";"
           + DoubleToString(OrderLots(), 2) + ";" + IntegerToString((int)OrderOpenTime()) + ";"
           + DoubleToString(OrderOpenPrice(), 8) + ";" + IntegerToString(ct) + ";"
           + DoubleToString(OrderClosePrice(), 8) + ";" + DoubleToString(OrderStopLoss(), 8) + ";"
           + DoubleToString(OrderTakeProfit(), 8) + ";" + DoubleToString(OrderProfit(), 2) + ";"
           + DoubleToString(OrderSwap(), 2) + ";" + DoubleToString(OrderCommission(), 2) + ";"
           + Clean(OrderComment()) + "\n";
   }
   return(WriteAtomic(g_histFile, s));
}
//+------------------------------------------------------------------+
