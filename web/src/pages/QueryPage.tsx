import { useState } from "react";
import { Badge, Box, Button, Callout, Card, Flex, Grid, Heading, Text, TextField } from "@radix-ui/themes";
import { api, type DiagnoseStep, type MovieStatus, type SearchResult } from "../api";

const STEP_COLOR: Record<DiagnoseStep["status"], "green" | "amber" | "red" | "blue"> = {
  ok: "green",
  warn: "amber",
  error: "red",
  info: "blue",
};

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
    <Flex direction="column" gap="4">
      <Heading size="6">Query</Heading>

      <form onSubmit={runSearch}>
        <Flex gap="2">
          <Box flexGrow="1">
            <TextField.Root
              placeholder="Search for a movie..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Box>
          <Button type="submit" loading={loading}>
            Search
          </Button>
        </Flex>
      </form>

      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      {results && (
        <Grid columns="1" gap="2">
          {results.length === 0 && <Text color="gray">No results.</Text>}
          {results.map((movie) => (
            <Card key={movie.tmdbId} asChild>
              <button onClick={() => inspect(movie.title)} style={{ textAlign: "left", cursor: "pointer" }}>
                <Flex gap="3">
                  {movie.posterUrl && (
                    <img src={movie.posterUrl} alt={movie.title} width={60} style={{ borderRadius: 4 }} />
                  )}
                  <Box>
                    <Text weight="bold">{movie.title}</Text>
                    {movie.year && (
                      <Text color="gray">
                        {" "}
                        ({movie.year})
                      </Text>
                    )}
                    <Text as="p" size="2" color="gray">
                      {movie.overview}
                    </Text>
                  </Box>
                </Flex>
              </button>
            </Card>
          ))}
        </Grid>
      )}

      {status && (
        <Card>
          <Heading size="4" mb="3">
            Status
          </Heading>
          {status.found ? (
            <Flex gap="4">
              {status.posterUrl && (
                <img src={status.posterUrl} alt={status.title} width={120} style={{ borderRadius: 6 }} />
              )}
              <Grid columns="2" gap="2" width="100%">
                <Text color="gray">Title</Text>
                <Text>
                  {status.title} ({status.year})
                </Text>
                <Text color="gray">Monitored</Text>
                <Text>{status.monitored ? "Yes" : "No"}</Text>
                <Text color="gray">Has file</Text>
                <Text>{status.hasFile ? "Yes" : "No"}</Text>
                <Text color="gray">Library status</Text>
                <Text>{status.status}</Text>
                {status.path && (
                  <>
                    <Text color="gray">Path</Text>
                    <Text>{status.path}</Text>
                  </>
                )}
              </Grid>
            </Flex>
          ) : (
            <Text color="gray">
              {status.inRadarrDatabase ? "In Radarr's search results but not in your library." : "Not found in Radarr."}
            </Text>
          )}
        </Card>
      )}

      {diagnosis && (
        <Card>
          <Heading size="4" mb="3">
            Diagnosis
          </Heading>
          <Flex direction="column" gap="2">
            {diagnosis.map((step, i) => (
              <Flex key={i} gap="2" align="start">
                <Badge color={STEP_COLOR[step.status]}>{step.step}</Badge>
                <Text size="2">{step.detail}</Text>
              </Flex>
            ))}
          </Flex>
        </Card>
      )}
    </Flex>
  );
}
