import "./setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUptime, parseProbeOutput } from "../src/cluster.js";

const SEP = "\n@@@FIELD@@@\n";

describe("formatUptime", () => {
  it("shows a compact form from raw seconds", () => {
    assert.equal(formatUptime(0), "< 1m");
    assert.equal(formatUptime(59), "< 1m");
    assert.equal(formatUptime(60), "1m");
    assert.equal(formatUptime(3600), "1h");
    assert.equal(formatUptime(90_000), "1d 1h");
    assert.equal(formatUptime(7 * 86_400), "1w");
  });
  it("drops the hours once there are weeks, and minutes once there are days", () => {
    assert.equal(formatUptime(9 * 86_400 + 3600), "1w 2d");
    assert.equal(formatUptime(86_400 + 300), "1d");
  });
});

describe("parseProbeOutput", () => {
  const sample = ["atlas", "82.8", "16.43", "5272", "32094", "20", "ombi,", "115G 57G 52%", "1300000"].join(SEP);

  it("parses the combined script's output", () => {
    const host = parseProbeOutput("192.168.40.68", sample);
    assert.deepEqual(host, {
      host: "192.168.40.68",
      hostname: "atlas",
      online: true,
      cpuPercent: 82.8,
      ramPercent: 16.43,
      ramUsedMb: 5272,
      ramTotalMb: 32094,
      containersRunning: 20,
      deadContainers: ["ombi"],
      diskPercent: 52,
      diskUsed: "57G",
      diskTotal: "115G",
      uptime: "2w 1d",
    });
  });
  it("lists several stopped containers and none", () => {
    const many = ["h", "1", "1", "1", "1", "1", "a,b,c,", "1G 1G 1%", "1"].join(SEP);
    assert.deepEqual(parseProbeOutput("h", many).deadContainers, ["a", "b", "c"]);
    const none = ["h", "1", "1", "1", "1", "1", "", "1G 1G 1%", "1"].join(SEP);
    assert.deepEqual(parseProbeOutput("h", none).deadContainers, []);
  });
  it("uses safe defaults when fields are missing or garbage", () => {
    const host = parseProbeOutput("10.0.0.9", "");
    assert.equal(host.hostname, "10.0.0.9");
    assert.equal(host.cpuPercent, 0);
    assert.equal(host.diskUsed, "?");
    assert.equal(host.diskTotal, "?");
    assert.equal(host.uptime, "< 1m");
    assert.equal(parseProbeOutput("h", ["h", "not-a-number"].join(SEP)).cpuPercent, 0);
  });
});
