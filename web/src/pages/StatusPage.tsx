import { api } from "../api";
import { usePolling } from "../usePolling";

export function StatusPage() {
  const activity = usePolling(api.plexActivity, 10_000);
  const analytics = usePolling(api.libraryAnalytics, 60_000);

  return (
    <div className="page">
      <h2>Server Status</h2>

      <div className="card">
        <h3>Plex Activity</h3>
        {activity.error && <p className="error">{activity.error}</p>}
        {activity.data && (
          <>
            <p>
              {activity.data.streamCount} active stream{activity.data.streamCount === 1 ? "" : "s"}
              {activity.data.streamCount > 0 && (
                <span className="muted">
                  {" "}
                  ({activity.data.directPlayCount} direct play, {activity.data.transcodeCount} transcoding)
                </span>
              )}
            </p>
            <table>
              <tbody>
                {activity.data.sessions.map((session, i) => (
                  <tr key={i}>
                    <td>{session.user}</td>
                    <td>
                      {session.title} {session.year && `(${session.year})`}
                    </td>
                    <td>{session.resolution}</td>
                    <td>{session.transcoding ? "Transcoding" : "Direct play"}</td>
                    <td>{session.progress}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Library Analytics</h3>
        {analytics.error && <p className="error">{analytics.error}</p>}
        {analytics.data?.categories.map((category) => (
          <div key={category.title}>
            <h4>{category.title}</h4>
            <table>
              <tbody>
                {category.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.label}</td>
                    <td>{row.plays} plays</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
