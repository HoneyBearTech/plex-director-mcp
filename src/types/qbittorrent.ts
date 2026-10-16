// The parts of qBittorrent's Web API v2 /torrents/info entries this app reads.

export interface QbitTorrent {
  hash: string;
  name: string;
  // e.g. "downloading", "stalledDL".
  state: string;
  // 0 to 1.
  progress: number;
  // Bytes per second.
  dlspeed: number;
  size: number;
  num_seeds: number;
}
