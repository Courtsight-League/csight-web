export const normalizeJerseyNumberInput = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  const strValue = String(value).trim();
  if (!strValue) {
    return null;
  }
  const digits = strValue.replace(/[^0-9]/g, '');
  if (!digits) {
    return null;
  }
  return digits;
};

export const parseJerseyNumberValue = (value: unknown): number | null => {
  const normalized = normalizeJerseyNumberInput(value);
  if (!normalized) {
    return null;
  }
  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
