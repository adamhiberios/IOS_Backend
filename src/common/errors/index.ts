export {
  AppException,
  type ValidationErrorItem,
} from './app-exception';
export { ErrorCode, codeToSlug } from './error-codes';
export type { ErrorCodeKey, ErrorCodeValue } from './error-codes';

// Concrete error classes — grouped by taxonomy family.
export * from './codes/auth.errors';
export * from './codes/authorization.errors';
export * from './codes/domain.errors';
export * from './codes/validation.errors';
export * from './codes/infrastructure.errors';
