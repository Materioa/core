const errorLog = [];
const ERROR_RETENTION_MS = 60 * 60 * 1000; // 1 hour in milliseconds

function cleanupOldErrors() {
  const cutoffTime = Date.now() - ERROR_RETENTION_MS;
  while (errorLog.length > 0 && errorLog[0].timestamp < cutoffTime) {
    errorLog.shift();
  }
}

/**
 * Log an error to the tracking system
 * @param {string} errorType - Type/category of error (e.g., 'supabase', 'auth', 'validation')
 * @param {string} message - Error message
 * @param {Object} metadata - Additional error context (optional)
 */
export function logError(errorType, message, metadata = {}) {
  errorLog.push({
    type: errorType,
    message: message,
    metadata: metadata,
    timestamp: Date.now()
  });
  cleanupOldErrors();
}

/**
 * Get the count of errors in the last hour
 * @returns {number} Number of errors logged in the last hour
 */
export function getErrorsLastHour() {
  cleanupOldErrors();
  return errorLog.length;
}

/**
 * Get detailed error breakdown by type
 * @returns {Object} Error counts grouped by type
 */
export function getErrorBreakdown() {
  cleanupOldErrors();
  const breakdown = {};
  
  errorLog.forEach(err => {
    breakdown[err.type] = (breakdown[err.type] || 0) + 1;
  });
  
  return breakdown;
}

/**
 * Get all errors from the last hour
 * @returns {Array} Array of error objects
 */
export function getAllErrors() {
  cleanupOldErrors();
  return [...errorLog];
}
