"use client";

import type { SettingsHealthResponse } from "@inf/contracts";
import { Download, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { apiRequest } from "../../lib/api-client";
import { downloadInventory } from "./export-inventory";

type State = "loading" | "error" | "success";
export function SettingsPage() {
  const [state, setState] = useState<State>("loading");
  const [health, setHealth] = useState<SettingsHealthResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const exportingRef = useRef(false);
  const load = useCallback(async () => { setState("loading"); try { setHealth(await apiRequest<SettingsHealthResponse>("/api/settings/health")); setState("success"); } catch { setState("error"); } }, []);
  useEffect(() => { void load(); }, [load]);
  const exportData = () => {
    if (!health || exportingRef.current) return;
    // State updates batch, so the ref is the immediate duplicate-export mutex.
    exportingRef.current = true; setExporting(true); setExportError(false);
    window.requestAnimationFrame(() => {
      try { downloadInventory(health); } catch { setExportError(true); }
      finally {
        // Keep the transition legible long enough for the disabled state to be perceived.
        window.setTimeout(() => { exportingRef.current = false; setExporting(false); }, 1000);
      }
    });
  };
  if (state === "loading") return <div className="settings-page"><PageHeader title="Settings" /><PageState kind="loading" title="Loading Settings…" /></div>;
  if (state === "error" || !health) return <div className="settings-page"><PageHeader title="Settings" /><PageState action={<RetryButton onRetry={() => void load()} />} kind="error" title="Settings could not be loaded. Try again." /></div>;
  const drive = (title: "Public Drive" | "Private Drive", value: SettingsHealthResponse["connectionHealth"]["publicDrive"], button: string) => <section aria-labelledby={`${title}-title`} className="settings-section"><h2 id={`${title}-title`}>{title}</h2><div className="settings-rows"><div><span>Connection health</span><strong className={value.healthy ? "health--ok" : "health--bad"}>{value.healthy ? "Healthy" : "Needs attention"}</strong></div>{value.folders.map((folder) => <div key={folder.id}><span>{folder.label}</span><strong className={folder.healthy ? "health--ok" : "health--bad"}>{folder.healthy ? "Healthy" : "Unavailable"}</strong></div>)}</div><a className="button button--secondary" href={value.folderUrl} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={20} strokeWidth={1.75} />{button}</a></section>;
  const rejectedFiles = [...health.quarantine.rejectedFiles].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const connectionsHealthy = health.connectionHealth.publicDrive.healthy && health.connectionHealth.privateDrive.healthy;
  return <div className="settings-page"><PageHeader title="Settings" /><section aria-label="Settings health overview" className="settings-overview"><div><span>Connections</span><strong className={connectionsHealthy ? "health--ok" : "health--bad"}>{connectionsHealthy ? "Healthy" : "Needs attention"}</strong></div><div><span>Library</span><strong>{health.data.library}</strong></div><div><span>Quarantine</span><strong className={health.quarantine.count === 0 ? "health--ok" : "health--bad"}>{health.quarantine.count === 0 ? "Clear" : `${health.quarantine.count} records`}</strong></div></section><section aria-labelledby="application-title" className="settings-section"><h2 id="application-title">Application</h2><div className="settings-rows"><div><span>Version</span><strong>{health.application.version}</strong></div><div><span>Runtime</span><strong>{health.application.runtimeVersion}</strong></div></div><p>INF does not use AI.</p></section><section aria-labelledby="connection-title" className="settings-section"><h2 id="connection-title">Connection health</h2></section>{drive("Public Drive", health.connectionHealth.publicDrive, "Open public image folder")}{drive("Private Drive", health.connectionHealth.privateDrive, "Open private backup folder")}<section aria-labelledby="data-title" className="settings-section"><h2 id="data-title">Data</h2><div className="settings-rows">{Object.entries(health.data).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section><section aria-labelledby="quarantine-title" className="settings-section"><h2 id="quarantine-title">Quarantine</h2>{health.quarantine.count === 0 ? <p>No quarantine records.</p> : <><div className="settings-rows">{health.quarantine.reasons.map((reason) => <div key={reason.reason}><span>{reason.reason}</span><strong>{reason.count}</strong></div>)}</div>{rejectedFiles.length > 0 ? <ul aria-label="Rejected files" className="rejected-files">{rejectedFiles.map((file) => <li key={file.eventId}><strong>{file.fileName}</strong><span>{file.reason} · {file.detectedMimeType ?? "Unknown MIME"} · {file.driveFileId} · {new Date(file.occurredAt).toLocaleString("en-US", { timeZone: "UTC" })}</span></li>)}</ul> : null}</>}{health.quarantine.count === 0 ? <p>No action is needed.</p> : null}</section><section aria-labelledby="backup-title" className="settings-section"><h2 id="backup-title">Backup and export</h2><p>Download a recovery inventory with Drive file IDs and checksums.</p>{exportError ? <p className="error-copy" role="status">The inventory could not be exported. Try again.</p> : null}<button className="button button--primary" disabled={exporting} onClick={exportData} type="button"><Download aria-hidden="true" size={20} strokeWidth={1.75} />{exporting ? "Exporting inventory…" : "Export inventory JSON"}</button></section><section aria-labelledby="pwa-title" className="settings-section"><h2 id="pwa-title">PWA</h2><p>Install INF from your browser menu for a focused learning workspace.</p></section></div>;
}
