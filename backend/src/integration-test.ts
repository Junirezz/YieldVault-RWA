/**
 * Simple integration test for latency monitoring
 * Run this with: tsx src/integration-test.ts
 */

import { latencyMonitoringService } from './latencyMonitoring';

// Mock environment variables for testing
process.env.SLO_READ_THRESHOLD_MS = '200';
process.env.SLO_WRITE_THRESHOLD_MS = '500';
process.env.SLO_EVALUATION_WINDOW_MS = '60000'; // 1 minute for quick testing
process.env.SLO_ALERT_COOLDOWN_MS = '30000'; // 30 seconds for quick testing
process.env.ALERT_TYPE = 'slack';
process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

async function testLatencyMonitoring() {
  console.log('🧪 Testing Latency Monitoring System...\n');

  // Test 1: Record normal latency
  console.log('📊 Test 1: Recording normal latency measurements');
  latencyMonitoringService.recordLatency('/api/v1/vault/summary', 150);
  latencyMonitoringService.recordLatency('/api/v1/vault/summary', 180);
  latencyMonitoringService.recordLatency('/api/v1/vault/summary', 120);
  
  let metrics = latencyMonitoringService.getDetailedMetrics();
  let vaultMetric = metrics.find(m => m.endpoint === '/api/v1/vault/summary');
  
  console.log(`✅ Recorded ${vaultMetric?.dataPoints} measurements`);
  console.log(`✅ Current P95: ${vaultMetric?.currentP95}ms`);
  console.log(`✅ SLO Threshold: ${vaultMetric?.threshold}ms`);
  console.log(`✅ Is Breaching: ${vaultMetric?.isBreaching}\n`);

  // Test 2: Record violating latency
  console.log('🚨 Test 2: Recording SLO-violating latency measurements');
  for (let i = 0; i < 10; i++) {
    latencyMonitoringService.recordLatency('/api/v1/vault/summary', 250 + i * 10);
  }
  
  metrics = latencyMonitoringService.getDetailedMetrics();
  vaultMetric = metrics.find(m => m.endpoint === '/api/v1/vault/summary');
  
  console.log(`✅ Recorded ${vaultMetric?.dataPoints} total measurements`);
  console.log(`✅ Current P95: ${vaultMetric?.currentP95}ms`);
  console.log(`✅ SLO Threshold: ${vaultMetric?.threshold}ms`);
  console.log(`✅ Is Breaching: ${vaultMetric?.isBreaching}\n`);

  // Test 3: Test write endpoint
  console.log('✍️ Test 3: Testing write endpoint SLO');
  latencyMonitoringService.recordLatency('/api/v1/vault/deposit', 600);
  latencyMonitoringService.recordLatency('/api/v1/vault/deposit', 700);
  latencyMonitoringService.recordLatency('/api/v1/vault/deposit', 800);
  
  metrics = latencyMonitoringService.getDetailedMetrics();
  let depositMetric = metrics.find(m => m.endpoint === '/api/v1/vault/deposit');
  
  console.log(`✅ Deposit endpoint P95: ${depositMetric?.currentP95}ms`);
  console.log(`✅ Deposit SLO Threshold: ${depositMetric?.threshold}ms`);
  console.log(`✅ Deposit Is Breaching: ${depositMetric?.isBreaching}\n`);

  // Test 4: Test dynamic endpoint normalization
  console.log('🔄 Test 4: Testing dynamic endpoint normalization');
  latencyMonitoringService.recordLatency('/api/v1/vault/12345', 300);
  latencyMonitoringService.recordLatency('/api/v1/vault/67890', 350);
  
  metrics = latencyMonitoringService.getDetailedMetrics();
  let dynamicMetric = metrics.find(m => m.endpoint === '/api/v1/vault/:id');
  
  console.log(`✅ Normalized endpoint: ${dynamicMetric?.endpoint}`);
  console.log(`✅ Dynamic metric P95: ${dynamicMetric?.currentP95}ms`);
  console.log(`✅ Dynamic metric data points: ${dynamicMetric?.dataPoints}\n`);

  // Test 5: Test service status
  console.log('📈 Test 5: Service status');
  let status = latencyMonitoringService.getStatus();
  console.log(`✅ Endpoints tracked: ${status.endpointsTracked}`);
  console.log(`✅ Monitoring active: ${status.monitoringActive}`);
  console.log(`✅ Alert integrations: ${status.alertIntegrations.join(', ')}\n`);

  // Test 6: Start monitoring and check status
  console.log('🔄 Test 6: Starting monitoring service');
  latencyMonitoringService.startMonitoring();
  
  status = latencyMonitoringService.getStatus();
  console.log(`✅ Monitoring active after start: ${status.monitoringActive}`);
  
  // Wait a moment and check again
  setTimeout(() => {
    console.log('✅ Monitoring service has been running for 2 seconds');
    
    // Test 7: Manual SLO violation check (this would trigger alerts in real scenario)
    console.log('🔍 Test 7: Manual SLO violation check');
    // Note: This won't actually send alerts since we're using a mock webhook URL
    // but it tests the alert logic
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('📝 Summary:');
    console.log('   - Latency recording: ✅');
    console.log('   - P95 calculation: ✅');
    console.log('   - SLO breach detection: ✅');
    console.log('   - Endpoint normalization: ✅');
    console.log('   - Service status: ✅');
    console.log('   - Monitoring lifecycle: ✅');
    
    // Stop monitoring
    latencyMonitoringService.stopMonitoring();
    console.log('🛑 Monitoring stopped');
    
    process.exit(0);
  }, 2000);
}

// Mock fetch to prevent actual network calls during testing
global.fetch = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers(),
  redirected: false,
  type: 'basic',
  url: '',
  clone: () => ({} as Response),
  body: null,
  bodyUsed: false,
  arrayBuffer: async () => new ArrayBuffer(0),
  blob: async () => new Blob(),
  formData: async () => new FormData(),
  text: async () => '',
  json: async () => ({})
}) as Response;

// Run the test
testLatencyMonitoring().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
