export function createHeartbeatMonitor(registry, log) {
  const previous = new Map(registry.list().map(d => [d.internalUuid, d.online]));
  return () => {
    for (const device of registry.list()) {
      if (previous.get(device.internalUuid) === true && !device.online) log.info('device_offline', { deviceId: device.deviceId });
      previous.set(device.internalUuid, device.online);
    }
  };
}
