function assert(condition, message) {
  if (condition) return;

  const error = new Error(message || "Assertion failed");
  error.name = "AssertionError";
  throw error;
}

module.exports = assert;