'use strict';


function createError(status, message, details = {}) {
  const err = new Error(message);
  err.status = status;
  if (details.code) err.code = details.code;
  if (details.provider) err.provider = details.provider;
  if (details.issues) err.issues = details.issues;
  if (details.upstream !== undefined) err.upstream = details.upstream;
  return err;
}

module.exports = { createError };