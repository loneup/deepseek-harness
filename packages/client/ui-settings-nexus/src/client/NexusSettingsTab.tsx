import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NexusLocaleKey } from './locales.ts'
import css from './NexusSettingsTab.module.css'

interface Device {
  deviceId: string
  registeredAt?: string
  revokedAt: string | null
}

interface DeviceListResponse {
  ok: true
  devices: Device[]
}

interface KillSwitchSnapshot {
  engaged: boolean
  engagedAt: string | null
  by: string | null
  reason: string | null
  releasedAt: string | null
}

interface PairingCreateSuccess {
  ok: true
  pairingCode: string
}

interface PairingCreateFailure {
  ok: false
  error: { code: string; message: string }
}

type PairingCreateResult = PairingCreateSuccess | PairingCreateFailure

interface RevokeResult {
  ok: true
  revokedAt: string
  tokens: string[]
}

interface Snapshot {
  engaged: boolean
  engagedAt: string | null
  releasedAt: string | null
}

interface NexusInjected {
  baseUrl?: string
}

export type NexusSettingsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.nexus'> & InjectFace<NexusInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.nexus': NexusLocaleKey
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const body: unknown = await response.json()
  if (!response.ok || (body as { ok?: boolean }).ok === false) {
    const detail = (body as { error?: unknown }).error
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${response.status}`)
  }
  return body as T
}

export function NexusSettingsTab({ t }: NexusSettingsTabProps) {
  const [devices, setDevices] = useState<Device[]>([])
  const [kill, setKill] = useState<Snapshot>({ engaged: false, engagedAt: null, releasedAt: null })
  const [code, setCode] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [deviceResult, killResult] = await Promise.all([
        json<DeviceListResponse>('/nexus/admin/device.list'),
        json<KillSwitchSnapshot>('/nexus/admin/killswitch.state'),
      ])
      setDevices(deviceResult.devices)
      setKill({
        engaged: killResult.engaged,
        engagedAt: killResult.engagedAt ?? null,
        releasedAt: killResult.releasedAt ?? null,
      })
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createCode = async (): Promise<void> => {
    try {
      const result = await json<PairingCreateResult>('/nexus/admin/pairing.create', { method: 'POST' })
      if (result.ok) setCode(result.pairingCode)
    } catch {
      setError(true)
    }
  }

  const revoke = async (deviceId: string): Promise<void> => {
    if (!window.confirm(`${t('revoke')} ${deviceId}?`)) return
    try {
      await json<RevokeResult>('/nexus/admin/device.revoke', { method: 'POST', body: JSON.stringify({ deviceId }) })
      await load()
    } catch {
      setError(true)
    }
  }

  const toggleKill = async (): Promise<void> => {
    try {
      const path = kill.engaged ? '/nexus/admin/killswitch.release' : '/nexus/admin/killswitch.engage'
      const result = await json<KillSwitchSnapshot>(path, { method: 'POST', body: JSON.stringify({ reason: 'web settings' }) })
      setKill({
        engaged: result.engaged,
        engagedAt: result.engagedAt ?? null,
        releasedAt: result.releasedAt ?? null,
      })
    } catch {
      setError(true)
    }
  }

  return (
    <div className={css.root} aria-busy={loading}>
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>{t('eyebrow')}</p>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.subtitle}>{t('pairingHint')}</p>
        </div>
        <span className={`${css.statusPill} ${kill.engaged ? css.statusDanger : css.statusGood}`}>
          <span className={css.statusDot} />
          {kill.engaged ? t('engaged') : t('clear')}
        </span>
      </header>
      {error ? (
        <div className={css.alert} role="alert">
          <span>{t('error')}</span>
          <button className={css.secondary} type="button" onClick={() => { void load() }}>
            {t('retry')}
          </button>
        </div>
      ) : null}
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div>
            <h3>{t('pairing')}</h3>
            <p className={css.hint}>{t('pairingHint')}</p>
          </div>
          <button className={css.primary} type="button" onClick={() => { void createCode() }}>
            {t('createCode')}
          </button>
        </div>
        {code ? (
          <div className={css.codePanel}>
            <p className={css.meta}>{t('codeReady')}</p>
            <div className={css.code} data-pairing-code>
              {code}
            </div>
          </div>
        ) : null}
      </section>
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div>
            <h3>{t('devices')}</h3>
            <p className={css.hint}>
              {devices.length} {t('active')}
            </p>
          </div>
          <button className={css.secondary} type="button" onClick={() => { void load() }}>
            {t('refresh')}
          </button>
        </div>
        {devices.length === 0 && !loading ? (
          <p className={css.empty}>{t('empty')}</p>
        ) : (
          <ul className={css.devices}>
            {devices.map(device => (
              <li className={css.device} key={device.deviceId}>
                <div className={css.deviceInfo}>
                  <span className={css.deviceIcon} aria-hidden="true" />
                  <div>
                    <div className={css.deviceId}>{device.deviceId}</div>
                    <div className={css.meta}>{device.revokedAt ? t('revoked') : t('active')}</div>
                  </div>
                </div>
                {device.revokedAt ? null : (
                  <button className={css.danger} type="button" onClick={() => { void revoke(device.deviceId) }}>
                    {t('revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={`${css.section} ${kill.engaged ? css.sectionDanger : ''}`}>
        <div className={css.sectionHeader}>
          <div>
            <h3>{t('killSwitch')}</h3>
            <p className={css.hint}>{kill.engaged ? t('engaged') : t('clear')}</p>
          </div>
          <button className={kill.engaged ? css.secondary : css.dangerFilled} type="button" onClick={() => { void toggleKill() }}>
            {kill.engaged ? t('release') : t('engage')}
          </button>
        </div>
      </section>
    </div>
  )
}
