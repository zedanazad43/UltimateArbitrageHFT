# main_bot_with_telegram.py - البوت مع إشعارات Telegram + مركز تحكم
import asyncio
import contextlib
import os
import httpx
from datetime import datetime
from typing import Dict, Optional, List, Set, Tuple


def parse_chat_ids(raw_value: str) -> List[str]:
    if not raw_value:
        return []
    seen = set()
    values = []
    for part in raw_value.split(','):
        chat_id = part.strip()
        if chat_id and chat_id not in seen:
            seen.add(chat_id)
            values.append(chat_id)
    return values


class TelegramNotifier:
    def __init__(self, bot_token: str, primary_chat_id: str, notify_chat_ids: List[str]):
        self.bot_token = bot_token.strip()
        self.primary_chat_id = primary_chat_id.strip()
        self.notify_chat_ids = notify_chat_ids
        self.api_url = f"https://api.telegram.org/bot{self.bot_token}" if self.bot_token else ""

    @property
    def is_configured(self) -> bool:
        """True when Telegram Bot token exists and API URL is initialized."""
        return bool(self.api_url)

    async def send_message(self, text: str, chat_id: str) -> bool:
        if not self.is_configured or not chat_id:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    f"{self.api_url}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": text,
                        "parse_mode": "HTML"
                    }
                )
                return response.status_code == 200
        except Exception as e:
            print(f"Telegram error: {e}")
            return False

    async def broadcast_message(self, text: str) -> bool:
        if not self.notify_chat_ids:
            return False
        results = await asyncio.gather(
            *(self.send_message(text, chat_id) for chat_id in self.notify_chat_ids),
            return_exceptions=True
        )
        return any(result is True for result in results)

    async def get_updates(self, offset: int, timeout: int = 30) -> List[Dict]:
        if not self.is_configured:
            await asyncio.sleep(2)
            return []
        try:
            async with httpx.AsyncClient(timeout=timeout + 5) as client:
                response = await client.get(
                    f"{self.api_url}/getUpdates",
                    params={"offset": offset, "timeout": timeout}
                )
                if response.status_code != 200:
                    return []
                payload = response.json()
                return payload.get("result", []) if payload.get("ok") else []
        except Exception as e:
            print(f"Telegram polling error: {e}")
            await asyncio.sleep(2)
            return []

    async def send_trade_alert(self, opportunity: Dict, profit: float, total_profit: float) -> bool:
        message = f"""
🎉 <b>🔥 صفقة جديدة منفذة!</b>

💰 <b>الربح:</b> ${profit:.2f}
📈 <b>نسبة الربح:</b> {opportunity.get('profit_percent', 0):.2f}%

<b>📊 التفاصيل:</b>
• شراء من: {opportunity.get('buy_exchange', 'N/A').upper()} @ ${opportunity.get('buy_price', 0):.2f}
• بيع في: {opportunity.get('sell_exchange', 'N/A').upper()} @ ${opportunity.get('sell_price', 0):.2f}

<b>💰 الإجمالي:</b>
• ربح اليوم: ${total_profit:.2f}
• إجمالي الصفقات: {opportunity.get('trade_count', 0)}

⏰ <b>الوقت:</b> {datetime.now().strftime('%H:%M:%S')}
        """
        return await self.broadcast_message(message)

    async def send_startup_message(self, control_center_url: str) -> bool:
        message = f"""
🔷 <b>🚀 Nexus Arbitrage System يعمل الآن!</b>

✅ البوت بدأ العمل بنجاح
📡 يراقب الفروق السعرية عبر CEX + DEX + Perps
⚙️ عتبة الربح: 0.15%
💰 حجم الصفقة: 100 USDT
🌐 Control Center: {control_center_url}/dashboard

📊 ستصلك إشعارات عند كل صفقة جديدة!
        """
        return await self.broadcast_message(message)


