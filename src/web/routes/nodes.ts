import { Router } from "express";
import { runRemoteCommand } from "../../ssh.js";
import { getSetting } from "../../settings.js";

export const nodesRouter = Router();

// "up 2 weeks, 1 day, 1 hour, 1 minute" from `uptime -p` wraps badly in a
// table cell - compute a compact "2w 1d 1h" from raw seconds instead.
function formatUptime(totalSeconds: number): string {
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

// Real per-host SSH telemetry - deliberately not reusing the
// get_cluster_hardware_analytics MCP tool, which still returns hardcoded
// placeholder numbers (see src/tools/infrastructure.ts). A dashboard tab
// needs real data.
nodesRouter.get("/health", async (_req, res) => {
  const hosts = getSetting("UBUNTU_HOSTS")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (hosts.length === 0) {
    res.json({ hosts: [] });
    return;
  }

  const hostnameCmd = "hostname";
  const cpuCmd = "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'";
  const ramPercentCmd = "free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2}'";
  const ramUsedCmd = "free -m | awk 'NR==2{print $3}'";
  const ramTotalCmd = "free -m | awk 'NR==2{print $2}'";
  const dockerCountCmd = "docker ps --format '{{.Names}}' | wc -l";
  const dockerDownCmd = "docker ps -a --filter 'status=exited' --filter 'status=dead' --format '{{.Names}}' | tr '\\n' ','";
  // Comma-separated "size,used,percent" for the root filesystem, e.g. "115G,55G,50%".
  const diskCmd = "df -h / | awk 'NR==2{print $2\",\"$3\",\"$5}'";
  const uptimeCmd = "cat /proc/uptime | awk '{print int($1)}'";

  const hostResults = await Promise.all(
    hosts.map(async (host) => {
      try {
        const [hostname, cpu, ramPercent, ramUsed, ramTotal, dockerCount, deadContainers, disk, uptime] = await Promise.all([
          runRemoteCommand(host, hostnameCmd),
          runRemoteCommand(host, cpuCmd),
          runRemoteCommand(host, ramPercentCmd),
          runRemoteCommand(host, ramUsedCmd),
          runRemoteCommand(host, ramTotalCmd),
          runRemoteCommand(host, dockerCountCmd),
          runRemoteCommand(host, dockerDownCmd),
          runRemoteCommand(host, diskCmd),
          runRemoteCommand(host, uptimeCmd),
        ]);

        const [diskTotal, diskUsed, diskPercentRaw] = disk.split(",");

        return {
          host,
          hostname: hostname || host,
          online: true,
          cpuPercent: Number(cpu) || 0,
          ramPercent: Number(ramPercent) || 0,
          ramUsedMb: Number(ramUsed) || 0,
          ramTotalMb: Number(ramTotal) || 0,
          containersRunning: Number(dockerCount) || 0,
          deadContainers: deadContainers.split(",").filter(Boolean),
          diskPercent: Number.parseFloat(diskPercentRaw ?? "") || 0,
          diskUsed: diskUsed || "?",
          diskTotal: diskTotal || "?",
          uptime: formatUptime(Number(uptime) || 0),
        };
      } catch {
        return { host, hostname: host, online: false };
      }
    })
  );

  res.json({ hosts: hostResults });
});
