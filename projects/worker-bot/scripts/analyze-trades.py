#!/usr/bin/env python3
import psycopg2
import json
from datetime import datetime, timedelta
from collections import defaultdict

def connect_db():
    return psycopg2.connect(
        host="localhost", database="hft", user="hft", password="hft"
    )

def get_trade_stats(hours=24):
    conn = connect_db()
    cur = conn.cursor()
    
    cutoff = datetime.now() - timedelta(hours=hours)
    
    cur.execute("""
        SELECT 
            strategy,
            COUNT(*) as count,
            AVG(net_profit_percent) as avg_profit,
            MIN(net_profit_percent) as min_profit,
            MAX(net_profit_percent) as max_profit,
            SUM(net_profit_percent * size_usd / 100) as total_pnl
        FROM trades
        WHERE created_at > %s
        GROUP BY strategy
        ORDER BY total_pnl DESC
    """, (cutoff,))
    
    print(f"\n📊 Trade Analytics (Last {hours}h)")
    print("=" * 60)
    
    for row in cur.fetchall():
        strategy, count, avg, min_p, max_p, total_pnl = row
        print(f"\n{strategy}:")
        print(f"  Trades: {count}")
        print(f"  Avg Profit: {avg:.4f}%")
        print(f"  Range: {min_p:.4f}% → {max_p:.4f}%")
        print(f"  Total PnL: ${total_pnl:.2f}" if total_pnl else "  Total PnL: $0.00")
    
    conn.close()

def get_opportunity_detection():
    """Analyze which opportunities are being detected"""
    conn = connect_db()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT 
            strategy,
            buy_exchange,
            sell_exchange,
            COUNT(*) as frequency
        FROM trades
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY strategy, buy_exchange, sell_exchange
        ORDER BY frequency DESC
        LIMIT 20
    """)
    
    print("\n🎯 Opportunity Detection (Last 1h)")
    print("=" * 60)
    for row in cur.fetchall():
        print(f"{row[0]:20} {row[1]:10} → {row[2]:10}: {row[3]} times")
    
    conn.close()

if __name__ == "__main__":
    try:
        get_trade_stats(24)
        get_opportunity_detection()
    except Exception as e:
        print(f"Error: {e}")
