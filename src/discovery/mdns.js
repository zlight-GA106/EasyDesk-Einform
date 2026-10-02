import os from 'node:os';
import { Bonjour } from 'bonjour-service';

export function startDiscovery(config, log) {
  if (!config.discovery.enabled) return { close: async () => {}, status: 'disabled' };
  let bonjour;
  const result = { status: 'starting', close: async () => { if (!bonjour) return; await new Promise(resolve => bonjour.unpublishAll(resolve)); await new Promise(resolve => bonjour.destroy(resolve)); result.status = 'stopped'; } };
  try {
    bonjour = new Bonjour({}, () => { result.status = 'unavailable'; log.warn('mdns_failed', { manualConnectionAvailable: true }); });
    const host = `${os.hostname().replace(/[^a-zA-Z0-9-]/g, '-')}.local`;
    const service = bonjour.publish({ name: config.discovery.serviceName, type: 'easydesk', protocol: 'tcp', host, port: config.server.port, txt: { host, port: String(config.server.port), apiVersion: '1', api: '/api', name: 'EasyDesk Einform Server' } });
    service.on('up', () => { result.status = 'published'; log.info('mdns_published', { name: config.discovery.serviceName, type: '_easydesk._tcp.local', port: config.server.port }); });
    service.on('error', () => { result.status = 'unavailable'; log.warn('mdns_failed', { manualConnectionAvailable: true }); });
  } catch { result.status = 'unavailable'; log.warn('mdns_failed', { manualConnectionAvailable: true }); }
  return result;
}
