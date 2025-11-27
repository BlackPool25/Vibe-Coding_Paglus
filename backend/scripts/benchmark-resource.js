#!/usr/bin/env node
/**
 * Resource Retrieval Benchmark Script
 * 
 * Measures performance of GET /resource/:id endpoint.
 * Target: <2s for small FHIR JSON (~5KB)
 * 
 * Usage:
 *   node scripts/benchmark-resource.js [resourceId] [iterations]
 * 
 * Example:
 *   node scripts/benchmark-resource.js obs-123 10
 * 
 * Requirements:
 *   - Backend server running on localhost:4000
 *   - Valid resource uploaded with access granted
 * 
 * References:
 * - IPFS Gateway performance: https://docs.ipfs.tech/concepts/ipfs-gateway/
 * - Node.js performance hooks: https://nodejs.org/api/perf_hooks.html
 */

'use strict';

const http = require('http');
const { performance } = require('perf_hooks');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const DEFAULT_RESOURCE_ID = 'obs-test-123';
const DEFAULT_ITERATIONS = 5;
const DEFAULT_ORG_ID = 'org2';
const TARGET_TIME_MS = 2000; // 2 second target

// Parse command line arguments
const resourceId = process.argv[2] || DEFAULT_RESOURCE_ID;
const iterations = parseInt(process.argv[3]) || DEFAULT_ITERATIONS;
const orgId = process.argv[4] || DEFAULT_ORG_ID;

console.log('═'.repeat(60));
console.log('Resource Retrieval Benchmark');
console.log('═'.repeat(60));
console.log(`Backend URL:  ${BACKEND_URL}`);
console.log(`Resource ID:  ${resourceId}`);
console.log(`Org ID:       ${orgId}`);
console.log(`Iterations:   ${iterations}`);
console.log(`Target Time:  ${TARGET_TIME_MS}ms`);
console.log('─'.repeat(60));

/**
 * Makes an HTTP GET request and returns timing information
 */
function fetchResource(resId, org) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BACKEND_URL}/resource/${resId}`);
    
    const startTime = performance.now();
    
    const options = {
      hostname: url.hostname,
      port: url.port || 4000,
      path: url.pathname,
      method: 'GET',
      headers: {
        'x-org-id': org,
        'Accept': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = Buffer.alloc(0);
      
      res.on('data', chunk => {
        data = Buffer.concat([data, chunk]);
      });
      
      res.on('end', () => {
        const endTime = performance.now();
        const elapsed = endTime - startTime;
        
        let body;
        try {
          body = JSON.parse(data.toString());
        } catch {
          body = data.toString();
        }
        
        resolve({
          statusCode: res.statusCode,
          elapsed: elapsed,
          size: data.length,
          serverTime: res.headers['x-retrieval-time-ms'] 
            ? parseInt(res.headers['x-retrieval-time-ms']) 
            : null,
          fhirType: res.headers['x-fhir-type'],
          body: body
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

/**
 * Runs the benchmark
 */
async function runBenchmark() {
  const results = [];
  let successCount = 0;
  let failCount = 0;

  // Warm-up request (not counted)
  console.log('\nWarm-up request...');
  try {
    const warmup = await fetchResource(resourceId, orgId);
    console.log(`  Status: ${warmup.statusCode}, Time: ${warmup.elapsed.toFixed(2)}ms`);
    if (warmup.statusCode !== 200) {
      console.error(`\n❌ Warm-up failed with status ${warmup.statusCode}`);
      if (warmup.body && warmup.body.error) {
        console.error(`   Error: ${warmup.body.error}`);
        console.error(`   Message: ${warmup.body.message || warmup.body.reason || ''}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Failed to connect to backend: ${err.message}`);
    console.error('   Ensure the backend server is running: npm start');
    process.exit(1);
  }

  // Run benchmark iterations
  console.log(`\nRunning ${iterations} iterations...`);
  console.log('─'.repeat(60));

  for (let i = 0; i < iterations; i++) {
    try {
      const result = await fetchResource(resourceId, orgId);
      results.push(result);
      
      const status = result.elapsed < TARGET_TIME_MS ? '✓' : '✗';
      console.log(
        `  [${i + 1}/${iterations}] ${status} ` +
        `Time: ${result.elapsed.toFixed(2)}ms, ` +
        `Size: ${result.size} bytes, ` +
        `Status: ${result.statusCode}`
      );
      
      if (result.statusCode === 200) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.log(`  [${i + 1}/${iterations}] ❌ Error: ${err.message}`);
      failCount++;
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  // Calculate statistics
  console.log('─'.repeat(60));
  
  if (results.length === 0) {
    console.error('\n❌ No successful requests to analyze');
    process.exit(1);
  }

  const times = results.map(r => r.elapsed);
  const sizes = results.map(r => r.size);
  const serverTimes = results.filter(r => r.serverTime !== null).map(r => r.serverTime);

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
  const p95Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const avgServerTime = serverTimes.length > 0 
    ? serverTimes.reduce((a, b) => a + b, 0) / serverTimes.length 
    : null;

  // Print results
  console.log('\n📊 BENCHMARK RESULTS');
  console.log('═'.repeat(60));
  
  console.log('\nTiming Statistics:');
  console.log(`  Average:    ${avgTime.toFixed(2)}ms`);
  console.log(`  Median:     ${medianTime.toFixed(2)}ms`);
  console.log(`  Min:        ${minTime.toFixed(2)}ms`);
  console.log(`  Max:        ${maxTime.toFixed(2)}ms`);
  console.log(`  P95:        ${p95Time.toFixed(2)}ms`);
  
  if (avgServerTime !== null) {
    console.log(`\n  Server-side avg: ${avgServerTime.toFixed(2)}ms`);
    console.log(`  Network overhead: ${(avgTime - avgServerTime).toFixed(2)}ms`);
  }

  console.log('\nData Statistics:');
  console.log(`  Avg response size: ${avgSize.toFixed(0)} bytes (${(avgSize / 1024).toFixed(2)} KB)`);
  console.log(`  Success rate:      ${successCount}/${iterations} (${(successCount/iterations*100).toFixed(0)}%)`);

  // FHIR type from first successful result
  const firstSuccess = results.find(r => r.statusCode === 200);
  if (firstSuccess && firstSuccess.fhirType) {
    console.log(`  FHIR Type:         ${firstSuccess.fhirType}`);
  }

  // Pass/Fail assessment
  console.log('\n' + '═'.repeat(60));
  
  if (avgTime < TARGET_TIME_MS && medianTime < TARGET_TIME_MS) {
    console.log(`✅ PASS: Average time ${avgTime.toFixed(0)}ms is under ${TARGET_TIME_MS}ms target`);
  } else {
    console.log(`❌ FAIL: Average time ${avgTime.toFixed(0)}ms exceeds ${TARGET_TIME_MS}ms target`);
    console.log('\nOptimization suggestions:');
    console.log('  1. Use local IPFS node: set USE_LOCAL_IPFS=true');
    console.log('  2. Ensure IPFS content is pinned locally');
    console.log('  3. Check network latency to IPFS gateway');
    console.log('  4. Consider caching for frequently accessed resources');
  }

  console.log('═'.repeat(60));

  // Return exit code based on pass/fail
  process.exit(avgTime < TARGET_TIME_MS ? 0 : 1);
}

// Run benchmark
runBenchmark().catch(err => {
  console.error(`\n❌ Benchmark failed: ${err.message}`);
  process.exit(1);
});
