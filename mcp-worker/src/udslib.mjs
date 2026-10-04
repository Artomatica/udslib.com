import { ToolInputError } from "./errors.mjs";

const REPO = "https://github.com/w1ne/udslib";
const exUrl = (name) => `${REPO}/tree/develop/examples/${name}`;
const ex = (name) => ({ name, url: exUrl(name) });

const RTOS = ["baremetal", "freertos", "zephyr", "linux"];
const TRANSPORT = ["can", "canfd", "udp-sim"];
const ROLES = ["server", "client"];
const FEATURES = ["dtc", "dtc_persist", "security", "authentication", "bootloader", "flash_tool", "custom_service", "periodic", "roe"];

const RTOS_EXAMPLE = { baremetal: "bare_metal", freertos: "freertos_demo", zephyr: "zephyr_uds_server", linux: "host_sim" };
const FEATURE_EXAMPLE = {
  dtc: "dtc_store",
  dtc_persist: "dtc_persist",
  security: "security_access_mbedtls",
  authentication: "auth_challenge_mbedtls",
  bootloader: "h563_uds_bootloader",
  flash_tool: "pro_flash_tool",
  custom_service: "custom_service",
};

const CORE_FILES = [
  "include/uds/uds_core.h",
  "include/uds/uds_config.h",
  "include/uds/uds_tp.h",
  "include/uds/uds_dtc.h",
  "include/uds/uds_version.h",
  "src/core/uds_core.c",
  "src/core/uds_internal.h",
  "src/services/uds_service_data.c",
  "src/services/uds_service_flash.c",
  "src/services/uds_service_io.c",
  "src/services/uds_service_link.c",
  "src/services/uds_service_maintenance.c",
  "src/services/uds_service_mem.c",
  "src/services/uds_service_roe.c",
  "src/services/uds_service_security.c",
  "src/services/uds_service_session.c",
];

const SKELETON_LOOP = `#include "uds/uds_core.h"
#include "uds/uds_config.h"

static uds_ctx_t ctx;
static uds_config_t cfg;
static uint8_t rx_buffer[4096], tx_buffer[4096];

int main(void)
{
    memset(&cfg, 0, sizeof(cfg));
    cfg.get_time_ms    = get_system_time_ms;   /* SysTick / hw timer */
    cfg.fn_tp_send     = tp_send;              /* your ISO-TP -> CAN glue */
    cfg.rx_buffer      = rx_buffer;  cfg.rx_buffer_size = sizeof(rx_buffer);
    cfg.tx_buffer      = tx_buffer;  cfg.tx_buffer_size = sizeof(tx_buffer);
    /* register services/callbacks here: fn_security_seed, fn_security_key, ... */

    uds_init(&ctx, &cfg);
    while (1) {
        uds_process(&ctx);                     /* timers: S3, P2*, periodic */
        if (can_msg_received) {
            uds_input_sdu(&ctx, data, len);    /* complete ISO-TP SDU */
        }
    }
}`;

const SKELETON_FREERTOS = `#include "uds/uds_core.h"
#include "uds/uds_config.h"

static uds_ctx_t ctx;
static uds_config_t cfg;

void vUDSTask(void *pv)
{
    /* Thread-safe config: the library locks before touching state and
       releases before calling fn_tp_send. */
    cfg.fn_mutex_lock   = os_lock;     /* xSemaphoreTake */
    cfg.fn_mutex_unlock = os_unlock;   /* xSemaphoreGive */
    cfg.get_time_ms     = get_system_time_ms;
    cfg.fn_tp_send      = tp_send;
    /* rx/tx buffers as in the bare-metal skeleton */

    uds_init(&ctx, &cfg);
    while (1) {
        uds_process(&ctx);
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
/* From the CAN RX path / task: uds_input_sdu(&ctx, data, len); */`;

const SKELETON_ZEPHYR = `/* prj.conf selects the module; the ISO-TP transport is provided by the module. */
#include "uds/uds_core.h"
#include "uds/uds_config.h"

static uds_ctx_t ctx;
static uds_config_t cfg;

int main(void)
{
    /* fill cfg as in examples/zephyr_uds_server (buffers, fn_tp_send, get_time_ms) */
    uds_init(&ctx, &cfg);
    while (1) {
        uds_process(&ctx);
        k_msleep(5);
    }
}`;

const SKELETON_CLIENT = `#include "uds/uds_client.h"

static uds_client_ctx_t client = { .config = &cfg };   /* cfg supplies tx_buffer, fn_tp_send */

static void on_response(uds_client_ctx_t *c, uint8_t sid, const uint8_t *data, uint16_t len)
{
    /* data/len = payload after the SID byte */
}

/* ReadDataByIdentifier F190 */
const uint8_t did[] = { 0xF1, 0x90 };
uds_client_request(&client, 0x22, did, sizeof(did), on_response);

/* from your RX path, with the complete SDU split into sid + payload: */
uds_client_handle_response(&client, sid, payload, payload_len);`;

const LICENSE = {
  free: "PolyForm Noncommercial 1.0.0 — personal, research, education, evaluation",
  commercial: "5,000 EUR per legal entity, perpetual, unlimited products, no royalties; includes up to 40 h integration, 1 year updates + email support; renewal 1,500 EUR/year",
  url: "https://udslib.com/pricing.html",
};

function list(name, v, allowed) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !allowed.includes(v)) throw new ToolInputError(`"${name}" must be one of: ${allowed.join(", ")}.`);
  return v;
}

