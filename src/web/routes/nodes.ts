import { Router } from "express";
import { runRemoteCommand } from "../../ssh.js";

export const nodesRouter = Router();

// Real per-host SSH telemetry - deliberately not reusing the
// get_cluster_hardware_analytics MCP tool, which still returns hardcoded
// placeholder numbers (see src/tools/infrastructure.ts). A dashboard tab
// needs real data.
nodesRouter.get("/health", async (_req, res) => {
  const hosts = (process.env.UBUNTU_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (hosts.length === 0) {
    res.json({ hosts: [] });
    return;
  }

  const cpuCmd = "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'";
  const ramPercentCmd = "free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2}'";
  const ramUsedCmd = "free -m | awk 'NR==2{print $3}'";
  const ramTotalCmd = "free -m | awk 'NR==2{print $2}'";
  const dockerCountCmd = "docker ps --format '{{.Names}}' | wc -l";
  const dockerDownCmd = "docker ps -a --filter 'status=exited' --filter 'status=dead' --format '{{.Names}}' | tr '\\n' ','";

  const hostResults = await Promise.all(
    hosts.map(async (host) => {
      try {
        const [cpu, ramPercent, ramUsed, ramTotal, dockerCount, deadContainers] = await Promise.all([
          runRemoteCommand(host, cpuCmd),
          runRemoteCommand(host, ramPercentCmd),
          runRemoteCommand(host, ramUsedCmd),
          runRemoteCommand(host, ramTotalCmd),
          runRemoteCommand(host, dockerCountCmd),
          runRemoteCommand(host, dockerDownCmd),
        ]);

        return {
          host,
          online: true,
          cpuPercent: Number(cpu) || 0,
          ramPercent: Number(ramPercent) || 0,
          ramUsedMb: Number(ramUsed) || 0,
          ramTotalMb: Number(ramTotal) || 0,
          containersRunning: Number(dockerCount) || 0,
          deadContainers: deadContainers.split(",").filter(Boolean),
        };
      } catch {
        return { host, online: false };
      }
    })
  );

  res.json({ hosts: hostResults });
});
