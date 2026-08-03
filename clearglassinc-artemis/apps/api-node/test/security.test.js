import assert from "node:assert/strict";
import test from "node:test";
import { validEmail, validIdentifier, verifyHmac } from "../src/security.js";
import crypto from "node:crypto";

test("identifier validation rejects enumeration/path payloads", () => {
  assert.equal(validIdentifier("case_01-A"), true);
  assert.equal(validIdentifier("../admin"), false);
  assert.equal(validIdentifier("x".repeat(129)), false);
});

test("email validation is bounded", () => {
  assert.equal(validEmail("operator@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(validEmail(`${"a".repeat(250)}@x.test`), false);
});

test("webhook HMAC requires an exact signature", () => {
  const body = Buffer.from('{"id":"evt_1"}');
  const secret = "test-only-secret";
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyHmac(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyHmac(body, `${signature.slice(0, -1)}0`, secret), false);
  assert.equal(verifyHmac(body, signature, undefined), false);
});
