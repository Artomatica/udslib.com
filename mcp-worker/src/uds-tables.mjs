// Static UDS reference tables. Names follow the common ISO 14229-1 identifiers;
// descriptions are short paraphrases, not standard text.

const S = (name, clause, extra = {}) => ({ name, hasSubfunction: false, clause: `ISO 14229-1 §${clause}`, ...extra });

export const SERVICES = {
  0x10: S("DiagnosticSessionControl", "10.2", { hasSubfunction: true, subfunctions: { 1: "defaultSession", 2: "programmingSession", 3: "extendedDiagnosticSession", 4: "safetySystemDiagnosticSession" } }),
  0x11: S("ECUReset", "10.3", { hasSubfunction: true, subfunctions: { 1: "hardReset", 2: "keyOffOnReset", 3: "softReset", 4: "enableRapidPowerShutDown", 5: "disableRapidPowerShutDown" } }),
  0x14: S("ClearDiagnosticInformation", "12.2"),
  0x19: S("ReadDTCInformation", "12.3", {
    hasSubfunction: true,
    subfunctions: {
      0x01: "reportNumberOfDTCByStatusMask", 0x02: "reportDTCByStatusMask", 0x03: "reportDTCSnapshotIdentification",
      0x04: "reportDTCSnapshotRecordByDTCNumber", 0x05: "reportDTCStoredDataByRecordNumber", 0x06: "reportDTCExtDataRecordByDTCNumber",
      0x07: "reportNumberOfDTCBySeverityMaskRecord", 0x08: "reportDTCBySeverityMaskRecord", 0x09: "reportSeverityInformationOfDTC",
      0x0a: "reportSupportedDTC", 0x0b: "reportFirstTestFailedDTC", 0x0c: "reportFirstConfirmedDTC",
      0x0d: "reportMostRecentTestFailedDTC", 0x0e: "reportMostRecentConfirmedDTC", 0x14: "reportDTCFaultDetectionCounter",
      0x15: "reportDTCWithPermanentStatus", 0x16: "reportDTCExtDataRecordByRecordNumber", 0x17: "reportUserDefMemoryDTCByStatusMask",
      0x18: "reportUserDefMemoryDTCSnapshotRecordByDTCNumber", 0x19: "reportUserDefMemoryDTCExtDataRecordByDTCNumber",
      0x42: "reportWWHOBDDTCByMaskRecord", 0x55: "reportWWHOBDDTCWithPermanentStatus", 0x56: "reportDTCInformationByDTCReadinessGroupIdentifier",
    },
  }),
  0x22: S("ReadDataByIdentifier", "11.2"),
  0x23: S("ReadMemoryByAddress", "11.3"),
  0x24: S("ReadScalingDataByIdentifier", "11.4"),
  0x27: S("SecurityAccess", "10.4", { hasSubfunction: true }),
  0x28: S("CommunicationControl", "10.5", { hasSubfunction: true, subfunctions: { 0: "enableRxAndTx", 1: "enableRxAndDisableTx", 2: "disableRxAndEnableTx", 3: "disableRxAndTx", 4: "enableRxAndDisableTxWithEnhancedAddressInformation", 5: "enableRxAndTxWithEnhancedAddressInformation" } }),
  0x29: S("Authentication", "10.6", { hasSubfunction: true, subfunctions: { 0: "deAuthenticate", 1: "verifyCertificateUnidirectional", 2: "verifyCertificateBidirectional", 3: "proofOfOwnership", 4: "transmitCertificate", 5: "requestChallengeForAuthentication", 6: "verifyProofOfOwnershipUnidirectional", 7: "verifyProofOfOwnershipBidirectional", 8: "authenticationConfiguration" } }),
  0x2a: S("ReadDataByPeriodicIdentifier", "11.5"),
  0x2c: S("DynamicallyDefineDataIdentifier", "11.6", { hasSubfunction: true, subfunctions: { 1: "defineByIdentifier", 2: "defineByMemoryAddress", 3: "clearDynamicallyDefinedDataIdentifier" } }),
  0x2e: S("WriteDataByIdentifier", "11.7"),
  0x2f: S("InputOutputControlByIdentifier", "13.2"),
  0x31: S("RoutineControl", "14.2", { hasSubfunction: true, subfunctions: { 1: "startRoutine", 2: "stopRoutine", 3: "requestRoutineResults" } }),
  0x34: S("RequestDownload", "15.2"),
  0x35: S("RequestUpload", "15.3"),
  0x36: S("TransferData", "15.4"),
  0x37: S("RequestTransferExit", "15.5"),
  0x38: S("RequestFileTransfer", "15.6"),
  0x3d: S("WriteMemoryByAddress", "11.8"),
  0x3e: S("TesterPresent", "10.7", { hasSubfunction: true, subfunctions: { 0: "zeroSubFunction" } }),
  0x83: S("AccessTimingParameter", "10.8", { hasSubfunction: true, subfunctions: { 1: "readExtendedTimingParameterSet", 2: "setTimingParametersToDefaultValues", 3: "readCurrentlyActiveTimingParameters", 4: "setTimingParametersToGivenValues" } }),
  0x84: S("SecuredDataTransmission", "10.9"),
  0x85: S("ControlDTCSetting", "10.10", { hasSubfunction: true, subfunctions: { 1: "on", 2: "off" } }),
  0x86: S("ResponseOnEvent", "10.11", { hasSubfunction: true, subfunctions: { 0: "stopResponseOnEvent", 1: "onDTCStatusChange", 2: "onTimerInterrupt", 3: "onChangeOfDataIdentifier", 4: "reportActivatedEvents", 5: "startResponseOnEvent", 6: "clearResponseOnEvent", 7: "onComparisonOfValues" } }),
  0x87: S("LinkControl", "10.12", { hasSubfunction: true, subfunctions: { 1: "verifyBaudrateTransitionWithFixedBaudrate", 2: "verifyBaudrateTransitionWithSpecificBaudrate", 3: "transitionBaudrate" } }),
};

