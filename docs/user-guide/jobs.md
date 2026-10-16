# Batch jobs

A batch job asks Radarr to search again for many movies, one at a time, slowly enough that your indexers and
download clients aren't flooded. Today there is one kind: a **movie upgrade** batch. Jobs are planned and
controlled from Claude Desktop; the dashboard's **Jobs** page shows their progress
([The dashboard](dashboard.md#jobs)).

## 1. Plan: `plan_media_upgrade`

"Plan an upgrade of my movies below 1080p." It reads every movie in Radarr and picks the **monitored** ones that
either have no file yet or whose file is below 1080p (anything not 1080p, 2160p or 4K). It takes up to 25 of them
(or the number you ask for, at most 100) into a new job, and replies with the job number, how many movies qualified, and a
few of the titles.

- The job starts as **`PENDING`**: nothing has been searched yet.
- Each step asks Radarr to *search* for one movie. Which release Radarr then grabs, and whether it counts as an
  upgrade, is decided by that movie's quality profile in Radarr. The job doesn't change any profile, and the
  target you name (1080p or 4K) doesn't change which movies are picked.
- TV is refused: there are no batch upgrades for shows.

## 2. Start: `update_job_status` with `RESUME`

"Start job 3." Resuming is what starts a job: it becomes **`RUNNING`**, and the job runner takes it from there.

## 3. The job runner

While a job is running, the job runner advances it by **one movie per interval**: every 60 seconds by default
(`JOB_RUNNER_INTERVAL_SECONDS`, at least 10; `0` turns the runner off). It sends one search per interval in
total, not per job: with two jobs running, the older one is worked through first.

- Progress is saved after every movie, so a restart carries on where it stopped.
- When the last movie has been searched, the job becomes **`COMPLETED`**, and Discord gets a message if
  `DISCORD_WEBHOOK_URL` is set.
- If a step fails three times in a row (for example because Radarr is down), the job is **paused** and Discord
  is told, with the last error. Fix the problem, then resume it.
- With Claude Desktop and the dashboard container both running on the same data, each movie is still searched
  only once: a step is claimed in the database before the search is sent.

## Pausing, cancelling, stepping

| Ask | Tool | What happens |
| :--- | :--- | :--- |
| "Pause job 3" | `update_job_status` `PAUSE` | **`PAUSED`**: the runner leaves it alone until it is resumed. |
| "Resume job 3" | `update_job_status` `RESUME` | **`RUNNING`** again, from where it stopped. |
| "Cancel job 3" | `update_job_status` `CANCEL` | **`CANCELLED`**, for good: a cancelled or completed job can't be resumed or paused. Plan a new one instead. |
| "Run the next step of job 3" | `execute_next_job_step` | Searches the next movie straight away, without waiting for the runner. Stepping a `PENDING` job this way also starts it. A paused job has to be resumed first. |
| "What jobs are there?" | `get_background_jobs` | The ten newest jobs, with their status and progress. |

A change that doesn't fit the job's state (pausing a job that is already paused, resuming one that is running)
is refused with the job's current state, and nothing changes.

Already-searched movies stay searched: pausing or cancelling stops further searches, but doesn't undo the ones
that were sent or anything Radarr has grabbed since.
