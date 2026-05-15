#!/usr/bin/env node
/**
 * AWS S3 DLP Scanner
 * 
 * Scans AWS S3 buckets for sensitive data patterns:
 * - API Keys, Private Keys, Database URLs
 * - Credit card numbers, PII (SSN, Email)
 * - Hardcoded credentials, tokens
 * 
 * Usage: node scripts/aws-s3-dlp-scanner.js
 * Environment: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or use IAM role)
 */

import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

// ═══════════════════════════════════════════════════════════════════
// DLP Patterns
// ═══════════════════════════════════════════════════════════════════

const DLP_PATTERNS = {
  aws_access_key: {
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'CRITICAL',
    name: 'AWS Access Key ID'
  },
  aws_secret: {
    pattern: /aws_secret_access_key\s*=\s*["']([^"']+)["']/gi,
    severity: 'CRITICAL',
    name: 'AWS Secret Access Key'
  },
  private_key: {
    pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY/g,
    severity: 'CRITICAL',
    name: 'Private Key'
  },
  api_key: {
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*["']?([a-zA-Z0-9]{32,})["']?/gi,
    severity: 'HIGH',
    name: 'API Key'
  },
  database_url: {
    pattern: /(mongodb|mysql|postgresql|redis):\/\/[\w:]+@[\w.:]+/gi,
    severity: 'HIGH',
    name: 'Database URL'
  },
  credit_card: {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    severity: 'CRITICAL',
    name: 'Credit Card Number'
  },
  ssn: {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: 'HIGH',
    name: 'Social Security Number'
  },
  email_sensitive: {
    pattern: /(?:admin|internal|test)[\w.-]*@(?:localhost|\.local|\.internal)/gi,
    severity: 'MEDIUM',
    name: 'Sensitive Email Address'
  },
  telegram_token: {
    pattern: /\b\d{9}:\w{35,}\b/g,
    severity: 'CRITICAL',
    name: 'Telegram Bot Token'
  }
};

// ═══════════════════════════════════════════════════════════════════
// Scanner Class
// ═══════════════════════════════════════════════════════════════════

class S3DLPScanner {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.findings = [];
    this.scanStats = {
      bucketsScanned: 0,
      objectsScanned: 0,
      findingsDetected: 0,
      startTime: new Date()
    };
  }

  // List all S3 buckets
  async listBuckets() {
    try {
      const command = new ListBucketsCommand({});
      const response = await this.s3Client.send(command);
      return response.Buckets || [];
    } catch (error) {
      console.error('❌ Error listing buckets:', error.message);
      return [];
    }
  }

  // List objects in a bucket
  async listObjectsInBucket(bucketName, prefix = '') {
    const objects = [];
    let continuationToken = undefined;

    try {
      while (true) {
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 100
        });

        const response = await this.s3Client.send(command);
        
        if (response.Contents) {
          objects.push(...response.Contents);
        }

        if (!response.IsTruncated) break;
        continuationToken = response.NextContinuationToken;
      }
    } catch (error) {
      console.error(`⚠️  Error listing objects in ${bucketName}:`, error.message);
    }

    return objects;
  }

  // Download and scan object
  async scanObject(bucketName, objectKey) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey
      });

      const response = await this.s3Client.send(command);
      const content = await this.streamToString(response.Body);

      return this.scanContent(content, { bucket: bucketName, key: objectKey });
    } catch (error) {
      console.error(`⚠️  Error scanning ${objectKey}:`, error.message);
      return [];
    }
  }

  // Convert stream to string
  async streamToString(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }

  // Scan content against DLP patterns
  scanContent(content, metadata) {
    const findings = [];

    Object.entries(DLP_PATTERNS).forEach(([patternId, patternConfig]) => {
      let match;
      while ((match = patternConfig.pattern.exec(content)) !== null) {
        findings.push({
          patternId,
          patternName: patternConfig.name,
          severity: patternConfig.severity,
          match: match[0].substring(0, 50), // First 50 chars only
          position: match.index,
          bucket: metadata.bucket,
          key: metadata.key,
          timestamp: new Date().toISOString()
        });
      }
    });

    return findings;
  }

  // Scan a bucket
  async scanBucket(bucketName) {
    console.log(`\n🔍 Scanning bucket: ${bucketName}`);
    this.scanStats.bucketsScanned++;

    const fileExtensions = ['.json', '.env', '.yaml', '.yml', '.txt', '.log', '.csv', '.sql'];
    const objects = await this.listObjectsInBucket(bucketName);

    for (const obj of objects) {
      // Skip if not a text-like file
      if (!fileExtensions.some(ext => obj.Key.endsWith(ext))) {
        continue;
      }

      this.scanStats.objectsScanned++;
      console.log(`  📄 Scanning: ${obj.Key}`);

      const findings = await this.scanObject(bucketName, obj.Key);
      this.findings.push(...findings);
      this.scanStats.findingsDetected += findings.length;

      findings.forEach(finding => {
        console.log(`    ⚠️  [${finding.severity}] ${finding.patternName}`);
      });
    }
  }

  // Generate report
  generateReport() {
    const endTime = new Date();
    const duration = (endTime - this.scanStats.startTime) / 1000;

    const report = {
      timestamp: new Date().toISOString(),
      duration_seconds: duration,
      summary: {
        bucketsScanned: this.scanStats.bucketsScanned,
        objectsScanned: this.scanStats.objectsScanned,
        findingsDetected: this.scanStats.findingsDetected,
        criticalFindings: this.findings.filter(f => f.severity === 'CRITICAL').length,
        highFindings: this.findings.filter(f => f.severity === 'HIGH').length,
        mediumFindings: this.findings.filter(f => f.severity === 'MEDIUM').length
      },
      findings: this.findings,
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  // Generate recommendations
  generateRecommendations() {
    const recommendations = [];

    if (this.scanStats.findingsDetected > 0) {
      recommendations.push('🚨 Critical findings detected. Immediate action required.');
      recommendations.push('1. Rotate any exposed credentials immediately');
      recommendations.push('2. Review bucket access policies and permissions');
      recommendations.push('3. Enable S3 Object Lock for sensitive data');
      recommendations.push('4. Enable CloudTrail logging for S3 access');
      recommendations.push('5. Consider using AWS Secrets Manager for credentials');
    } else {
      recommendations.push('✅ No sensitive data detected in scanned objects');
    }

    recommendations.push('6. Enable S3 Block Public Access');
    recommendations.push('7. Use Server-Side Encryption (SSE-S3 or SSE-KMS)');
    recommendations.push('8. Enable versioning for audit trail');
    recommendations.push('9. Set up bucket policies to deny unencrypted uploads');

    return recommendations;
  }

  // Run full scan
  async run() {
    console.log('🔐 AWS S3 DLP Scanner Started');
    console.log('═══════════════════════════════════════════');

    const buckets = await this.listBuckets();
    if (buckets.length === 0) {
      console.log('❌ No S3 buckets found or no access');
      return;
    }

    for (const bucket of buckets) {
      await this.scanBucket(bucket.Name);
    }

    const report = this.generateReport();
    return report;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main Execution
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const scanner = new S3DLPScanner();

  try {
    const report = await scanner.run();

    console.log('\n═══════════════════════════════════════════');
    console.log('📊 DLP Scan Summary:');
    console.log(`  Buckets Scanned: ${report.summary.bucketsScanned}`);
    console.log(`  Objects Scanned: ${report.summary.objectsScanned}`);
    console.log(`  Findings: ${report.summary.findingsDetected}`);
    console.log(`    🔴 Critical: ${report.summary.criticalFindings}`);
    console.log(`    🟠 High: ${report.summary.highFindings}`);
    console.log(`    🟡 Medium: ${report.summary.mediumFindings}`);
    console.log(`  Duration: ${report.duration_seconds.toFixed(2)}s`);

    console.log('\n📋 Recommendations:');
    report.recommendations.forEach(rec => console.log(`  ${rec}`));

    // Save report to file
    const fs = await import('fs/promises');
    await fs.writeFile(
      'dlp-scan-report.json',
      JSON.stringify(report, null, 2)
    );

    console.log('\n💾 Report saved to: dlp-scan-report.json');

    process.exit(report.summary.criticalFindings > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Scanner error:', error);
    process.exit(1);
  }
}

main();