const N = (name, meaning, typicalCause) => ({ name, meaning, typicalCause });

export const NRCS = {
  0x10: N("generalReject", "Request refused, no more specific code applies.", "Catch-all; check the ECU's own documentation."),
  0x11: N("serviceNotSupported", "The service ID is not implemented in this ECU.", "Wrong SID, or the ECU lacks that service (also in functional addressing)."),
  0x12: N("subFunctionNotSupported", "The service exists but this sub-function is not implemented.", "Wrong sub-function value, or the suppress bit confused with the sub-function."),
  0x13: N("incorrectMessageLengthOrInvalidFormat", "Request length or format does not match what the service expects.", "Missing/extra bytes, wrong ALFID, DID list truncated."),
  0x14: N("responseTooLong", "The response would not fit the ECU's transmit buffer or limit.", "Reading too many DIDs or too large a memory range in one request."),
  0x21: N("busyRepeatRequest", "ECU is busy; send the same request again later.", "Long-running job in progress; retry with back-off."),
  0x22: N("conditionsNotCorrect", "A precondition for the service is not met.", "Wrong session, vehicle state (speed, engine) or a missing prior step."),
  0x24: N("requestSequenceError", "Request arrived out of the expected order.", "sendKey before requestSeed, TransferData before RequestDownload, etc."),
  0x25: N("noResponseFromSubnetComponent", "A gateway got no answer from the downstream node.", "Sub-network ECU is off or not responding."),
  0x26: N("failurePreventsExecutionOfRequestedAction", "A detected fault blocks the requested action.", "Internal fault active; clear or diagnose it first."),
  0x31: N("requestOutOfRange", "A parameter in the request (DID, RID, address, size) is outside what the ECU accepts.", "Unknown or unsupported DID/RID, address or length not allowed."),
  0x33: N("securityAccessDenied", "The service needs an unlocked security level.", "Run SecurityAccess (0x27) first, or session was reset and re-locked it."),
  0x34: N("authenticationRequired", "The service needs an authenticated tester.", "Run Authentication (0x29) first."),
  0x35: N("invalidKey", "The key sent does not match the ECU's expectation.", "Wrong key algorithm, seed mismatch, or wrong security level."),
  0x36: N("exceedNumberOfAttempts", "Too many wrong keys were sent.", "Repeated invalid keys; power-cycle or wait for the lockout."),
  0x37: N("requiredTimeDelayNotExpired", "The anti-brute-force delay is still running.", "Retrying SecurityAccess too soon after a failure or reset."),
  0x50: N("invalidCertificate", "Authentication certificate was rejected.", "Expired, wrong chain, or malformed certificate."),
  0x51: N("ownershipVerificationFailed", "Proof of ownership did not verify.", "Wrong private key or stale challenge."),
  0x52: N("challengeCalculationFailed", "ECU could not compute the authentication challenge.", "Crypto resource unavailable or misconfigured."),
  0x53: N("settingAccessRightsFailed", "ECU could not apply the access rights from authentication.", "Rights data missing or inconsistent."),
  0x54: N("sessionKeyCreationDerivationFailed", "Session key creation or derivation failed.", "Key agreement parameters invalid."),
  0x55: N("configurationDataUsageFailed", "Configuration data for authentication could not be used.", "Configuration missing or corrupt."),
  0x56: N("deAuthenticationFailed", "De-authentication could not be completed.", "Not authenticated, or internal state error."),
  0x70: N("uploadDownloadNotAccepted", "ECU refuses the download/upload request.", "Wrong session, address range not writable, or not unlocked."),
  0x71: N("transferDataSuspended", "Data transfer was aborted by the ECU.", "ECU-side error during transfer; restart from RequestDownload."),
  0x72: N("generalProgrammingFailure", "Erase or write to non-volatile memory failed.", "Flash error, power dip, or write-protected region."),
  0x73: N("wrongBlockSequenceCounter", "TransferData block counter is not the expected one.", "Lost or duplicated block; counter starts at 1 and wraps 0xFF to 0x00."),
  0x78: N("requestCorrectlyReceivedResponsePending", "Request accepted; the final answer needs more time.", "Slow operation such as flash erase; ECU repeats this until done."),
  0x7e: N("subFunctionNotSupportedInActiveSession", "The sub-function is not available in the current session.", "Switch to the session that enables it (often extended or programming)."),
  0x7f: N("serviceNotSupportedInActiveSession", "The service is not available in the current session.", "Switch to the required session (e.g. programming for 0x34/0x36)."),
  0x81: N("rpmTooHigh", "Engine speed is above the allowed limit for this action.", "Stop the engine or reduce rpm."),
  0x82: N("rpmTooLow", "Engine speed is below the allowed limit for this action.", "Raise engine speed."),
  0x83: N("engineIsRunning", "The action requires the engine to be off.", "Switch off the engine."),
  0x84: N("engineIsNotRunning", "The action requires the engine to be running.", "Start the engine."),
  0x85: N("engineRunTimeTooLow", "Engine has not run long enough.", "Let the engine run longer."),
  0x86: N("temperatureTooHigh", "Temperature is above the allowed limit.", "Let the system cool down."),
  0x87: N("temperatureTooLow", "Temperature is below the allowed limit.", "Warm up first."),
  0x88: N("vehicleSpeedTooHigh", "Vehicle speed is above the allowed limit.", "Stop the vehicle."),
  0x89: N("vehicleSpeedTooLow", "Vehicle speed is below the allowed limit.", "Increase speed as required by the test."),
  0x8a: N("throttlePedalTooHigh", "Throttle/pedal position is too high.", "Release the pedal."),
  0x8b: N("throttlePedalTooLow", "Throttle/pedal position is too low.", "Press the pedal as required."),
  0x8c: N("transmissionRangeNotInNeutral", "Transmission must be in neutral.", "Shift to neutral."),
  0x8d: N("transmissionRangeNotInGear", "Transmission must be in gear.", "Engage a gear."),
  0x8f: N("brakeSwitchNotClosed", "Brake switch(es) must be closed (brake pressed).", "Press the brake pedal."),
  0x90: N("shifterLeverNotInPark", "Shifter lever must be in park.", "Select park."),
  0x91: N("torqueConverterClutchLocked", "Torque converter clutch is locked.", "Unlock it before retrying."),
  0x92: N("voltageTooHigh", "Supply voltage is above the allowed limit.", "Check the charger/supply; flashing usually needs a stable supply."),
  0x93: N("voltageTooLow", "Supply voltage is below the allowed limit.", "Connect a battery support unit before flashing."),
};