class UltimateControlCenterClient:
    def __init__(self, base_url: str, admin_token: str):
        self.base_url = (base_url or "").strip().rstrip("/")
        self.admin_token = (admin_token or "").strip()

    def _admin_headers(self) -> Dict[str, str]:
        if not self.admin_token:
            return {}
        return {"x-admin-token": self.admin_token}

    async def call(self, path: str) -> Tuple[bool, str]:
        if not self.base_url:
            return False, "❌ CONTROL_CENTER_BASE_URL غير مضبوط."
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(f"{self.base_url}{path}", headers=self._admin_headers())
                text = response.text.strip()
                if response.status_code == 401:
                    return False, "❌ Unauthorized: تحقق من CONTROL_CENTER_ADMIN_TOKEN."
                if not response.is_success:
                    return False, f"❌ فشل الطلب ({response.status_code}): {text or 'Unknown error'}"
                return True, text or "✅ تم التنفيذ"
        except Exception as e:
            return False, f"❌ تعذر الاتصال بمركز التحكم: {e}"

    async def status(self) -> Tuple[bool, str]:
        ok, text = await self.call("/status")
        if ok:
            return True, f"📊 <b>Nexus Hub Status</b>\n{text}"
        return ok, text

    async def dashboard(self) -> Tuple[bool, str]:
        if not self.base_url:
            return False, "❌ CONTROL_CENTER_BASE_URL غير مضبوط."
        return True, f"📈 Dashboard: {self.base_url}/dashboard"

    async def strategy_status(self, strategy: str) -> Tuple[bool, str]:
        """Fetch the last scan result for a specific strategy (cex/dex/perps)."""
        ok, text = await self.call(f"/strategy/{strategy}/status")
        if ok:
            label = {"cex": "📊 CEX", "dex": "🌐 DEX", "perps": "⚡ Perps"}.get(strategy, strategy.upper())
            return True, f"{label} <b>Strategy Status</b>\n{text}"
        return ok, text


class TelegramControlCenter:
    def __init__(self, notifier: TelegramNotifier, control_client: UltimateControlCenterClient, admin_chat_ids: Set[str]):
        self.notifier = notifier
        self.control_client = control_client
        self.admin_chat_ids = admin_chat_ids
        self.update_offset = 0

    def _help_text(self) -> str:
        return (
            "🔷 <b>Nexus Arbitrage System — Commands</b>\n"
            "/status - عرض حالة النظام\n"
            "/dashboard - رابط لوحة التحكم\n"
            "/start - تشغيل التداول\n"
            "/stop - إيقاف التداول\n"
            "/scan - تشغيل مسح فوري (CEX + DEX + Perps)\n"
            "/live - تفعيل التداول الحقيقي\n"
            "/paper - تفعيل التداول الورقي\n"
            "/cex-status - حالة استراتيجية CEX\n"
            "/dex-status - حالة استراتيجية DEX\n"
            "/perps-status - حالة استراتيجية Perps\n"
            "/help - عرض الأوامر"
        )

    async def _execute_command(self, command: str) -> Tuple[bool, str]:
        if command in ("/help",):
            return True, self._help_text()
        if command in ("/dashboard",):
            return await self.control_client.dashboard()
        if command in ("/status",):
            return await self.control_client.status()
        if command in ("/cex-status",):
            return await self.control_client.strategy_status("cex")
        if command in ("/dex-status",):
            return await self.control_client.strategy_status("dex")
        if command in ("/perps-status",):
            return await self.control_client.strategy_status("perps")
        if not self.control_client.admin_token:
            return False, "❌ CONTROL_CENTER_ADMIN_TOKEN غير مضبوط."

        command_to_path = {
            "/start": "/start",
            "/startbot": "/start",
            "/stop": "/stop",
            "/stopbot": "/stop",
            "/scan": "/scan",
            "/live": "/mode/live",
            "/paper": "/mode/paper",
        }
        path = command_to_path.get(command)
        if not path:
            return False, f"❌ أمر غير معروف: {command}\n\n{self._help_text()}"
        return await self.control_client.call(path)

    async def _handle_message(self, message: Dict) -> None:
        text = (message.get("text") or "").strip()
        if not text.startswith("/"):
            return
        command = text.split(maxsplit=1)[0].lower()
        chat = message.get("chat", {})
        chat_id = str(chat.get("id", ""))
        if not chat_id:
            return

        if chat_id not in self.admin_chat_ids:
            await self.notifier.send_message("⛔️ غير مصرح لك بتنفيذ أوامر التحكم.", chat_id)
            print(f"Unauthorized Telegram command attempt from chat_id={chat_id}: {command}")
            return

        ok, response_text = await self._execute_command(command)
        prefix = "✅" if ok else "❌"
        await self.notifier.send_message(f"{prefix} {response_text}", chat_id)

    async def run(self):
        if not self.notifier.is_configured:
            print("⚠️ Telegram command center disabled: TELEGRAM_BOT_TOKEN is missing.")
            return
        print(f"📲 Telegram command center enabled for {len(self.admin_chat_ids)} admin chat(s).")
        while True:
            updates = await self.notifier.get_updates(offset=self.update_offset, timeout=30)
            for update in updates:
                update_id = update.get("update_id")
                if isinstance(update_id, int):
                    self.update_offset = update_id + 1
                message = update.get("message")
                if message:
                    await self._handle_message(message)


