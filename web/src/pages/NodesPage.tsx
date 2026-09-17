import { api } from "../api";
import { usePolling } from "../usePolling";

export function NodesPage() {
  const nodes = usePolling(api.nodeHealth, 15_000);

  return (
    <div className="page">
      <h2>Node Utilization</h2>
      <div className="card">
        {nodes.error && <p className="error">{nodes.error}</p>}
        {nodes.data && nodes.data.hosts.length === 0 && (
          <p className="muted">No hosts configured (set UBUNTU_HOSTS).</p>
        )}
        {nodes.data && nodes.data.hosts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Host</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>Containers</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {nodes.data.hosts.map((node) => (
                <tr key={node.host}>
                  <td>{node.host}</td>
                  <td>{node.online ? `${node.cpuPercent?.toFixed(1)}%` : "—"}</td>
                  <td>
                    {node.online
                      ? `${node.ramPercent?.toFixed(1)}% (${node.ramUsedMb}MB/${node.ramTotalMb}MB)`
                      : "—"}
                  </td>
                  <td>
                    {node.online ? (
                      <>
                        {node.containersRunning} running
                        {node.deadContainers && node.deadContainers.length > 0 && (
                          <span className="error"> ({node.deadContainers.length} stopped)</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={node.online ? "ok" : "error"}>{node.online ? "Online" : "Offline"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
