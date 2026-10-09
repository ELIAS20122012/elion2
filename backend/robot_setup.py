"""One-time: robot tables, a robot account if none, and its EA key → robot-key.txt (next to this file's backend)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from journal import db, robot
db.init(); robot.init()
with db.db() as con:
    for r in con.execute("SELECT id, name, platform, kind, login FROM accounts ORDER BY id"):
        print("account", dict(r))
    r = con.execute("SELECT id FROM accounts WHERE kind='robot' ORDER BY id LIMIT 1").fetchone()
    if r:
        acc = r["id"]
    else:
        acc = con.execute("INSERT INTO accounts (name, platform, kind, created_at) VALUES ('Robot (MT4 demo)','mt4','robot',?)", (db.now(),)).lastrowid
        print("created robot account", acc)
    has = con.execute("SELECT 1 FROM robot_keys WHERE account_id=?", (acc,)).fetchone()
if not has:
    key = robot.new_key(acc)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "robot-key.txt"), "w") as f:
        f.write(f"account_id={acc}\nInpBackendBaseUrl=http://127.0.0.1:8000\nInpApiKey={key}\n")
    print("key written for account", acc)
else:
    print("key already exists for account", acc)
