import { test } from "node:test";
import assert from "node:assert/strict";
import { udslibIntegration } from "../src/udslib.mjs";
import { ToolInputError, TOOLS } from "../src/tools.mjs";

const names = (x) => x.extraExamples.map((e) => e.name);

test("zephyr", () => {
  const { data } = udslibIntegration({ rtos: "zephyr" });
  assert.equal(data.example.name, "zephyr_uds_server");
  assert.equal(data.example.url, "https://github.com/w1ne/udslib/tree/develop/examples/zephyr_uds_server");
  // Deviation from plan vector: the Zephyr module's real Kconfig symbols are CONFIG_UDSLIB / CONFIG_CAN_ISOTP
  assert.ok(data.configHints.includes("CONFIG_UDSLIB=y"));
  assert.ok(data.configHints.includes("CONFIG_CAN_ISOTP=y"));
  assert.ok(data.configHints.includes("CONFIG_UDSLIB_TRANSPORT_NATIVE=y"));
  assert.ok(!data.files.includes("src/transport/uds_tp_isotp.c"));
  assert.ok(data.files.includes("zephyr/module.yml"));
});

test("STM32F103 target", () => {
  assert.equal(udslibIntegration({ target: "STM32F103" }).data.example.name, "f103_cubemx_uds_ecu");
  assert.equal(udslibIntegration({ target: "bluepill" }).data.example.name, "f103_cubemx_uds_ecu");
  assert.equal(udslibIntegration({ target: "STM32H563" }).data.example.name, "h5_uds_ecu_full");
  assert.equal(udslibIntegration({ target: "nucleo-h5" }).data.example.name, "h5_uds_ecu_full");
});

test("freertos + dtc + bootloader", () => {
  const { data, text } = udslibIntegration({ rtos: "freertos", features: ["dtc", "bootloader"] });
  assert.equal(data.example.name, "freertos_demo");
  assert.ok(names(data).includes("dtc_store"));
  assert.ok(names(data).includes("h563_uds_bootloader"));
  assert.match(data.skeleton, /fn_mutex_lock/);
  assert.match(data.skeleton, /uds_init\(&ctx, &cfg\)/);
  assert.match(data.skeleton, /uds_process\(&ctx\)/);
  assert.ok(data.files.includes("include/uds/uds_dtc_store.h"));
  assert.ok(data.files.includes("src/services/uds_dtc_store.c"));
  assert.ok(data.configHints.some((h) => /restrict_sessions/.test(h)));
  assert.match(text, /dtc_store/);
});

test("client role", () => {
  const { data } = udslibIntegration({ role: "client" });
  assert.ok(data.files.includes("src/services/uds_client.c"));
  assert.ok(data.files.includes("include/uds/uds_client.h"));
  assert.ok(names(data).includes("client_demo"));
  assert.match(data.skeleton, /uds_client_request/);
});

test("server baremetal default, linux, features map", () => {
  const b = udslibIntegration({}).data;
  assert.equal(b.example.name, "bare_metal");
  assert.ok(b.files.includes("src/transport/uds_tp_isotp.c"));
  assert.ok(b.files.includes("include/uds/uds_isotp.h"));
  assert.ok(!b.files.includes("src/services/uds_client.c"));
  assert.equal(udslibIntegration({ rtos: "linux" }).data.example.name, "host_sim");
  const f = udslibIntegration({ features: ["dtc_persist", "security", "authentication", "flash_tool", "custom_service"] }).data;
  assert.deepEqual(names(f).sort(), ["auth_challenge_mbedtls", "custom_service", "dtc_persist", "pro_flash_tool", "security_access_mbedtls"]);
});

test("canfd transport hint", () => {
  const { data } = udslibIntegration({ transport: "canfd" });
  assert.ok(data.configHints.some((h) => /uds_tp_isotp_set_fd/.test(h)));
});

test("target example wins as primary, rtos example becomes extra", () => {
  const { data } = udslibIntegration({ target: "F103", rtos: "freertos" });
  assert.equal(data.example.name, "f103_cubemx_uds_ecu");
  assert.ok(names(data).includes("freertos_demo"));
});

test("license block", () => {
  const { data, text } = udslibIntegration({});
  assert.match(data.license.commercial, /5,000 EUR/);
  assert.match(data.license.free, /PolyForm Noncommercial 1\.0\.0/);
  assert.equal(data.license.url, "https://udslib.com/pricing.html");
  assert.match(text, /5,000 EUR/);
  assert.match(text, /udslib\.com\/pricing\.html/);
});

test("DoIP is reported unsupported, not an error", () => {
  const { text, data } = udslibIntegration({ features: ["doip"] });
  assert.match(text, /DoIP is not supported/);
  assert.deepEqual(data.unsupportedFeatures, ["doip"]);
});

test("validation", () => {
  assert.throws(() => udslibIntegration({ rtos: "vxworks" }), ToolInputError);
  assert.throws(() => udslibIntegration({ role: "both" }), ToolInputError);
  assert.throws(() => udslibIntegration({ transport: "lin" }), ToolInputError);
  assert.throws(() => udslibIntegration({ features: "dtc" }), ToolInputError);
});

test("tool registered", () => {
  const r = TOOLS.find((t) => t.name === "udslib_integration").run({ rtos: "zephyr" });
  assert.equal(r.data.example.name, "zephyr_uds_server");
  assert.equal(TOOLS.length, 6);
});