/** Resolve any NRC byte, including reserved and manufacturer-specific ranges. */
export function nrcInfo(code) {
  if (NRCS[code]) return NRCS[code];
  if (code >= 0x38 && code <= 0x4f) return N("reservedByExtendedDataLinkSecurity", "Reserved code (extended data link security range).", "Not used by plain UDS; check the ECU or protocol extension.");
  if (code >= 0x57 && code <= 0x5d) return N("reservedByAuthentication", "Reserved code (authentication range).", "Not defined for the common case; check the ECU documentation.");
  if (code >= 0xf0 && code <= 0xfe) return N("vehicleManufacturerSpecific", "Manufacturer-specific code.", "Meaning defined by the OEM; see the ECU's diagnostic specification.");
  if (code === 0x8e) return N("reserved", "Reserved by the standard.", "Not expected on the wire.");
  return N("reservedByISO14229", "Reserved by the standard (unknown / manufacturer-specific use possible).", "Not defined by ISO 14229-1; check the ECU's diagnostic specification.");
}

const D = (name, len) => ({ name, ...(len ? { len } : {}) });

export const DIDS = {
  0xf180: D("bootSoftwareIdentification"), 0xf181: D("applicationSoftwareIdentification"), 0xf182: D("applicationDataIdentification"),
  0xf183: D("bootSoftwareFingerprint"), 0xf184: D("applicationSoftwareFingerprint"), 0xf185: D("applicationDataFingerprint"),
  0xf186: D("activeDiagnosticSession", 1), 0xf187: D("vehicleManufacturerSparePartNumber"), 0xf188: D("vehicleManufacturerECUSoftwareNumber"),
  0xf189: D("vehicleManufacturerECUSoftwareVersionNumber"), 0xf18a: D("systemSupplierIdentifier"), 0xf18b: D("ECUManufacturingDate", 4),
  0xf18c: D("ECUSerialNumber"), 0xf18d: D("supportedFunctionalUnits"), 0xf18e: D("vehicleManufacturerKitAssemblyPartNumber"),
  0xf190: D("VIN", 17), 0xf191: D("vehicleManufacturerECUHardwareNumber"), 0xf192: D("systemSupplierECUHardwareNumber"),
  0xf193: D("systemSupplierECUHardwareVersionNumber"), 0xf194: D("systemSupplierECUSoftwareNumber"), 0xf195: D("systemSupplierECUSoftwareVersionNumber"),
  0xf196: D("exhaustRegulationOrTypeApprovalNumber"), 0xf197: D("systemNameOrEngineType"), 0xf198: D("repairShopCodeOrTesterSerialNumber"),
  0xf199: D("programmingDate", 4), 0xf19a: D("calibrationRepairShopCodeOrCalibrationEquipmentSerialNumber"), 0xf19b: D("calibrationDate", 4),
  0xf19c: D("calibrationEquipmentSoftwareNumber"), 0xf19d: D("ECUInstallationDate", 4), 0xf19e: D("ODXFile"), 0xf19f: D("entity"),
};

export const RIDS = {
  0x0202: "checkMemory",
  0xff00: "eraseMemory",
  0xff01: "checkProgrammingDependencies",
};

