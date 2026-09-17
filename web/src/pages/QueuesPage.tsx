import { api } from "../api";
import { usePolling } from "../usePolling";

export function QueuesPage() {
  const sabnzbd = usePolling(api.sabnzbdQueue, 10_000);
  const qbittorrent = usePolling(api.qbittorrentQueue, 10_000);

  return (
    <div className="page">
      <h2>Downloader Queues</h2>

      <div className="card">
        <h3>SABnzbd</h3>
        {sabnzbd.error && <p className="error">{sabnzbd.error}</p>}
        {sabnzbd.data && sabnzbd.data.items.length === 0 && <p className="muted">Queue is empty.</p>}
        {sabnzbd.data && sabnzbd.data.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Progress</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {sabnzbd.data.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.filename}</td>
                  <td>{item.status}</td>
                  <td>{item.percentage}%</td>
                  <td>{item.timeleft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>qBittorrent</h3>
        {qbittorrent.error && <p className="error">{qbittorrent.error}</p>}
        {qbittorrent.data && qbittorrent.data.items.length === 0 && <p className="muted">Queue is empty.</p>}
        {qbittorrent.data && qbittorrent.data.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Progress</th>
                <th>Speed</th>
                <th>Seeders</th>
              </tr>
            </thead>
            <tbody>
              {qbittorrent.data.items.map((item, i) => (
                <tr key={i} className={item.stalled ? "error" : undefined}>
                  <td>{item.name}</td>
                  <td>{item.state}</td>
                  <td>{(item.progress * 100).toFixed(1)}%</td>
                  <td>{item.dlspeedKbps.toFixed(1)} KB/s</td>
                  <td>{item.seeders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
