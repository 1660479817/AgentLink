import assert from "node:assert/strict";
import test from "node:test";
import { isTruthy, renderTemplate } from "./render-config.mjs";

test("replaces variables from the environment", () => {
  const text = renderTemplate("server_name {{KNOT_DOMAIN}};\nroot {{ROOT}};", {
    KNOT_DOMAIN: "wang.xknot.si",
    ROOT: "/var/www/knot",
  });
  assert.equal(text, "server_name wang.xknot.si;\nroot /var/www/knot;");
});

test("keeps and drops sections by truthiness", () => {
  const template = "{{#SSL}}listen 443 ssl;{{/SSL}}{{^SSL}}listen 80;{{/SSL}}";
  assert.equal(renderTemplate(template, { SSL: "1" }), "listen 443 ssl;");
  assert.equal(renderTemplate(template, { SSL: "0" }), "listen 80;");
});

test("nested sections with the same name stay balanced", () => {
  const text = renderTemplate("{{#A}}1{{#A}}2{{/A}}3{{/A}}", { A: "1" });
  assert.equal(text, "123");
});

test("unknown variables fail loudly", () => {
  assert.throws(() => renderTemplate("{{MISSING}}", {}), /MISSING/);
});

test("unclosed sections fail loudly", () => {
  assert.throws(() => renderTemplate("{{#A}}x", { A: "1" }), /A/);
});

test("truthiness follows the documented switch values", () => {
  for (const value of ["1", "true", "yes", "on", "anything"]) assert.equal(isTruthy(value), true);
  for (const value of ["", "0", "false", "no", "off", "  "]) assert.equal(isTruthy(value), false);
});
