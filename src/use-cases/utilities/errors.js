function useCaseError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const HTTP_STATUS = {
  MISSING_PARAMS: 400,
  MISSING_REASON: 400,
  INVALID_AMOUNT: 400,
  NO_ACTIVE_LEASES: 400,
  NO_ORG: 400,
  NO_PROPERTIES: 400,
  NOT_CONNECTED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  DEADLINE_NOT_REACHED: 409,
  DEADLINE_PASSED: 409,
  NOT_CONFIGURED: 503,
  IMPORT_FAILED: 500,
  SERVER_ERROR: 500,
};

function httpStatusForCode(code) {
  return HTTP_STATUS[code] ?? 500;
}

module.exports = { useCaseError, httpStatusForCode };
