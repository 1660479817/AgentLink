import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  countryOf,
  ipv4ToInt,
  ipv6ToBigInt,
  monthOf,
  parseRanges,
  previousMonth,
  resolveLocations,
} from "./geoip.mjs";

// DB-IP 免费库的格式：起始,结束,国家码，IPv4 与 IPv6 混在同一个文件里。
// ZZ 是「不知道」，不要当国家显示。
const CSV = `0.0.0.0,0.255.255.255,ZZ
1.0.0.0,1.0.0.255,AU
1.0.1.0,1.0.3.255,CN
119.123.0.0,119.123.255.255,CN
203.0.113.0,203.0.113.255,SG
2001:db8::,2001:db8:ffff:ffff:ffff:ffff:ffff:ffff,JP
`;

test("IPv4 and IPv6 addresses become comparable numbers", () => {
  assert.equal(ipv4ToInt("0.0.0.0"), 0);
  assert.equal(ipv4ToInt("1.2.3.4"), 16909060);
  assert.equal(ipv4ToInt("1.2.3"), null);
  assert.equal(ipv4ToInt("1.2.3.999"), null);
  assert.equal(ipv6ToBigInt("::").toString(16), "0");
  assert.equal(ipv6ToBigInt("2001:db8::1").toString(16), "20010db8000000000000000000000001");
  // 双冒号只补一组零，补的位置不能错。
  assert.equal(ipv6ToBigInt("2001:db8:0:0:0:0:0:1").toString(16), "20010db8000000000000000000000001");
});

test("lookup answers inside a range, on both ends, and never outside", () => {
  const table = parseRanges(CSV);
  assert.equal(countryOf(table, "1.0.1.0"), "CN");
  assert.equal(countryOf(table, "1.0.3.255"), "CN");
  assert.equal(countryOf(table, "1.0.4.0"), null);
  assert.equal(countryOf(table, "119.123.195.96"), "CN");
  assert.equal(countryOf(table, "203.0.113.9"), "SG");
  assert.equal(countryOf(table, "2001:db8::1"), "JP");
  // ZZ 是未知，不当作一个国家。
  assert.equal(countryOf(table, "0.1.2.3"), null);
  // 私有地址不在表里。
  assert.equal(countryOf(table, "192.168.1.1"), null);
  assert.equal(countryOf(table, "not-an-ip"), null);
});

test("a shuffled file still looks up correctly", () => {
  const table = parseRanges(["203.0.113.0,203.0.113.255,SG", "1.0.0.0,1.0.3.255,CN"].join("\n"));
  assert.equal(countryOf(table, "1.0.2.0"), "CN");
  assert.equal(countryOf(table, "203.0.113.1"), "SG");
});

test("months roll back one at a time", () => {
  assert.equal(monthOf(new Date("2026-10-22T00:00:00Z")), "2026-10");
  assert.equal(previousMonth("2026-10"), "2026-09");
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("resolving writes the location per instance and caches the address", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-"));
  const month = monthOf(new Date("2026-10-22T00:00:00Z"));
  await writeFile(path.join(dir, `dbip-country-lite-${month}.csv.gz`), gzipSync(CSV));

  let downloads = 0;
  const fetchImpl = async () => {
    downloads += 1;
    throw new Error("should use the local file");
  };
  const peers = {
    wang: { ip: "119.123.195.96", account: "knot-tunnel" },
    cpswang: { ip: "192.168.1.10", account: "knot-tunnel-cpswang" },
  };
  const now = new Date("2026-10-22T03:00:00Z");
  const first = await resolveLocations({ dir, peers, now, fetchImpl });
  assert.deepEqual(first.locations, {
    wang: { country: "CN", at: now.toISOString(), source: "tunnel" },
  });
  assert.equal(first.resolved, 2);
  assert.equal(downloads, 0);

  const saved = JSON.parse(await readFile(path.join(dir, "locations.json"), "utf8"));
  assert.equal(saved.locations.wang.country, "CN");

  // 第二次：地址都在缓存里，既不下载也不重新解析。
  const second = await resolveLocations({ dir, peers, now, fetchImpl });
  assert.equal(second.resolved, 0);
  assert.equal(second.locations.wang.country, "CN");

  // 缓存过期后重新判一次；库还是本地那份。
  const later = new Date("2026-12-01T03:00:00Z");
  const third = await resolveLocations({ dir, peers, now: later, fetchImpl });
  assert.equal(third.resolved, 2);
  assert.equal(third.locations.wang.country, "CN");
});

test("no database and no network means an empty table, not a guess", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-empty-"));
  const result = await resolveLocations({
    dir,
    peers: { wang: { ip: "119.123.195.96" } },
    now: new Date("2026-10-22T03:00:00Z"),
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(result.locations, {});
});