export function udslibIntegration(args = {}) {
  const a = args ?? {};
  const rtos = list("rtos", a.rtos, RTOS) ?? "baremetal";
  const transport = list("transport", a.transport, TRANSPORT) ?? "can";
  const role = list("role", a.role, ROLES) ?? "server";
  const target = typeof a.target === "string" ? a.target : "";
  if (a.features !== undefined && !Array.isArray(a.features)) throw new ToolInputError('"features" must be an array of strings.');
  const features = (a.features ?? []).map((f) => String(f).toLowerCase());

  const unsupported = features.filter((f) => f === "doip");
  const unknown = features.filter((f) => f !== "doip" && !FEATURES.includes(f));
  const wanted = features.filter((f) => FEATURES.includes(f));

  const files = [...CORE_FILES];
  const hints = [];
  if (rtos === "zephyr") {
    files.push("zephyr/module.yml", "zephyr/Kconfig", "zephyr/CMakeLists.txt", "zephyr/uds_zephyr_port.c");
    hints.push("CONFIG_UDSLIB=y", "CONFIG_CAN=y", "CONFIG_CAN_ISOTP=y", "CONFIG_UDSLIB_TRANSPORT_NATIVE=y", "Alternative: CONFIG_UDSLIB_TRANSPORT_FALLBACK=y uses the internal ISO-TP instead of Zephyr's", "CONFIG_REBOOT=y  # ECUReset handler calls sys_reboot()");
    files.push("zephyr/uds_zephyr_isotp.c", "zephyr/uds_zephyr_tp_fallback.c");
  } else {
    files.push("src/transport/uds_tp_isotp.c", "include/uds/uds_isotp.h");
  }
  if (role === "client") files.push("include/uds/uds_client.h", "src/services/uds_client.c");
  if (wanted.includes("dtc") || wanted.includes("dtc_persist")) files.push("include/uds/uds_dtc_store.h", "src/services/uds_dtc_store.c");

  if (transport === "canfd") hints.push(rtos === "zephyr" ? "CAN-FD: use a CAN-FD capable Zephyr driver and set up the data-phase timing; the internal ISO-TP fallback also supports FD" : "CAN-FD: call uds_tp_isotp_set_fd(&iso, true) (64-byte frames, SF escape for payloads > 7)");
  if (transport === "udp-sim") hints.push("UDP simulation: see examples/host_sim (UDP sockets stand in for the CAN bus)");
  hints.push("UDS_SECURITY_SEED_MAX (default 16) bounds the seed length; override at compile time if your algorithm needs more");
  hints.push("Session masks: gate services per session with UDS_SESSION_DEFAULT / UDS_SESSION_EXTENDED / UDS_SESSION_PROGRAMMING");
  if (wanted.includes("bootloader") || wanted.includes("flash_tool")) hints.push("Bootloader: set config.restrict_sessions = true so 0x34/0x36/0x37 only work in the programming session");
  if (wanted.includes("security")) hints.push("SecurityAccess: implement fn_security_seed / fn_security_key (crypto stays in your code)");
  if (wanted.includes("authentication")) hints.push("Authentication (0x29): certificate/proof steps are delegated to fn_auth");
  if (wanted.includes("dtc") || wanted.includes("dtc_persist")) hints.push("DTC: bind the reference store with uds_dtc_store_bind() before uds_init(); flash persistence is your NVM hook");
  if (wanted.includes("roe")) hints.push("ResponseOnEvent (0x86): emit app events with uds_roe_trigger(); timer events run from uds_process()");
  if (wanted.includes("periodic")) hints.push("Periodic data (0x2A): the integrated scheduler runs from uds_process(); call it often enough for the Fast rate");

  // Primary example: target > rtos. The other becomes an extra.
  let primary;
  const extras = [];
  if (/f103|bluepill|blue pill/i.test(target)) primary = "f103_cubemx_uds_ecu";
  else if (/h5|h563/i.test(target)) primary = "h5_uds_ecu_full";
  if (primary) {
    if (a.rtos) extras.push(RTOS_EXAMPLE[a.rtos]);
  } else primary = RTOS_EXAMPLE[rtos];
  for (const f of wanted) if (FEATURE_EXAMPLE[f] && !extras.includes(FEATURE_EXAMPLE[f])) extras.push(FEATURE_EXAMPLE[f]);
  if (role === "client") extras.push("client_demo");
  const extraExamples = [...new Set(extras)].filter((n) => n !== primary).map(ex);

  const skeleton = role === "client" ? SKELETON_CLIENT : rtos === "freertos" ? SKELETON_FREERTOS : rtos === "zephyr" ? SKELETON_ZEPHYR : SKELETON_LOOP;

  const data = { files, example: ex(primary), extraExamples, configHints: hints, skeleton, license: LICENSE };
  if (unsupported.length) data.unsupportedFeatures = unsupported;
  if (unknown.length) data.unknownFeatures = unknown;

  const lines = [
    `UDSLib integration plan: ${role} role, ${rtos}${target ? ", target " + target : ""}, ${transport}.`,
    `Closest example: ${data.example.name} — ${data.example.url}`,
  ];
  if (extraExamples.length) lines.push("Also relevant: " + extraExamples.map((e) => `${e.name} (${e.url})`).join(", "));
  lines.push("", "Files to take from the repo (" + REPO + "):", ...files.map((f) => "  " + f));
  lines.push("", "Config hints:", ...hints.map((h) => "  - " + h));
  lines.push("", "Skeleton:", skeleton);
  if (unsupported.length) lines.push("", "DoIP is not supported today: UDSLib speaks ISO-TP over CAN/CAN-FD only.");
  if (unknown.length) lines.push("", `Unrecognised feature(s): ${unknown.join(", ")}. Known: ${FEATURES.join(", ")}.`);
  lines.push("", "License:", `  Free: ${LICENSE.free}`, `  Commercial: ${LICENSE.commercial}`, `  Details: ${LICENSE.url}`);
  return { text: lines.join("\n"), data };
}