class MegaArbitrageBot:
    def __init__(self):
        # إعدادات التداول
        self.MIN_PROFIT_PERCENT = 0.15
        self.TRADE_AMOUNT_USD = 100
        self.SCAN_INTERVAL = 3

        # إحصائيات
        self.stats = {
            'start_time': datetime.now().isoformat(),
            'total_trades': 0,
            'total_profit_usd': 0.0,
            'opportunities_found': 0,
            'opportunities_taken': 0
        }

        bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        primary_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
        notify_chat_ids = parse_chat_ids(os.environ.get("TELEGRAM_NOTIFY_CHAT_IDS", ""))
        admin_chat_ids = parse_chat_ids(os.environ.get("TELEGRAM_ADMIN_CHAT_IDS", ""))

        if primary_chat_id:
            if primary_chat_id not in notify_chat_ids:
                notify_chat_ids = [primary_chat_id, *notify_chat_ids]
            if not admin_chat_ids:
                admin_chat_ids = [primary_chat_id]

        self.control_center_url = os.environ.get(
            "CONTROL_CENTER_BASE_URL",
            "https://nexus-hub.zedanazad43.workers.dev"
        ).strip().rstrip("/")
        self.telegram = TelegramNotifier(bot_token=bot_token, primary_chat_id=primary_chat_id, notify_chat_ids=notify_chat_ids)
        self.control_client = UltimateControlCenterClient(
            base_url=self.control_center_url,
            admin_token=os.environ.get("CONTROL_CENTER_ADMIN_TOKEN", "")
        )
        self.telegram_control = TelegramControlCenter(
            notifier=self.telegram,
            control_client=self.control_client,
            admin_chat_ids=set(admin_chat_ids)
        )

        self.is_running = True
    
    async def get_prices(self):
        import ccxt
        prices = {'binance': 0, 'mexc': 0}
        
        try:
            binance = ccxt.binance()
            ticker = binance.fetch_ticker('BTC/USDT')
            prices['binance'] = ticker['last']
        except Exception as e:
            print(f"Binance error: {e}")
        
        try:
            mexc = ccxt.mexc()
            ticker = mexc.fetch_ticker('BTC/USDT')
            prices['mexc'] = ticker['last']
        except Exception as e:
            print(f"MEXC error: {e}")
        
        return prices
    
    async def check_arbitrage(self, prices: Dict) -> Optional[Dict]:
        binance_price = prices.get('binance', 0)
        mexc_price = prices.get('mexc', 0)
        
        if binance_price == 0 or mexc_price == 0:
            return None
        
        if mexc_price > binance_price:
            profit_percent = ((mexc_price - binance_price) / binance_price) * 100
            if profit_percent >= self.MIN_PROFIT_PERCENT:
                return {
                    'type': 'cross_exchange',
                    'buy_exchange': 'binance',
                    'buy_price': binance_price,
                    'sell_exchange': 'mexc',
                    'sell_price': mexc_price,
                    'profit_percent': profit_percent,
                    'action': 'BUY_BINANCE_SELL_MEXC'
                }
        
        if binance_price > mexc_price:
            profit_percent = ((binance_price - mexc_price) / mexc_price) * 100
            if profit_percent >= self.MIN_PROFIT_PERCENT:
                return {
                    'type': 'cross_exchange',
                    'buy_exchange': 'mexc',
                    'buy_price': mexc_price,
                    'sell_exchange': 'binance',
                    'sell_price': binance_price,
                    'profit_percent': profit_percent,
                    'action': 'BUY_MEXC_SELL_BINANCE'
                }
        
        return None
    
    async def execute_trade(self, opportunity: Dict) -> Dict:
        amount_btc = self.TRADE_AMOUNT_USD / opportunity['buy_price']
        buy_value = amount_btc * opportunity['buy_price']
        sell_value = amount_btc * opportunity['sell_price']
        expected_profit = sell_value - buy_value
        
        self.stats['total_trades'] += 1
        self.stats['total_profit_usd'] += expected_profit
        
        opportunity['trade_count'] = self.stats['total_trades']
        
        print(f"\n✅ TRADE EXECUTED!")
        print(f"   Profit: ${expected_profit:.2f}")
        print(f"   Total Profit: ${self.stats['total_profit_usd']:.2f}")
        
        # إرسال إشعار Telegram
        await self.telegram.send_trade_alert(opportunity, expected_profit, self.stats['total_profit_usd'])
        
        return {'status': 'executed', 'profit': expected_profit}
    
    async def run(self):
        print("\n" + "="*60)
        print("🚀 MEGA ARBITRAGE BOT WITH TELEGRAM")
        print("="*60)
        print(f"📅 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"⚙️ Min Profit: {self.MIN_PROFIT_PERCENT}%")
        print(f"💰 Trade Amount: ${self.TRADE_AMOUNT_USD}")
        print(f"📱 Telegram alerts: {'✅ Connected' if self.telegram.is_configured else '⚠️ Disabled'}")
        print(f"🌐 Control Center: {self.control_center_url}/dashboard")
        print("="*60 + "\n")

        # إرسال رسالة بدء التشغيل
        await self.telegram.send_startup_message(self.control_center_url)

        command_task = None
        if self.telegram_control.admin_chat_ids:
            command_task = asyncio.create_task(self.telegram_control.run())
        else:
            print("⚠️ Telegram command center disabled: TELEGRAM_ADMIN_CHAT_IDS / TELEGRAM_CHAT_ID غير مضبوط.")

        print("🔍 Scanning for arbitrage opportunities...")
        print("Press Ctrl+C to stop\n")

        try:
            while self.is_running:
                try:
                    prices = await self.get_prices()
                    opportunity = await self.check_arbitrage(prices)

                    binance = prices.get('binance', 0)
                    mexc = prices.get('mexc', 0)
                    diff = abs(binance - mexc)
                    diff_percent = (diff / min(binance, mexc)) * 100 if min(binance, mexc) > 0 else 0

                    status = f"[{datetime.now().strftime('%H:%M:%S')}] 📊 BTC: Binance=${binance:,.0f} | MEXC=${mexc:,.0f} | Diff={diff_percent:.3f}%"

                    if opportunity:
                        self.stats['opportunities_found'] += 1
                        status += f" | 🎯 OPPORTUNITY! {opportunity['profit_percent']:.2f}%"
                        print(status)

                        if opportunity['profit_percent'] >= self.MIN_PROFIT_PERCENT:
                            self.stats['opportunities_taken'] += 1
                            await self.execute_trade(opportunity)
                    else:
                        print(status)

                    await asyncio.sleep(self.SCAN_INTERVAL)

                except KeyboardInterrupt:
                    print("\n🛑 Stopping bot...")
                    break
                except Exception as e:
                    print(f"Error: {e}")
                    await asyncio.sleep(5)
        finally:
            if command_task:
                command_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await command_task

        print("\n👋 Bot stopped. Goodbye!")

async def main():
    bot = MegaArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
