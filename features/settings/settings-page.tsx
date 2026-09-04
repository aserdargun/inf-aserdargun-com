"use client";

import type { SettingsHealthResponse } from "@inf/contracts";
import { Download, ExternalLink, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/ui/page-header";
import { PageState, RetryButton } from "../../components/ui/page-state";
import { StatusRow } from "../../components/ui/status-row";
import { ThemeToggle } from "../../components/theme-toggle";
import { apiRequest } from "../../lib/api-client";
import { downloadInventory } from "./export-inventory";

type State = "loading" | "error" | "success";
const dataLabels: Record<keyof SettingsHealthResponse["data"], string> = {
  total: "Total",
  uncategorized: "Uncategorized",
  library: "Library",
  archive: "Archive",
  due: "Due",
  reviewed: "Reviewed",
  seen: "Seen",
};
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
  if (state === "loading") return <div className="settings-page"><PageHeader title="Settings" /><PageState icon={SettingsIcon} kind="loading" layout="compact" title="Loading Settings…" /></div>;
  if (state === "error" || !health) return <div className="settings-page"><PageHeader title="Settings" /><PageState action={<RetryButton onRetry={() => void load()} />} icon={SettingsIcon} kind="error" layout="compact" title="Settings could not be loaded. Try again." /></div>;
  const drive = (title: "Public Drive" | "Private Drive", value: SettingsHealthResponse["connectionHealth"]["publicDrive"], button: string) => {
    const titleId = `${title.toLowerCase().replace(" ", "-")}-title`;
    return <section aria-labelledby={titleId} className="settings-drive"><h3 id={titleId}>{title}</h3><div className="settings-rows"><StatusRow label="Connection health" tone={value.healthy ? "positive" : "negative"} value={value.healthy ? "Healthy" : "Needs attention"} />{value.folders.map((folder) => <StatusRow key={folder.id} label={folder.label} tone={folder.healthy ? "positive" : "negative"} value={folder.healthy ? "Healthy" : "Unavailable"} />)}</div><a className="button button--secondary" href={value.folderUrl} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={20} strokeWidth={1.75} />{button}</a></section>;
  };
  const rejectedFiles = [...health.quarantine.rejectedFiles].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const connectionsHealthy = health.connectionHealth.publicDrive.healthy && health.connectionHealth.privateDrive.healthy;
  return <div className="settings-page"><PageHeader title="Settings" /><section aria-labelledby="appearance-title" className="settings-section settings-section--appearance"><h2 id="appearance-title">Appearance</h2><div className="settings-rows"><div className="settings-appearance-row"><span>Color theme</span><ThemeToggle presentation="row" /></div></div></section><section aria-labelledby="connection-title" className="settings-section"><h2 id="connection-title">Connection health</h2><section aria-label="Settings health overview" className="settings-overview"><StatusRow label="Connections" tone={connectionsHealthy ? "positive" : "negative"} value={connectionsHealthy ? "Healthy" : "Needs attention"} /><StatusRow label="Library" value={health.data.library} /><StatusRow label="Quarantine" tone={health.quarantine.count === 0 ? "positive" : "negative"} value={health.quarantine.count === 0 ? "Clear" : `${health.quarantine.count} records`} /></section><div className="settings-drive-grid">{drive("Public Drive", health.connectionHealth.publicDrive, "Open public image folder")}{drive("Private Drive", health.connectionHealth.privateDrive, "Open private backup folder")}</div></section><section aria-labelledby="data-title" className="settings-section"><h2 id="data-title">Data health</h2><div className="settings-rows">{Object.entries(health.data).map(([label, value]) => <StatusRow key={label} label={dataLabels[label as keyof SettingsHealthResponse["data"]]} value={value} />)}<StatusRow label="Quarantine" tone={health.quarantine.count === 0 ? "positive" : "negative"} value={health.quarantine.count === 0 ? "Clear" : `${health.quarantine.count} records`} /></div>{health.quarantine.count === 0 ? <><p>No quarantine records.</p><p>No action is needed.</p></> : <><h3>Quarantine details</h3><div className="settings-rows">{health.quarantine.reasons.map((reason) => <StatusRow key={reason.reason} label={reason.reason} value={reason.count} />)}</div>{rejectedFiles.length > 0 ? <ul aria-label="Rejected files" className="rejected-files">{rejectedFiles.map((file) => <li key={file.eventId}><strong>{file.fileName}</strong><span>{file.reason} · {file.detectedMimeType ?? "Unknown MIME"} · {file.driveFileId} · {new Date(file.occurredAt).toLocaleString("en-US", { timeZone: "UTC" })}</span></li>)}</ul> : null}</>}</section><section aria-labelledby="backup-title" className="settings-section"><h2 id="backup-title">Backup and recovery</h2><p>Download a recovery inventory with Drive file IDs and checksums.</p>{exportError ? <p className="error-copy" role="status">The inventory could not be exported. Try again.</p> : null}<button className="button button--primary" disabled={exporting} onClick={exportData} type="button"><Download aria-hidden="true" size={20} strokeWidth={1.75} />{exporting ? "Exporting inventory…" : "Export inventory JSON"}</button></section><section aria-labelledby="application-title" className="settings-section"><h2 id="application-title">Application details</h2><div className="settings-rows"><StatusRow label="Version" value={health.application.version} /><StatusRow label="Runtime" value={health.application.runtimeVersion} /></div><p>{health.application.usesAi ? "AI suggestions are enabled." : "AI suggestions are not configured."}</p><p>Install Infographics from your browser menu for a focused learning workspace.</p></section></div>;
}
