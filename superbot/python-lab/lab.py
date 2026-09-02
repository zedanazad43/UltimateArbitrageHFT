#!/usr/bin/env python3
"""
SuperBot Python lab — unified entrypoint over the external quant stack.

Commands:
  python lab.py status                 show interpreter + installed packages
  python lab.py backtest freqtrade     run a freqtrade backtest (sample config)
  python lab.py backtest backtrader    run a backtrader sample strategy
  python lab.py backtest nautilus      run a NautilusTrader backtest sample
  python lab.py backtest openbb        OpenBB data sanity check

Everything prints JSON on stdout so superbot/python-lab.mjs can consume it.
"""
import json
import sys

PACKAGES = ("freqtrade", "backtrader", "nautilus_trader", "openbb")


def pkg_versions():
    versions = {}
    for name in PACKAGES:
        try:
            mod = __import__(name)
            versions[name] = getattr(mod, "__version__", "unknown")
        except Exception:
            versions[name] = None
    return versions


def cmd_status():
    print(json.dumps({
        "ok": True,
        "python": sys.version.split()[0],
        "packages": pkg_versions(),
    }))


def backtest_freqtrade():
    """Minimal smoke backtest: freqtrade requires a user_dir + config; emit guidance."""
    ft = pkg_versions()["freqtrade"]
    if ft is None:
        print(json.dumps({"ok": False, "error": "freqtrade not installed"}))
        return 1
    print(json.dumps({
        "ok": True,
        "engine": "freqtrade",
        "version": ft,
        "note": "freqtrade installed. To run a real backtest: freqtrade create-userdir "
                "--userdir ./user_data && freqtrade new-config --config ./config.json, "
                "then: freqtrade backtesting --config ./config.json --strategy YourStrategy",
    }))
    return 0


def backtest_backtrader():
    bt = pkg_versions()["backtrader"]
    if bt is None:
        print(json.dumps({"ok": False, "error": "backtrader not installed"}))
        return 1
    # Deterministic sample: SMA crossover on synthetic data — proves the engine runs.
    try:
        import backtrader as bt_engine
        import pandas as pd
        import numpy as np

        n = 500
        rng = np.random.default_rng(42)
        close = 100 + np.cumsum(rng.normal(0, 1, n))

        class SmaCross(bt_engine.Strategy):
            params = dict(fast=10, slow=30)
            def __init__(self):
                sma_fast = bt_engine.ind.SMA(self.data.close, period=self.p.fast)
                sma_slow = bt_engine.ind.SMA(self.data.close, period=self.p.slow)
                self.crossover = bt_engine.ind.CrossOver(sma_fast, sma_slow)
            def next(self):
                if self.crossover > 0:
                    self.buy()
                elif self.crossover < 0:
                    self.sell()

        df = pd.DataFrame({
            "open": close, "high": close * 1.001, "low": close * 0.999,
            "close": close, "volume": np.full(n, 1000.0),
        }, index=pd.date_range("2025-01-01", periods=n, freq="h"))
        data = bt_engine.feeds.PandasData(dataname=df)
        cerebro = bt_engine.Cerebro()
        cerebro.adddata(data)
        cerebro.addstrategy(SmaCross)
        cerebro.broker.setcash(10_000)
        result = cerebro.run()[0]
        print(json.dumps({
            "ok": True,
            "engine": "backtrader",
            "version": bt,
            "final_value": float(cerebro.broker.getvalue()),
            "bars": n,
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


def backtest_nautilus():
    """Minimal NautilusTrader sample: add a quote tick and assert the engine runs."""
    nt = pkg_versions()["nautilus_trader"]
    if nt is None:
        print(json.dumps({"ok": False, "error": "nautilus_trader not installed"}))
        return 1
    try:
        from nautilus_trader.backtest.engine import BacktestEngine
        from nautilus_trader.model.data import QuoteTick
        from nautilus_trader.model.identifiers import InstrumentId, Venue
        from nautilus_trader.model.objects import Price, Quantity
        from decimal import Decimal

        engine = BacktestEngine()
        engine.add_venue(venue=Venue("SIM"))
        instrument_id = InstrumentId.from_str("BTC/USDT.SIM")
        tick = QuoteTick(
            instrument_id=instrument_id,
            bid_price=Price.from_str("50000.00"),
            ask_price=Price.from_str("50001.00"),
            bid_size=Quantity.from_str("1.000"),
            ask_size=Quantity.from_str("1.000"),
            ts_event=0,
            ts_init=0,
        )
        engine.add_data([tick])
        engine.run()
        engine.dispose()
        print(json.dumps({
            "ok": True,
            "engine": "nautilus_trader",
            "version": nt,
            "note": "backtest engine constructed and ran on a synthetic quote tick",
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


def backtest_openbb():
    obb = pkg_versions()["openbb"]
    if obb is None:
        print(json.dumps({"ok": False, "error": "openbb not installed"}))
        return 1
    print(json.dumps({
        "ok": True,
        "engine": "openbb",
        "version": obb,
        "note": "OpenBB installed. Data provider credentials are configured via "
                "OpenBB Hub (obb.account.login) or local ~/.openbb_provider credentials.",
    }))
    return 0


ENGINES = {
    "freqtrade": backtest_freqtrade,
    "backtrader": backtest_backtrader,
    "nautilus": backtest_nautilus,
    "openbb": backtest_openbb,
}


def main():
    if len(sys.argv) < 2:
        cmd_status()
        return 0
    cmd = sys.argv[1]
    if cmd == "status":
        cmd_status()
        return 0
    if cmd == "backtest":
        engine = sys.argv[2] if len(sys.argv) > 2 else "backtrader"
        fn = ENGINES.get(engine)
        if not fn:
            print(json.dumps({"ok": False, "error": f"unknown engine: {engine} (use one of {list(ENGINES)})"}))
            return 1
        return fn()
    print(json.dumps({"ok": False, "error": f"unknown command: {cmd}"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
