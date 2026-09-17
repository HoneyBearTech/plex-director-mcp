import { useState } from "react";
import { api, type DiagnoseStep, type MovieStatus, type SearchResult } from "../api";

export function QueryPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [status, setStatus] = useState<MovieStatus | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnoseStep[] | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    setDiagnosis(null);
    try {
      const { results } = await api.movieSearch(query);
      setResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function inspect(title: string) {
    setLoading(true);
    setError(null);
    setResults(null);
    setStatus(null);
    setDiagnosis(null);
    try {
      const [statusResult, diagnoseResult] = await Promise.all([api.movieStatus(title), api.movieDiagnose(title)]);
      setStatus(statusResult);
      setDiagnosis(diagnoseResult.steps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h2>Query</h2>
      <form className="search-form" onSubmit={runSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a movie..."
        />
        <button type="submit" disabled={loading}>
          Search
        </button>
      </form>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {results && (
        <div className="result-grid">
          {results.length === 0 && <p className="muted">No results.</p>}
          {results.map((movie) => (
            <button key={movie.tmdbId} className="result-card" onClick={() => inspect(movie.title)}>
              {movie.posterUrl && <img src={movie.posterUrl} alt={movie.title} />}
              <div>
                <strong>{movie.title}</strong> {movie.year && <span className="muted">({movie.year})</span>}
                <p className="overview">{movie.overview}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {status && (
        <div className="card">
          <h3>Status</h3>
          {status.found ? (
            <div className="status-detail">
              {status.posterUrl && <img src={status.posterUrl} alt={status.title} />}
              <dl>
                <dt>Title</dt>
                <dd>
                  {status.title} ({status.year})
                </dd>
                <dt>Monitored</dt>
                <dd>{status.monitored ? "Yes" : "No"}</dd>
                <dt>Has file</dt>
                <dd>{status.hasFile ? "Yes" : "No"}</dd>
                <dt>Library status</dt>
                <dd>{status.status}</dd>
                {status.path && (
                  <>
                    <dt>Path</dt>
                    <dd>{status.path}</dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <p className="muted">
              {status.inRadarrDatabase ? "In Radarr's search results but not in your library." : "Not found in Radarr."}
            </p>
          )}
        </div>
      )}

      {diagnosis && (
        <div className="card">
          <h3>Diagnosis</h3>
          <ul className="steps">
            {diagnosis.map((step, i) => (
              <li key={i} className={`step step-${step.status}`}>
                <strong>{step.step}:</strong> {step.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
