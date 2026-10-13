// An error caused by the request itself. Its message is safe to show to the student.
class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { UserError };
