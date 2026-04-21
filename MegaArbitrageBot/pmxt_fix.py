# pmxt_fix.py
class PolymarketClient:
    def __init__(self):
        print("✅ Polymarket Client Ready")
    
    def get_btc_15min_markets(self):
        return [{'id': '1', 'question': 'Will BTC go up in 15 min?'}]
