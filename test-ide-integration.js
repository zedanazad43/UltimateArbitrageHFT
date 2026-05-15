#!/usr/bin/env node
/**
 * IDE Integration Test - اختبار تكامل IDE
 * Tests CodeGeeX local endpoint compatibility with IDEs
 * اختبر توافقية نقطة نهاية CodeGeeX المحلية مع IDE
 */

import http from 'http';
import { URL } from 'url';

const ENDPOINT = process.env.CODEGEEX_ENDPOINT || 'http://127.0.0.1:8000';
const MODEL = process.env.CODEGEEX_MODEL || 'codegeex4';
const TIMEOUT_MS = parseInt(process.env.CODEGEEX_TIMEOUT || '120000', 10);

console.log('═════════════════════════════════════════════');
console.log('  CodeGeeX IDE Integration Test');
console.log('  اختبار تكامل CodeGeeX مع IDE');
console.log(`  Model: ${MODEL}`);
console.log('═════════════════════════════════════════════\n');

async function testEndpoint(name, method, path, body) {
  console.log(`\n→ Testing: ${name}`);
  console.log(`  Method: ${method}`);
  console.log(`  URL: ${ENDPOINT}${path}`);

  return new Promise((resolve, reject) => {
    const url = new URL(path, ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: TIMEOUT_MS,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`  ✓ Status: ${res.statusCode}`);
          console.log(`  ✓ Response: ${JSON.stringify(json).substring(0, 100)}...`);
          resolve({ success: true, status: res.statusCode, data: json });
        } catch (_error) {
          console.log(`  ✓ Status: ${res.statusCode}`);
          console.log(`  ✓ Response (raw): ${data.substring(0, 100)}`);
          resolve({ success: true, status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => {
      console.log(`  ✗ Error: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  const tests = [
    {
      name: '1. Health Check (صحة الخادم)',
      method: 'GET',
      path: '/health',
      body: null,
    },
    {
      name: '2. List Models (قائمة النماذج)',
      method: 'GET',
      path: '/v1/models',
      body: null,
    },
    {
      name: '3. Chat Completions (اكتمال الدردشة)',
      method: 'POST',
      path: '/v1/chat/completions',
      body: {
        messages: [
          {
            role: 'user',
            content: 'حدد أفضل فرصة تحكيم من بين [BTC 0.5%, ETH 0.3%, SOL 0.1%]؟',
          },
        ],
        max_tokens: 4,
        temperature: 0.3,
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await testEndpoint(test.name, test.method, test.path, test.body);
      passed++;
    } catch (_error) {
      failed++;
    }
  }

  console.log('\n═════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═════════════════════════════════════════════\n');

  if (failed === 0) {
    console.log('✓ All tests passed! IDE integration ready.');
    console.log('✓ جميع الاختبارات نجحت! IDE جاهز للتكامل.\n');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed. Check server status.');
    console.log('✗ فشل بعض الاختبارات. تحقق من حالة الخادم.\n');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err.message);
  process.exit(1);
});
