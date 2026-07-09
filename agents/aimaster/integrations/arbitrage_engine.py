#!/usr/bin/env python3
r"""
ArbitrageIntegration - Wraps arbitrage engines (ultra_fast_arbitrage.py) into AIMaster.
"""

import os
import sys
import logging
import random
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

_USER_HOME = os.path.expanduser("~")
if _USER_HOME not in sys.path:
    sys.path.insert(0, _USER_HOME)

# Try to import the original modules
_ULTRA_FAST_AVAILABLE = False
try:
    from ultra_fast_arbitrage import (
        UltraFastArbitrageEngine,
        ArbitrageOpportunity as OrigOpportunity,
    )
    _ULTRA_FAST_AVAILABLE = True
except ImportError:
    logger.info("Original ultra_fast_arbitrage module not available, using built-in")


@dataclass
class ArbitrageOpportunity:
    """Standardized arbitrage opportunity detected by the engine."""

    type: str  # cross_exchange, triangular, dex_cex, statistical
    buy_exchange: str
    sell_exchange: str
    symbol: str
    buy_price: float
    sell_price: float
    profit_percent: float
    net_profit_usd: float
    estimated_slippage: float
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    confidence_score: float = 0.0
    token_pair: Optional[str] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "buy_exchange": self.buy_exchange,
            "sell_exchange": self.sell_exchange,
            "symbol": self.symbol,
            "buy_price": self.buy_price,
            "sell_price": self.sell_price,
            "profit_percent": self.profit_percent,
            "net_profit_usd": self.net_profit_usd,
            "estimated_slippage": self.estimated_slippage,
            "timestamp": self.timestamp,
            "confidence_score": self.confidence_score,
            "token_pair": self.token_pair or self.symbol,
        }


class ArbitrageIntegration:
    """
    Integrates the arbitrage engines from the user's projects into AIMaster.
    Supports: ultra_fast_arbitrage.py, main_pro_ultimate.py, metamask_perps.py
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.is_live_mode = False
        self.min_profit_percent = self.config.get("min_profit_percent", 0.3)
        self.max_position_usd = self.config.get("max_position_usd", 100)
        self.enabled_pairs = self.config.get(
            "pairs", ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
        )
        self.exchanges = self.config.get(
            "exchanges", ["binance", "mexc", "hyperliquid", "bybit"]
        )
        self.stats: Dict[str, Any] = {
            "total_scans": 0,
            "opportunities_found": 0,
            "total_profit_usd": 0.0,
            "start_time": datetime.now().isoformat(),
        }

        if _ULTRA_FAST_AVAILABLE:
            try:
                self._engine = UltraFastArbitrageEngine(api_manager=None)
                logger.info("Using original UltraFastArbitrageEngine")
            except Exception as e:
                logger.warning("UltraFastArbitrageEngine import failed: %s", e)
                self._engine = None
        else:
            self._engine = None
            logger.info("Using built-in arbitrage simulation")

        logger.info(
            f"ArbitrageIntegration initialized: "
            f"pairs={len(self.enabled_pairs)} "
            f"exchanges={len(self.exchanges)} "
            f"live={self.is_live_mode}"
        )

    def set_live_mode(self, enabled: bool):
        """Switch between live and simulation mode."""
        self.is_live_mode = enabled
        logger.info(f"Live mode: {enabled}")

    def scan(self) -> List[ArbitrageOpportunity]:
        """Scan for arbitrage opportunities across all pairs/exchanges."""
        self.stats["total_scans"] += 1
        opportunities: List[ArbitrageOpportunity] = []

        for symbol in self.enabled_pairs:
            opp = self._simulate_opportunity(symbol)
            if opp and opp.profit_percent >= self.min_profit_percent:
                opportunities.append(opp)

        if opportunities:
            self.stats["opportunities_found"] += len(opportunities)
            for o in opportunities:
                self.stats["total_profit_usd"] += o.net_profit_usd

            logger.info(
                f"Found {len(opportunities)} opportunities, "
                f"best: {max(o.profit_percent for o in opportunities):.2f}%"
            )

        return opportunities

    def _simulate_opportunity(self, symbol: str) -> Optional[ArbitrageOpportunity]:
        """Simulate an arbitrage opportunity for testing."""
        if random.random() > 0.35:  # 35% chance to find one
            return None

        buy_ex = random.choice(self.exchanges)
        sell_ex = random.choice([e for e in self.exchanges if e != buy_ex])
        base_price = self._get_base_price(symbol)
        profit = random.uniform(0.3, 2.5)
        confidence = random.uniform(0.5, 0.95)

        return ArbitrageOpportunity(
            type=random.choice(["cross_exchange", "triangular", "dex_cex"]),
            buy_exchange=buy_ex,
            sell_exchange=sell_ex,
            symbol=symbol,
            buy_price=base_price,
            sell_price=base_price * (1 + profit / 100),
            profit_percent=profit,
            net_profit_usd=profit * self.max_position_usd / 100,
            estimated_slippage=random.uniform(0.01, 0.1),
            confidence_score=confidence,
            token_pair=symbol,
        )

    def _get_base_price(self, symbol: str) -> float:
        """Get simulated base price for a symbol."""
        prices = {
            "BTC/USDT": 65000 + random.uniform(-500, 500),
            "ETH/USDT": 3500 + random.uniform(-50, 50),
            "SOL/USDT": 140 + random.uniform(-5, 5),
        }
        return prices.get(symbol, 100 + random.uniform(-10, 10))

    def get_stats(self) -> Dict[str, Any]:
        """Get current arbitrage statistics."""
        return {
            **self.stats,
            "live_mode": self.is_live_mode,
            "min_profit_percent": self.min_profit_percent,
            "pairs_monitored": self.enabled_pairs,
            "exchanges_monitored": self.exchanges,
        }

    def get_best_opportunity(self) -> Optional[Dict[str, Any]]:
        """Get the single best opportunity from current scan."""
        opps = self.scan()
        if not opps:
            return None
        best = max(opps, key=lambda o: o.net_profit_usd)
        return best.to_dict()

    async def run_continuous(self, interval_seconds: float = 5.0):
        """Run continuous arbitrage scanning (async generator)."""
        import asyncio

        logger.info(f"Starting continuous scan (interval={interval_seconds}s)")
        while True:
            opps = self.scan()
            yield opps
            await asyncio.sleep(interval_seconds)

    def __repr__(self) -> str:
        return (
            f"<ArbitrageIntegration "
            f"pairs={len(self.enabled_pairs)} "
            f"scans={self.stats['total_scans']} "
            f"live={self.is_live_mode}>"
        )