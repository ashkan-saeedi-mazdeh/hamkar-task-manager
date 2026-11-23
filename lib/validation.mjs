export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireThat(condition, status, message, code) {
  if (!condition) throw new AppError(status, message, code);
}

export function field(value, label, max, min = 1) {
  requireThat(typeof value === 'string', 400, `${label} را وارد کنید.`);
  value = value.trim();
  requireThat(value.length >= min && value.length <= max, 400, `${label} باید بین ${min} و ${max} نویسه باشد.`);
  return value;
}

export function version(value) {
  requireThat(Number.isSafeInteger(value) && value > 0, 400, 'نسخه رکورد نامعتبر است.');
  return value;
}
