/** Nexus administration Settings copy. */
export const zh = {
  tab: 'Nexus 管理', eyebrow: 'NEXUS BRIDGE', title: 'Nexus 设备', pairing: '配对', pairingHint: '生成一次性配对码，在 iPhone 配对页输入。', createCode: '生成配对码', codeReady: '配对码已生成', devices: '已配对设备', refresh: '刷新', revoke: '吊销', revoked: '已吊销', active: '可用', killSwitch: '紧急停用', engaged: '已停用', clear: '运行中', engage: '停用新 Turn', release: '解除停用', loading: '读取中…', error: '管理接口暂时不可用。', retry: '重试', empty: '暂无配对设备。', created: '已注册', unknown: '未知',
} as const
/** Nexus 管理文案的全部键（zh 为源，en 对齐）。 */
export type NexusLocaleKey = keyof typeof zh
/** 英文文案（与 `zh` 键一一对应）。 */
export const en: Record<NexusLocaleKey, string> = { tab: 'Nexus admin', eyebrow: 'NEXUS BRIDGE', title: 'Nexus devices', pairing: 'Pairing', pairingHint: 'Create a one-time code and enter it on the iPhone pairing screen.', createCode: 'Create pairing code', codeReady: 'Pairing code created', devices: 'Paired devices', refresh: 'Refresh', revoke: 'Revoke', revoked: 'Revoked', active: 'Active', killSwitch: 'Emergency stop', engaged: 'Stopped', clear: 'Running', engage: 'Stop new turns', release: 'Release stop', loading: 'Loading…', error: 'The administration API is unavailable.', retry: 'Retry', empty: 'No paired devices.', created: 'Registered', unknown: 'Unknown' }
