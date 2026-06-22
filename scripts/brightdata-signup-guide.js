#!/usr/bin/env node
// Bright Data Signup & Credential Guide

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🌍 BRIGHT DATA SIGNUP & CREDENTIAL GUIDE                           ║
║                                                                      ║
║  Get Bright Data credentials for US geo-bypass proxy                ║
╚══════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: CREATE ACCOUNT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Open in browser:
   https://brightdata.com/proxy-types/datacenter

2. Click "Start Free Trial" or "Sign Up" button
   (top right corner)

3. Enter your details:
   ✓ Email address
   ✓ Password
   ✓ Full name
   ✓ Country

4. Accept terms & check email for verification

5. Verify email by clicking confirmation link

6. You'll be logged in automatically

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: GET CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After login, navigate to credentials:

1. Click on your profile icon (top right)
   ↓
2. Select "Account Settings" or "Dashboard"
   ↓
3. Look for "Proxy" or "Datacenter" section
   ↓
4. Find "My Credentials" or "API Credentials"
   ↓
5. You'll see:
   • Username (looks like: "customer-username")
   • Password (auto-generated, can reset)
   • Port (default 22225)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: COPY YOUR CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You'll need these 2 values:

📋 BRIGHT_DATA_USER
   • Usually your customer-UUID or username
   • Format: "brd-customer-XXXXXXX" or "your-username"
   • Copy this ✓

📋 BRIGHT_DATA_PASSWORD
   • Auto-generated password
   • Format: random string like "abcd1234efgh5678"
   • Copy this ✓

Example:
  BRIGHT_DATA_USER = brd-customer-12345678-1234
  BRIGHT_DATA_PASSWORD = zyxwvutsrqpon9876543

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: VERIFY CREDENTIALS WORK (OPTIONAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Test your credentials with a simple curl command:

curl -x http://BRIGHT_DATA_USER:BRIGHT_DATA_PASSWORD@proxy.provider.com:22225 \\
     http://api.ipify.org

Replace:
  • BRIGHT_DATA_USER = your username
  • BRIGHT_DATA_PASSWORD = your password

Success looks like:
  "Your IP address is 1.2.3.4" (via proxy!)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 TIPS FOR HFT TRADING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For best HFT performance with Bright Data:

✓ Use "Zone" proxies (dedicated rotating IPs)
✓ Choose US datacenter for lowest latency
✓ Enable "Sticky sessions" if available
✓ Set connection timeout to 5-10 seconds
✓ Use keep-alive connections

Bright Data offers:
  • FREE trial: 5GB/month
  • PAID plans: $5-50/month depending on usage
  • No long-term contracts
  • Can upgrade/downgrade anytime

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 NEXT STEP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Once you have your Bright Data credentials:

1. Copy BRIGHT_DATA_USER
2. Copy BRIGHT_DATA_PASSWORD
3. Run: npm run setup:all
4. Paste credentials when prompted

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q: "I can't find My Credentials"
A: Dashboard → Account Settings → Proxy Settings → Credentials
   Or contact: support@brightdata.com

Q: "Credentials not working"
A: • Check spelling (case-sensitive)
   • Verify you used the right username/password
   • Try resetting password in dashboard
   • Wait 2 minutes for propagation

Q: "What's the proxy address?"
A: proxy.provider.com:22225 (Bright Data provides this)

Q: "How much data do I need?"
A: For HFT: 1-5GB/month usually sufficient
   (Free trial has 5GB to start)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 SUPPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Bright Data Support: https://support.brightdata.com
• Live Chat: https://brightdata.com (bottom right)
• Email: support@brightdata.com
• Docs: https://docs.brightdata.com/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
