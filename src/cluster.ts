import { runRemoteCommand } from "./ssh.js";
import { getSetting } from "./settings.js";
import { HostKeyMismatchError } from "./hostKeys.js";
import { getErrorMessage } from "./util.js";

// The one place that knows how to read a cluster host's health over SSH. Used
// by the web dashboard's Node Utilization page and by both cluster MCP tools,
// so the probe commands can't drift apart between them.

export function getConfiguredHosts(): string[] {
  return getSetting("UBUNTU_HOSTS")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

// "up 2 weeks, 1 day, 1 hour, 1 minute" from `uptime -p` wraps badly in a
// table cell - compute a compact "2w 1d 1h" from raw seconds instead.
export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  const parts: string[] = [];
  if (weeks > 0) parts.push(`${weeks}w`);
  if (remainingDays > 0) parts.push(`${remainingDays}d`);
  if (weeks === 0 && hours > 0) parts.push(`${hours}h`);
  if (weeks === 0 && days === 0 && minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(" ") : "< 1m";
}

export interface OnlineHostHealth {
  host: string;
  hostname: string;
  online: true;
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  containersRunning: number;
  deadContainers: string[];
  diskPercent: number;
  diskUsed: string;
  diskTotal: string;
  uptime: string;
}

export interface OfflineHostHealth {
  host: string;
  hostname: string;
  online: false;
  // Why the probe failed (connection refused, bad key, ...), for the dashboard.
  error: string;
  // Set when the host presented a different SSH key than the one remembered.
  hostKeyChanged?: { expected: string; actual: string };
}

export type HostHealth = OnlineHostHealth | OfflineHostHealth;

const hostnameCmd = "hostname";
const cpuCmd = "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'";
const ramPercentCmd = "free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2}'";
const ramUsedCmd = "free -m | awk 'NR==2{print $3}'";
const ramTotalCmd = "free -m | awk 'NR==2{print $2}'";
const dockerCountCmd = "docker ps --format '{{.Names}}' | wc -l";
const dockerDownCmd = "docker ps -a --filter 'status=exited' --filter 'status=dead' --format '{{.Names}}' | tr '\\n' ','";
// Space-separated "size used percent" for the root filesystem, e.g. "115G 55G 50%".
const diskCmd = "df -h / | awk 'NR==2{print $2, $3, $5}'";
const uptimeCmd = "cat /proc/uptime | awk '{print int($1)}'";

// runRemoteCommand doesn't pool connections, so running one command per metric
// costs a full TCP + auth handshake (and a private-key file read) each time -
// a fail2ban / connection-rate risk on a dashboard that polls every 15s.
// Chaining every metric into one remote script and splitting the output on a
// marker keeps it to a single connection per host per probe.
const FIELD_SEP = "@@@FIELD@@@";
const combinedCmd = [
  hostnameCmd,
  cpuCmd,
  ramPercentCmd,
  ramUsedCmd,
  ramTotalCmd,
  dockerCountCmd,
  dockerDownCmd,
  diskCmd,
  uptimeCmd,
].join(` ; echo '${FIELD_SEP}' ; `);

// Turns the combined script's output into typed health data. Pure, so it can
// be tested without an SSH connection.
export function parseProbeOutput(host: string, output: string): OnlineHostHealth {
  const [hostname, cpu, ramPercent, ramUsed, ramTotal, dockerCount, deadContainers, disk, uptime] = output
    .split(FIELD_SEP)
    .map((s) => s.trim());

  const [diskTotal, diskUsed, diskPercentRaw] = (disk ?? "").split(/\s+/);

  return {
    host,
    hostname: hostname || host,
    online: true,
    cpuPercent: Number(cpu) || 0,
    ramPercent: Number(ramPercent) || 0,
    ramUsedMb: Number(ramUsed) || 0,
    ramTotalMb: Number(ramTotal) || 0,
    containersRunning: Number(dockerCount) || 0,
    deadContainers: (deadContainers ?? "").split(",").filter(Boolean),
    diskPercent: Number.parseFloat(diskPercentRaw ?? "") || 0,
    diskUsed: diskUsed || "?",
    diskTotal: diskTotal || "?",
    uptime: formatUptime(Number(uptime) || 0),
  };
}

export async function probeHost(host: string): Promise<HostHealth> {
  try {
    return parseProbeOutput(host, await runRemoteCommand(host, combinedCmd));
  } catch (error: unknown) {
    if (error instanceof HostKeyMismatchError) {
      return { host, hostname: host, online: false, error: error.message, hostKeyChanged: { expected: error.expected, actual: error.actual } };
    }
    return { host, hostname: host, online: false, error: getErrorMessage(error) };
  }
}

export function probeAllHosts(hosts: string[]): Promise<HostHealth[]> {
  return Promise.all(hosts.map(probeHost));
}
