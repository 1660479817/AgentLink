import test from "node:test";
import assert from "node:assert/strict";
import { internalAgentIds, retiredAgentIds } from "./apply-config.mjs";

const manifest = (...ids) => ({ agents: ids.map((id) => ({ id, skills: [], allowAgents: [] })) });

test("a platform agent dropped from the manifest is reported as retired", () => {
  const config = {
    agents: {
      entries: {
        "knot-intel": { name: "knot-intel" },
        "knot-admin": { name: "knot-admin" },
        "knot-retrieval": { name: "knot-retrieval" },
      },
    },
  };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel", "knot-admin")), ["knot-retrieval"]);
});

test("nothing is retired while the manifest still lists the agent", () => {
  const config = { agents: { entries: { "knot-intel": {}, "knot-admin": {}, "knot-actuary": {} } } };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel", "knot-admin", "knot-actuary")), []);
});

test("a human's agent and an internal agent are never retired", () => {
  const config = {
    agents: {
      entries: {
        "knot-intel": {},
        main: {},
        manwjh: {},
        "AI-Roaster": {},
        "随性的豆包": {},
      },
    },
  };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel")), []);
});

test("every knot- entry is retired when the manifest lists none", () => {
  const config = { agents: { entries: { "knot-intel": {}, "knot-actuary": {}, main: {} } } };
  assert.deepEqual(retiredAgentIds(config, manifest()), ["knot-actuary", "knot-intel"]);
});

test("a config with no agents table has nothing to retire", () => {
  assert.deepEqual(retiredAgentIds({}, manifest("knot-intel")), []);
  assert.deepEqual(retiredAgentIds({ agents: {} }, manifest("knot-intel")), []);
});

// knot- 前缀是平台管理 Agent 的保留前缀；内部 Agent 用别的名字，所以两者不会互相覆盖。
test("internal agent ids skip the reserved knot- prefix", () => {
  assert.deepEqual(internalAgentIds(["finder", "knot-intel", "Bad Name", ""]), ["finder"]);
});
