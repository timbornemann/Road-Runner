import { useEffect, useRef, useState } from 'react'
import { Cable, Copy } from 'lucide-react'
import { api, Modal } from './shared'

interface Connection {
  enabled: boolean
  read_only: boolean
  revision: string | null
}

export function useAgentConnection(reload: () => Promise<void>) {
  const [connection, setConnection] = useState<Connection | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let lastRevision: string | null = null
    let running = false

    async function check() {
      clearTimeout(timer)
      if (running || document.hidden) return
      running = true
      let delay = 0
      try {
        const current = await api<Connection>('/api/integrations/mcp')
        if (!active) return
        setConnection((previous) =>
          previous?.enabled === current.enabled &&
          previous.read_only === current.read_only &&
          previous.revision === current.revision
            ? previous
            : current,
        )
        if (current.enabled && !current.read_only) {
          delay = 5000
          if (current.revision !== lastRevision) {
            await reload()
            lastRevision = current.revision
          }
        }
      } catch {
        if (active) setConnection(null)
        delay = 15000
      } finally {
        running = false
        if (active && delay && !document.hidden) timer = setTimeout(check, delay)
      }
    }

    void check()
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [reload])
  return connection
}

export function AgentConnection({
  connection,
  onClose,
}: {
  connection: Connection | null
  onClose: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [feedback, setFeedback] = useState('')
  const url = window.location.origin + '/mcp'
  const command = 'codex mcp add road-runner --url ' + url + ' --bearer-token-env-var RR_MCP_TOKEN'

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setFeedback('Befehl kopiert.')
    } catch {
      field.current?.focus()
      field.current?.select()
      setFeedback('Befehl markiert. Über das Kontextmenü oder mit Strg/Cmd + C kopieren.')
    }
  }
  return (
    <Modal title="KI-Agent verbinden" onClose={onClose}>
      <div className="agent-connection">
        <p className="agent-status">
          <Cable size={17} />
          {connection === null
            ? 'Verbindungsstatus nicht verfügbar'
            : connection.enabled
              ? connection.read_only
                ? 'MCP aktiv · Nur lesen'
                : 'MCP aktiv · Lesen und bearbeiten'
              : 'MCP ausgeschaltet'}
        </p>
        {connection?.enabled ? (
          <p>
            Setze auf dem Gerät mit Codex die Umgebungsvariable <code>RR_MCP_TOKEN</code> auf das Token deines
            Road-Runner-Servers. Starte Codex mit dieser Umgebung und füge die Verbindung hinzu.
          </p>
        ) : (
          <p>
            Setze <code>RR_MCP_ENABLED=true</code> und ein eigenes <code>RR_MCP_TOKEN</code> in der
            Container-Konfiguration. Erstelle den Container mit demselben Datenvolume neu. Für reinen
            Lesezugriff setze zusätzlich <code>RR_MCP_READ_ONLY=true</code>.
          </p>
        )}
        <label className="field">
          MCP-Adresse für Agenten
          <input readOnly value={url} onFocus={(event) => event.target.select()} />
        </label>
        <label className="field">
          Befehl für Codex
          <textarea ref={field} readOnly value={command} rows={3} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => void copyCommand()}>
          <Copy size={15} /> Befehl kopieren
        </button>
        {feedback && <small role="status">{feedback}</small>}
        <p>
          Öffne Road-Runner auf dem Agentengerät über die LAN-Adresse des Hosts, um den passenden Befehl für
          dieses Gerät zu erhalten.
        </p>
      </div>
    </Modal>
  )
}
