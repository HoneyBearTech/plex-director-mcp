// The parts of SABnzbd's API (mode=queue, output=json) this app reads. SABnzbd
// sends numbers as strings.

export interface SabnzbdSlot {
  filename?: string;
  status?: string;
  percentage?: string;
  timeleft?: string;
  mb?: string;
  mbleft?: string;
}

export interface SabnzbdQueueResponse {
  queue?: { slots?: SabnzbdSlot[] };
}
