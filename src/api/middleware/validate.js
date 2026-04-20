/**
 * Request validation middleware factory.
 *
 * Returns an Express middleware that validates req.body against a schema.
 * On failure returns 400 with error: 'invalid_request' and a human-readable reason.
 *
 * Usage:
 *   router.post('/generate', validate({ required: ['prompt'], types: { prompt: 'string', size: 'number' }, minLength: { prompt: 3 } }), handler)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

/**
 * @param {Object} schema
 * @param {string[]} [schema.required] - Fields that must be present and non-empty
 * @param {Object} [schema.types] - Field name → expected JS typeof string
 * @param {Object} [schema.minLength] - Field name → minimum string length
 * @param {Object} [schema.maxLength] - Field name → maximum string length
 * @param {Object} [schema.enum] - Field name → array of allowed values
 * @returns {import('express').RequestHandler}
 */
export function validate(schema = {}) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    for (const field of (schema.required || [])) {
      const val = body[field];
      if (val === undefined || val === null || val === '') {
        errors.push(`"${field}" is required`);
        continue;
      }

      if (schema.types && schema.types[field]) {
        if (typeof val !== schema.types[field]) {
          errors.push(`"${field}" must be a ${schema.types[field]}`);
          continue;
        }
      }

      if (schema.minLength && schema.minLength[field] !== undefined) {
        if (typeof val === 'string' && val.trim().length < schema.minLength[field]) {
          errors.push(`"${field}" must be at least ${schema.minLength[field]} characters`);
        }
      }

      if (schema.maxLength && schema.maxLength[field] !== undefined) {
        if (typeof val === 'string' && val.length > schema.maxLength[field]) {
          errors.push(`"${field}" must not exceed ${schema.maxLength[field]} characters`);
        }
      }

      if (schema.enum && schema.enum[field]) {
        if (!schema.enum[field].includes(val)) {
          errors.push(`"${field}" must be one of: ${schema.enum[field].join(', ')}`);
        }
      }
    }

    // Type-check optional fields that are present
    for (const [field, expectedType] of Object.entries(schema.types || {})) {
      if ((schema.required || []).includes(field)) continue;
      const val = body[field];
      if (val !== undefined && val !== null && typeof val !== expectedType) {
        errors.push(`"${field}" must be a ${expectedType} when provided`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'invalid_request',
        reason: errors.join('; ')
      });
    }

    next();
  };
}

export default validate;
